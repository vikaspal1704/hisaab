-- Hisaab v2: features for how friends actually deal with money.
--
-- * Baari (turn) style and a "close enough" tolerance per friend and per group
-- * "Chhod do": forgiving a small balance, recorded as its own entry
-- * Treats: remembered, never owed
-- * Shortcuts for two-tap logging
-- * Confirm / question entries someone else added about you
-- * Private share links so friends without the app can see and react
-- * Reminder comfort settings
-- * Trip kitty (one person holds the pool)
-- * Recurring monthly expenses for flatmates
-- * Push notification subscriptions
--
-- Additive on top of 20261012000000_init.sql; safe to run on a live database.

------------------------------------------------------------------------------
-- Settings on contacts and groups
------------------------------------------------------------------------------

alter table public.contacts
  add column style text not null default 'baari',
  add column tolerance bigint not null default 10000,          -- ₹100
  add column remind_above bigint not null default 50000,       -- ₹500
  add column remind_after_days integer not null default 14,
  add column last_nudged_at timestamptz,
  add constraint contacts_style check (style in ('baari', 'exact')),
  add constraint contacts_tolerance check (tolerance between 0 and 10000000),
  add constraint contacts_remind_above check (remind_above between 0 and 1000000000),
  add constraint contacts_remind_after check (remind_after_days between 1 and 365);

alter table public.groups
  add column kind text not null default 'friends',
  add column tolerance bigint not null default 10000,
  add column kitty_holder uuid references public.people (id),
  add constraint groups_kind check (kind in ('friends', 'trip', 'home')),
  add constraint groups_tolerance check (tolerance between 0 and 10000000);

------------------------------------------------------------------------------
-- New entry kinds: forgive ("chhod do") and treat
------------------------------------------------------------------------------

alter table public.entries
  drop constraint entries_kind,
  drop constraint entries_split_mode,
  drop constraint entries_method,
  add column occasion text,
  add column kitty boolean not null default false,
  add constraint entries_kind check (kind in ('expense', 'payment', 'forgive', 'treat')),
  add constraint entries_split_mode check (
    (kind = 'expense' and split_mode in ('equal', 'exact', 'shares'))
    or (kind <> 'expense' and split_mode is null)
  ),
  add constraint entries_method check (
    (kind = 'payment' and method in ('cash', 'upi', 'bank', 'other'))
    or (kind <> 'payment' and method is null)
  ),
  add constraint entries_occasion check (
    (kind = 'treat' or occasion is null) and (occasion is null or char_length(occasion) <= 40)
  ),
  add constraint entries_kitty_kind check (not kitty or kind in ('expense', 'payment'));

------------------------------------------------------------------------------
-- New tables
------------------------------------------------------------------------------

create table public.shortcuts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.people (id) on delete cascade,
  label text not null,
  description text not null,
  amount bigint,
  group_id uuid references public.groups (id) on delete cascade,
  -- The add-expense form's participant units, as the client saved them.
  units jsonb not null,
  created_at timestamptz not null default now(),
  constraint shortcuts_label check (char_length(btrim(label)) between 1 and 40),
  constraint shortcuts_description check (char_length(btrim(description)) between 1 and 100),
  constraint shortcuts_amount check (amount is null or (amount > 0 and amount <= 1000000000)),
  constraint shortcuts_units check (jsonb_typeof(units) = 'array' and jsonb_array_length(units) between 1 and 50)
);
create index shortcuts_owner_idx on public.shortcuts (owner_id);

create table public.entry_reactions (
  entry_id uuid not null references public.entries (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  status text not null,
  note text,
  updated_at timestamptz not null default now(),
  primary key (entry_id, person_id),
  constraint entry_reactions_status check (status in ('confirmed', 'questioned')),
  constraint entry_reactions_note check (note is null or char_length(note) <= 200)
);

create table public.share_links (
  token text primary key,
  owner_id uuid not null references public.people (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index share_links_active_idx on public.share_links (owner_id, person_id) where revoked_at is null;

create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid not null references public.people (id),
  description text not null,
  amount bigint not null,
  split_mode text not null,
  parts jsonb not null,
  day_of_month integer not null,
  next_on date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint recurring_description check (char_length(btrim(description)) between 1 and 80),
  constraint recurring_amount check (amount > 0 and amount <= 1000000000),
  constraint recurring_split_mode check (split_mode in ('equal', 'exact', 'shares')),
  -- 1..28 so every month has the day.
  constraint recurring_day check (day_of_month between 1 and 28)
);
create index recurring_rules_group_idx on public.recurring_rules (group_id);

create table public.push_subscriptions (
  endpoint text primary key,
  person_id uuid not null references public.people (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_person_idx on public.push_subscriptions (person_id);

alter table public.shortcuts enable row level security;
alter table public.entry_reactions enable row level security;
alter table public.share_links enable row level security;
alter table public.recurring_rules enable row level security;
alter table public.push_subscriptions enable row level security;

create policy shortcuts_read on public.shortcuts for select to authenticated
  using (owner_id = public.me());
create policy entry_reactions_read on public.entry_reactions for select to authenticated
  using (public.is_entry_participant(entry_id));
create policy share_links_read on public.share_links for select to authenticated
  using (owner_id = public.me());
create policy recurring_rules_read on public.recurring_rules for select to authenticated
  using (public.is_group_member(group_id));
create policy push_subscriptions_read on public.push_subscriptions for select to authenticated
  using (person_id = public.me());

revoke all on public.shortcuts, public.entry_reactions, public.share_links,
  public.recurring_rules, public.push_subscriptions from anon, authenticated;
grant select on public.shortcuts, public.entry_reactions, public.share_links,
  public.recurring_rules, public.push_subscriptions to authenticated;

-- An edit changes what people agreed to, so their reactions start over.
create function public._reset_reactions_on_edit() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.action = 'edited' then
    delete from public.entry_reactions where entry_id = new.entry_id;
  end if;
  return new;
end;
$$;
create trigger entry_events_reset_reactions after insert on public.entry_events
  for each row execute function public._reset_reactions_on_edit();

------------------------------------------------------------------------------
-- Preferences
------------------------------------------------------------------------------

create function public.set_contact_prefs(
  p_person uuid, p_style text, p_tolerance bigint, p_remind_above bigint, p_remind_after_days integer
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.contacts
     set style = p_style, tolerance = p_tolerance,
         remind_above = p_remind_above, remind_after_days = p_remind_after_days
   where owner_id = public.require_me() and person_id = p_person;
  if not found then
    raise exception 'unknown_person' using errcode = 'P0001';
  end if;
end;
$$;

create function public.mark_nudged(p_person uuid) returns void
language sql security definer set search_path = ''
as $$
  update public.contacts set last_nudged_at = now()
   where owner_id = public.require_me() and person_id = p_person
$$;

-- Group kind decides sensible defaults: friends take turns, trips and homes split exactly.
create function public.set_group_prefs(p_group uuid, p_kind text, p_tolerance bigint, p_kitty_holder uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_me();
  if not public.is_group_member(p_group) then
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;
  if p_kitty_holder is not null and not exists (
    select 1 from public.group_members where group_id = p_group and person_id = p_kitty_holder) then
    raise exception 'not_group_member' using errcode = 'P0001';
  end if;
  update public.groups
     set kind = p_kind, tolerance = p_tolerance, kitty_holder = p_kitty_holder
   where id = p_group;
end;
$$;

------------------------------------------------------------------------------
-- Chhod do: forgive (part of) what someone owes me
------------------------------------------------------------------------------

create function public.forgive_balance(p_other uuid, p_amount bigint, p_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_owed bigint;
  v_id uuid;
begin
  -- Only the person who is owed can let it go, and only up to what is owed.
  select coalesce(sum(net), 0) into v_owed from public.my_balances() where person_id = p_other;
  if p_amount is null or p_amount <= 0 or p_amount > v_owed then
    raise exception 'forgive_too_much' using errcode = 'P0001';
  end if;

  insert into public.entries (kind, description, amount, created_by)
  values ('forgive', coalesce(nullif(btrim(p_note), ''), 'Chhod diya 🙏'), p_amount, v_me)
  returning id into v_id;
  -- Same shape as a payment from them to me, so balances and passbooks just work.
  insert into public.entry_parts (entry_id, person_id, paid, owed)
  values (v_id, p_other, p_amount, 0), (v_id, v_me, 0, p_amount);
  insert into public.ledger_lines (entry_id, debtor_id, creditor_id, amount)
  values (v_id, v_me, p_other, p_amount);
  insert into public.entry_events (entry_id, actor_id, action) values (v_id, v_me, 'created');
  return v_id;
end;
$$;

------------------------------------------------------------------------------
-- Treats: who treated whom, for the memory, never a debt
------------------------------------------------------------------------------

create function public.save_treat(
  p_giver uuid, p_amount bigint, p_description text, p_occasion text,
  p_occurred_on date, p_guests uuid[], p_group uuid default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_people uuid[];
  v_id uuid;
begin
  select array_agg(distinct x) into v_people from (select p_giver as x union select unnest(p_guests)) s;
  if p_giver is null or cardinality(v_people) < 2 or cardinality(v_people) > 50 then
    raise exception 'invalid_parts' using errcode = 'P0001';
  end if;
  if not (v_me = any (v_people)) then
    raise exception 'must_participate' using errcode = 'P0001';
  end if;
  if p_group is not null and not public.is_group_member(p_group) then
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;
  perform public._assert_allowed_people(v_people, p_group, null);

  insert into public.entries (kind, description, amount, occurred_on, group_id, occasion, created_by)
  values ('treat', btrim(p_description), p_amount, coalesce(p_occurred_on, current_date), p_group,
          nullif(btrim(p_occasion), ''), v_me)
  returning id into v_id;
  insert into public.entry_parts (entry_id, person_id, paid, owed)
  select v_id, x, case when x = p_giver then p_amount else 0 end, 0 from unnest(v_people) x;
  perform public._link_participants(v_id);
  insert into public.entry_events (entry_id, actor_id, action) values (v_id, v_me, 'created');
  return v_id;
end;
$$;

-- Treats exchanged between me and one friend.
create function public.treat_summary(p_other uuid)
returns table (i_gave integer, i_gave_amount bigint, they_gave integer, they_gave_amount bigint, last_giver uuid, last_on date)
language sql stable security definer set search_path = ''
as $$
  with t as (
    select e.id, e.amount, e.occurred_on, e.created_at,
           (select ep.person_id from public.entry_parts ep where ep.entry_id = e.id and ep.paid > 0) as giver
    from public.entries e
    where e.kind = 'treat' and e.deleted_at is null
      and exists (select 1 from public.entry_parts a where a.entry_id = e.id and a.person_id = public.me())
      and exists (select 1 from public.entry_parts b where b.entry_id = e.id and b.person_id = p_other)
  )
  select count(*) filter (where giver = public.me())::integer,
         coalesce(sum(amount) filter (where giver = public.me()), 0)::bigint,
         count(*) filter (where giver = p_other)::integer,
         coalesce(sum(amount) filter (where giver = p_other), 0)::bigint,
         (select giver from t order by occurred_on desc, created_at desc limit 1),
         (select occurred_on from t order by occurred_on desc, created_at desc limit 1)
  from t
$$;

------------------------------------------------------------------------------
-- Shortcuts
------------------------------------------------------------------------------

create function public.save_shortcut(p_label text, p_description text, p_amount bigint, p_group uuid, p_units jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_group is not null and not public.is_group_member(p_group) then
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;
  insert into public.shortcuts (owner_id, label, description, amount, group_id, units)
  values (public.require_me(), btrim(p_label), btrim(p_description), p_amount, p_group, p_units)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.delete_shortcut(p_id uuid) returns void
language sql security definer set search_path = ''
as $$
  delete from public.shortcuts where id = p_id and owner_id = public.require_me()
$$;

------------------------------------------------------------------------------
-- Confirm / question
------------------------------------------------------------------------------

create function public._react(p_entry uuid, p_person uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.entry_parts where entry_id = p_entry and person_id = p_person)
     or not exists (select 1 from public.entries where id = p_entry and deleted_at is null) then
    raise exception 'entry_not_found' using errcode = 'P0001';
  end if;
  insert into public.entry_reactions (entry_id, person_id, status, note, updated_at)
  values (p_entry, p_person, p_status, nullif(btrim(p_note), ''), now())
  on conflict (entry_id, person_id)
  do update set status = excluded.status, note = excluded.note, updated_at = now();
end;
$$;

create function public.react_to_entry(p_entry uuid, p_status text, p_note text default null) returns void
language sql security definer set search_path = ''
as $$
  select public._react(p_entry, public.require_me(), p_status, p_note)
$$;

-- Entries needing my attention: changed by someone else in the last 3 days
-- and not yet confirmed by me, plus anything someone has questioned.
create function public.my_reviews()
returns table (
  entry_id uuid, state text, kind text, description text, amount bigint, occurred_on date,
  actor_id uuid, at timestamptz, my_delta bigint, questioned_by uuid, question_note text
)
language sql stable security definer set search_path = ''
as $$
  with mine as (
    select e.*,
           (select ev.actor_id from public.entry_events ev where ev.entry_id = e.id order by ev.id desc limit 1) as last_actor,
           (select ev.created_at from public.entry_events ev where ev.entry_id = e.id order by ev.id desc limit 1) as last_at,
           coalesce((select sum(case when l.creditor_id = public.me() then l.amount else -l.amount end)
                     from public.ledger_lines l
                     where l.entry_id = e.id and public.me() in (l.debtor_id, l.creditor_id)), 0)::bigint as delta
    from public.entry_parts ep
    join public.entries e on e.id = ep.entry_id and e.deleted_at is null
    where ep.person_id = public.me() and e.kind in ('expense', 'payment', 'forgive')
  )
  select m.id, 'questioned', m.kind, m.description, m.amount, m.occurred_on, m.last_actor, m.last_at, m.delta,
         r.person_id, r.note
  from mine m
  join lateral (select * from public.entry_reactions r where r.entry_id = m.id and r.status = 'questioned'
                order by r.updated_at desc limit 1) r on true
  union all
  select m.id, 'pending', m.kind, m.description, m.amount, m.occurred_on, m.last_actor, m.last_at, m.delta, null, null
  from mine m
  where m.last_actor <> public.me()
    and m.last_at > now() - interval '3 days'
    and m.delta <> 0
    and not exists (select 1 from public.entry_reactions r where r.entry_id = m.id and r.person_id = public.me())
  order by 8 desc
$$;

------------------------------------------------------------------------------
-- Share links: a friend without the app sees our hisaab and can react
------------------------------------------------------------------------------

create function public.create_share_link(p_person uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_token text;
begin
  if not exists (select 1 from public.contacts where owner_id = v_me and person_id = p_person) then
    raise exception 'unknown_person' using errcode = 'P0001';
  end if;
  -- 244 random bits. Two taps at once must not create two links (or fail):
  -- the partial unique index decides, and everyone gets the surviving token.
  insert into public.share_links (token, owner_id, person_id)
  values (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), v_me, p_person)
  on conflict (owner_id, person_id) where revoked_at is null do nothing;
  select token into v_token from public.share_links
   where owner_id = v_me and person_id = p_person and revoked_at is null;
  return v_token;
end;
$$;

create function public.revoke_share_link(p_person uuid) returns void
language sql security definer set search_path = ''
as $$
  update public.share_links set revoked_at = now()
   where owner_id = public.require_me() and person_id = p_person and revoked_at is null
$$;

-- Passbook between two people from a's point of view (positive = b owes a).
create function public._pair_ledger(p_a uuid, p_b uuid)
returns table (entry_id uuid, kind text, description text, occurred_on date, created_at timestamptz,
               amount bigint, delta bigint, running bigint)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.kind, e.description, e.occurred_on, e.created_at, e.amount, d.delta,
         sum(d.delta) over (order by e.occurred_on, e.created_at, e.id)::bigint
  from (
    select l.entry_id, sum(case when l.creditor_id = p_a then l.amount else -l.amount end)::bigint as delta
    from public.ledger_lines l
    where (l.debtor_id = p_a and l.creditor_id = p_b) or (l.debtor_id = p_b and l.creditor_id = p_a)
    group by l.entry_id
  ) d
  join public.entries e on e.id = d.entry_id and e.deleted_at is null
  order by e.occurred_on, e.created_at, e.id
$$;

-- What the friend sees when they open the link (from their point of view).
create function public.shared_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_link public.share_links;
  v_owner public.people;
  v_friend public.people;
begin
  select * into v_link from public.share_links where token = p_token and revoked_at is null;
  if not found then
    raise exception 'link_not_found' using errcode = 'P0001';
  end if;
  select * into v_owner from public.people where id = v_link.owner_id;
  select * into v_friend from public.people where id = v_link.person_id;
  return jsonb_build_object(
    'owner_name', v_owner.name,
    'owner_upi', v_owner.upi_id,
    'friend_name', v_friend.name,
    'friend_registered', v_friend.user_id is not null,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entry_id', l.entry_id, 'kind', l.kind, 'description', l.description,
        'occurred_on', l.occurred_on, 'amount', l.amount, 'delta', l.delta, 'running', l.running,
        'reaction', (select r.status from public.entry_reactions r
                     where r.entry_id = l.entry_id and r.person_id = v_friend.id)
      ) order by l.occurred_on desc, l.created_at desc)
      from public._pair_ledger(v_friend.id, v_owner.id) l
    ), '[]'::jsonb)
  );
end;
$$;

create function public.shared_react(p_token text, p_entry uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_link public.share_links;
begin
  select * into v_link from public.share_links where token = p_token and revoked_at is null;
  if not found then
    raise exception 'link_not_found' using errcode = 'P0001';
  end if;
  -- Only entries between the two people on this link.
  if not exists (select 1 from public._pair_ledger(v_link.person_id, v_link.owner_id) l where l.entry_id = p_entry) then
    raise exception 'entry_not_found' using errcode = 'P0001';
  end if;
  perform public._react(p_entry, v_link.person_id, p_status, p_note);
end;
$$;

------------------------------------------------------------------------------
-- Trip kitty: one member holds the pool
------------------------------------------------------------------------------

create function public._kitty_holder(p_group uuid) returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_holder uuid;
begin
  if not public.is_group_member(p_group) then
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;
  select kitty_holder into v_holder from public.groups where id = p_group;
  if v_holder is null then
    raise exception 'no_kitty' using errcode = 'P0001';
  end if;
  return v_holder;
end;
$$;

-- Someone puts money into the kitty: a payment to the holder, tagged as kitty.
create function public.add_to_kitty(p_group uuid, p_from uuid, p_amount bigint, p_occurred_on date, p_method text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_holder uuid := public._kitty_holder(p_group);
  v_id uuid;
begin
  if p_from = v_holder then
    raise exception 'holder_cannot_contribute' using errcode = 'P0001';
  end if;
  v_id := public.save_payment(null, p_from, v_holder, p_amount, p_occurred_on, p_method, 'Into the kitty', null, p_group, null);
  update public.entries set kitty = true where id = v_id;
  return v_id;
end;
$$;

-- An expense paid out of the kitty: the holder is the payer.
create function public.save_kitty_expense(
  p_description text, p_amount bigint, p_occurred_on date, p_group uuid, p_split_mode text, p_parts jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_holder uuid := public._kitty_holder(p_group);
  v_id uuid;
begin
  if exists (select 1 from jsonb_array_elements(p_parts) p
             where (p ->> 'paid')::bigint > 0 and (p ->> 'person_id')::uuid <> v_holder) then
    raise exception 'kitty_payer' using errcode = 'P0001';
  end if;
  v_id := public.save_expense(null, p_description, p_amount, p_occurred_on, p_group, p_split_mode, p_parts, null);
  update public.entries set kitty = true where id = v_id;
  return v_id;
end;
$$;

create function public.group_kitty(p_group uuid)
returns table (holder_id uuid, collected bigint, spent bigint)
language sql stable security definer set search_path = ''
as $$
  select g.kitty_holder,
         coalesce((select sum(e.amount) from public.entries e
                   where e.group_id = g.id and e.kitty and e.kind = 'payment' and e.deleted_at is null), 0)::bigint,
         coalesce((select sum(e.amount) from public.entries e
                   where e.group_id = g.id and e.kitty and e.kind = 'expense' and e.deleted_at is null), 0)::bigint
  from public.groups g
  where g.id = p_group and public.is_group_member(p_group)
$$;

------------------------------------------------------------------------------
-- Recurring monthly expenses (rent, WiFi, cook, Netflix)
------------------------------------------------------------------------------

create function public._next_month_day(p_from date, p_day integer) returns date
language sql immutable set search_path = ''
as $$
  select (date_trunc('month', p_from) + interval '1 month')::date + (p_day - 1)
$$;

create function public.save_recurring(
  p_id uuid, p_group uuid, p_description text, p_amount bigint, p_split_mode text,
  p_parts jsonb, p_day_of_month integer, p_start_on date
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_id uuid := p_id;
  v_first date;
begin
  if not public.is_group_member(p_group) then
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;
  if (select sum((p ->> 'paid')::bigint) from jsonb_array_elements(p_parts) p) <> p_amount
     or (select sum((p ->> 'owed')::bigint) from jsonb_array_elements(p_parts) p) <> p_amount then
    raise exception 'split_mismatch' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_parts) p
             where not exists (select 1 from public.group_members gm
                               where gm.group_id = p_group and gm.person_id = (p ->> 'person_id')::uuid)) then
    raise exception 'not_group_member' using errcode = 'P0001';
  end if;

  -- First occurrence: this month's day if still ahead (or today), else next month's.
  v_first := date_trunc('month', coalesce(p_start_on, current_date))::date + (p_day_of_month - 1);
  if v_first < coalesce(p_start_on, current_date) then
    v_first := public._next_month_day(v_first, p_day_of_month);
  end if;

  if v_id is null then
    insert into public.recurring_rules (group_id, created_by, description, amount, split_mode, parts, day_of_month, next_on)
    values (p_group, v_me, btrim(p_description), p_amount, p_split_mode, p_parts, p_day_of_month, v_first)
    returning id into v_id;
  else
    update public.recurring_rules
       set description = btrim(p_description), amount = p_amount, split_mode = p_split_mode,
           parts = p_parts, day_of_month = p_day_of_month, next_on = v_first
     where id = v_id and group_id = p_group;
    if not found then
      raise exception 'recurring_not_found' using errcode = 'P0001';
    end if;
  end if;
  return v_id;
end;
$$;

create function public.stop_recurring(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.recurring_rules set active = false
   where id = p_id and public.is_group_member(group_id);
  if not found then
    raise exception 'recurring_not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- Posts every due occurrence. Any member's app calls this on open, so no
-- server-side scheduler is needed; row locks make concurrent calls safe.
create function public.run_due_recurring() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_rule public.recurring_rules;
  v_posted integer := 0;
  v_rounds integer;
begin
  for v_rule in
    select r.* from public.recurring_rules r
    where r.active and r.next_on <= current_date
      and exists (select 1 from public.group_members gm where gm.group_id = r.group_id and gm.person_id = v_me)
      and exists (select 1 from jsonb_array_elements(r.parts) p where (p ->> 'person_id')::uuid = v_me)
    for update skip locked
  loop
    v_rounds := 0;
    while v_rule.next_on <= current_date and v_rounds < 12 loop
      perform public.save_expense(
        null, v_rule.description || ' · ' || to_char(v_rule.next_on, 'Mon YYYY'), v_rule.amount,
        v_rule.next_on, v_rule.group_id, v_rule.split_mode, v_rule.parts, null);
      v_rule.next_on := public._next_month_day(v_rule.next_on, v_rule.day_of_month);
      v_rounds := v_rounds + 1;
      v_posted := v_posted + 1;
    end loop;
    update public.recurring_rules set next_on = v_rule.next_on where id = v_rule.id;
  end loop;
  return v_posted;
end;
$$;

------------------------------------------------------------------------------
-- Push notifications
------------------------------------------------------------------------------

create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language sql security definer set search_path = ''
as $$
  insert into public.push_subscriptions (endpoint, person_id, p256dh, auth)
  values (p_endpoint, public.require_me(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set person_id = excluded.person_id, p256dh = excluded.p256dh, auth = excluded.auth
$$;

create function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and person_id = public.require_me()
$$;

-- Who to notify about one activity event, and what it means for each of them.
-- Used by the "notify" Edge Function with the service role only.
create function public.push_targets(p_event bigint)
returns table (
  endpoint text, p256dh text, auth text, person_id uuid,
  actor_name text, action text, kind text, description text, amount bigint, my_delta bigint, entry_id uuid
)
language sql stable security definer set search_path = ''
as $$
  select s.endpoint, s.p256dh, s.auth, ep.person_id,
         coalesce(c.nickname, actor.name), ev.action, e.kind, e.description, e.amount,
         coalesce((select sum(case when l.creditor_id = ep.person_id then l.amount else -l.amount end)
                   from public.ledger_lines l
                   where l.entry_id = e.id and ep.person_id in (l.debtor_id, l.creditor_id)), 0)::bigint,
         e.id
  from public.entry_events ev
  join public.entries e on e.id = ev.entry_id
  join public.people actor on actor.id = ev.actor_id
  join public.entry_parts ep on ep.entry_id = e.id and ep.person_id <> ev.actor_id
  join public.push_subscriptions s on s.person_id = ep.person_id
  left join public.contacts c on c.owner_id = ep.person_id and c.person_id = ev.actor_id
  where ev.id = p_event
$$;

-- Weekly digest: each subscriber's totals. Service role only.
create function public.digest_targets()
returns table (endpoint text, p256dh text, auth text, person_id uuid, owed_to_me bigint, i_owe bigint, people_count integer)
language sql stable security definer set search_path = ''
as $$
  with nets as (
    select x.me, x.other, sum(x.delta) as net
    from (
      select l.creditor_id as me, l.debtor_id as other, l.amount as delta, l.entry_id from public.ledger_lines l
      union all
      select l.debtor_id, l.creditor_id, -l.amount, l.entry_id from public.ledger_lines l
    ) x
    join public.entries e on e.id = x.entry_id and e.deleted_at is null
    group by x.me, x.other
  )
  select s.endpoint, s.p256dh, s.auth, s.person_id,
         coalesce(sum(n.net) filter (where n.net > 0), 0)::bigint,
         coalesce(-sum(n.net) filter (where n.net < 0), 0)::bigint,
         (count(*) filter (where n.net <> 0))::integer
  from public.push_subscriptions s
  left join nets n on n.me = s.person_id
  group by s.endpoint, s.p256dh, s.auth, s.person_id
$$;

-- Lets the sender drop subscriptions the push service says are gone.
create function public.drop_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint
$$;

------------------------------------------------------------------------------
-- Function privileges
------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.me(),
  public.claim_profile(text, text, text),
  public.add_contact(text, text),
  public.set_nickname(uuid, text),
  public.my_people(),
  public.save_household(uuid, text, uuid[]),
  public.delete_household(uuid),
  public.create_group(text, text, uuid[]),
  public.update_group(uuid, text, text, uuid[]),
  public.save_expense(uuid, text, bigint, date, uuid, text, jsonb, integer),
  public.save_payment(uuid, uuid, uuid, bigint, date, text, text, jsonb, uuid, integer),
  public.delete_entry(uuid),
  public.restore_entry(uuid),
  public.my_balances(),
  public.person_ledger(uuid),
  public.group_balances(uuid),
  public.my_activity(integer, bigint),
  public.is_entry_participant(uuid),
  public.is_group_member(uuid),
  public.can_see_person(uuid),
  public.set_contact_prefs(uuid, text, bigint, bigint, integer),
  public.mark_nudged(uuid),
  public.set_group_prefs(uuid, text, bigint, uuid),
  public.forgive_balance(uuid, bigint, text),
  public.save_treat(uuid, bigint, text, text, date, uuid[], uuid),
  public.treat_summary(uuid),
  public.save_shortcut(text, text, bigint, uuid, jsonb),
  public.delete_shortcut(uuid),
  public.react_to_entry(uuid, text, text),
  public.my_reviews(),
  public.create_share_link(uuid),
  public.revoke_share_link(uuid),
  public.add_to_kitty(uuid, uuid, bigint, date, text),
  public.save_kitty_expense(text, bigint, date, uuid, text, jsonb),
  public.group_kitty(uuid),
  public.save_recurring(uuid, uuid, text, bigint, text, jsonb, integer, date),
  public.stop_recurring(uuid),
  public.run_due_recurring(),
  public.save_push_subscription(text, text, text),
  public.delete_push_subscription(text)
to authenticated;
-- The only things someone without an account can do, and only with a valid link.
grant execute on function public.shared_view(text), public.shared_react(text, uuid, text, text) to anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.push_targets(bigint), public.digest_targets(), public.drop_push_subscription(text) to service_role;
  end if;
end;
$$;
