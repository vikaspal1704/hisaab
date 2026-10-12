-- Hisaab: a shared ledger between friends.
--
-- Design notes
-- * Money is stored as integer paise (bigint). Never floats.
-- * Every money event is an `entry` (expense or payment). Each entry produces
--   immutable pairwise `ledger_lines` ("debtor owes creditor amount").
--   Balances are always derived from lines of non-deleted entries.
-- * People are identified by phone number. A `people` row can exist before
--   that person signs up; when they sign up and claim the number they see
--   their whole history.
-- * Clients only read tables (through RLS). All writes go through the
--   SECURITY DEFINER functions below, which validate every invariant.

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

create table public.people (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text not null,
  user_id uuid unique references auth.users (id) on delete set null,
  upi_id text,
  created_at timestamptz not null default now(),
  constraint people_phone_format check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint people_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint people_upi_format check (
    upi_id is null or upi_id ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,63}$'
  )
);

-- A person's personal address book. Nickname overrides the person's name for the owner.
create table public.contacts (
  owner_id uuid not null references public.people (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  nickname text,
  created_at timestamptz not null default now(),
  primary key (owner_id, person_id),
  constraint contacts_not_self check (owner_id <> person_id),
  constraint contacts_nickname_length check (
    nickname is null or char_length(btrim(nickname)) between 1 and 60
  )
);
create index contacts_person_idx on public.contacts (person_id);

-- Households ("pairs"): a personal grouping such as a couple or roommates whose
-- balances the owner wants to see and settle together. Owner-scoped, so nobody
-- needs anyone else's consent and it works for people not on the app yet.
create table public.households (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.people (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint households_name_length check (char_length(btrim(name)) between 1 and 60)
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  owner_id uuid not null references public.people (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  primary key (household_id, person_id),
  -- A person belongs to at most one of an owner's households.
  constraint household_members_one_per_owner unique (owner_id, person_id)
);

-- Groups are shared between members (e.g. "Friday gang", "Goa trip").
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emoji text,
  created_by uuid not null references public.people (id),
  created_at timestamptz not null default now(),
  constraint groups_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint groups_emoji_length check (emoji is null or char_length(emoji) <= 8)
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  added_by uuid references public.people (id),
  added_at timestamptz not null default now(),
  primary key (group_id, person_id)
);
create index group_members_person_idx on public.group_members (person_id);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  description text not null,
  amount bigint not null,
  occurred_on date not null default current_date,
  group_id uuid references public.groups (id) on delete set null,
  split_mode text,
  method text,
  created_by uuid not null references public.people (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.people (id),
  updated_at timestamptz,
  deleted_by uuid references public.people (id),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint entries_kind check (kind in ('expense', 'payment')),
  constraint entries_description_length check (char_length(btrim(description)) between 1 and 100),
  -- Up to ₹1 crore per entry.
  constraint entries_amount_range check (amount > 0 and amount <= 1000000000),
  constraint entries_split_mode check (
    (kind = 'expense' and split_mode in ('equal', 'exact', 'shares'))
    or (kind = 'payment' and split_mode is null)
  ),
  constraint entries_method check (
    (kind = 'payment' and method in ('cash', 'upi', 'bank', 'other'))
    or (kind = 'expense' and method is null)
  )
);
create index entries_group_idx on public.entries (group_id) where group_id is not null;

-- Who paid and who consumed. For payments: the payer has paid = amount and
-- the receiver has owed = amount; anyone else touched by the allocation is
-- listed with zeros so they can see the entry.
create table public.entry_parts (
  entry_id uuid not null references public.entries (id) on delete cascade,
  person_id uuid not null references public.people (id),
  paid bigint not null default 0,
  owed bigint not null default 0,
  shares numeric(8, 2),
  primary key (entry_id, person_id),
  constraint entry_parts_paid_nonneg check (paid >= 0),
  constraint entry_parts_owed_nonneg check (owed >= 0),
  constraint entry_parts_shares_positive check (shares is null or shares > 0)
);
create index entry_parts_person_idx on public.entry_parts (person_id);

-- For payments: which debts the payment clears ("debtor's debt to creditor
-- goes down by amount"). Kept so a payment can be shown and edited faithfully.
create table public.entry_allocations (
  entry_id uuid not null references public.entries (id) on delete cascade,
  debtor_id uuid not null references public.people (id),
  creditor_id uuid not null references public.people (id),
  amount bigint not null,
  constraint entry_allocations_positive check (amount > 0),
  constraint entry_allocations_distinct check (debtor_id <> creditor_id)
);
create index entry_allocations_entry_idx on public.entry_allocations (entry_id);

-- The ledger itself: "debtor owes creditor amount" because of entry.
create table public.ledger_lines (
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.entries (id) on delete cascade,
  debtor_id uuid not null references public.people (id),
  creditor_id uuid not null references public.people (id),
  amount bigint not null,
  constraint ledger_lines_positive check (amount > 0),
  constraint ledger_lines_distinct check (debtor_id <> creditor_id)
);
create index ledger_lines_entry_idx on public.ledger_lines (entry_id);
create index ledger_lines_debtor_idx on public.ledger_lines (debtor_id);
create index ledger_lines_creditor_idx on public.ledger_lines (creditor_id);

-- Audit trail. `before` holds the entry snapshot prior to an edit/delete.
create table public.entry_events (
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.entries (id) on delete cascade,
  actor_id uuid not null references public.people (id),
  action text not null,
  before jsonb,
  created_at timestamptz not null default now(),
  constraint entry_events_action check (action in ('created', 'edited', 'deleted', 'restored'))
);
create index entry_events_entry_idx on public.entry_events (entry_id);

------------------------------------------------------------------------------
-- Access helpers
------------------------------------------------------------------------------

-- The caller's person id, or null when they have not claimed a phone yet.
create function public.me() returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.id from public.people p where p.user_id = auth.uid()
$$;

create function public.require_me() returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := public.me();
begin
  if v_me is null then
    raise exception 'profile_required' using errcode = 'P0001';
  end if;
  return v_me;
end;
$$;

create function public.is_entry_participant(p_entry uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.entry_parts ep
    where ep.entry_id = p_entry and ep.person_id = public.me()
  )
$$;

create function public.is_group_member(p_group uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group and gm.person_id = public.me()
  )
$$;

-- A person is visible when they are me, in my contacts, or share an entry or group with me.
create function public.can_see_person(p_person uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_person = public.me()
    or exists (select 1 from public.contacts c where c.owner_id = public.me() and c.person_id = p_person)
    or exists (
      select 1 from public.entry_parts a
      join public.entry_parts b on b.entry_id = a.entry_id
      where a.person_id = public.me() and b.person_id = p_person
    )
    or exists (
      select 1 from public.group_members a
      join public.group_members b on b.group_id = a.group_id
      where a.person_id = public.me() and b.person_id = p_person
    )
$$;

------------------------------------------------------------------------------
-- Row level security: read-only access for clients.
------------------------------------------------------------------------------

alter table public.people enable row level security;
alter table public.contacts enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.entries enable row level security;
alter table public.entry_parts enable row level security;
alter table public.entry_allocations enable row level security;
alter table public.ledger_lines enable row level security;
alter table public.entry_events enable row level security;

create policy people_read on public.people for select to authenticated
  using (public.can_see_person(id));
create policy contacts_read on public.contacts for select to authenticated
  using (owner_id = public.me());
create policy households_read on public.households for select to authenticated
  using (owner_id = public.me());
create policy household_members_read on public.household_members for select to authenticated
  using (owner_id = public.me());
create policy groups_read on public.groups for select to authenticated
  using (public.is_group_member(id));
create policy group_members_read on public.group_members for select to authenticated
  using (public.is_group_member(group_id));
create policy entries_read on public.entries for select to authenticated
  using (public.is_entry_participant(id));
create policy entry_parts_read on public.entry_parts for select to authenticated
  using (public.is_entry_participant(entry_id));
create policy entry_allocations_read on public.entry_allocations for select to authenticated
  using (public.is_entry_participant(entry_id));
create policy ledger_lines_read on public.ledger_lines for select to authenticated
  using (public.is_entry_participant(entry_id));
create policy entry_events_read on public.entry_events for select to authenticated
  using (public.is_entry_participant(entry_id));

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
-- Phone numbers are exposed through my_people() (masked for non-contacts) instead.
revoke select on public.people from authenticated;
grant select (id, name, created_at) on public.people to authenticated;

------------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
------------------------------------------------------------------------------

-- Validates that every id may be put on an entry by the caller: themselves,
-- their contacts, members of the given group, or people already on the entry.
create function public._assert_allowed_people(p_people uuid[], p_group uuid, p_entry uuid)
returns void
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_bad uuid;
begin
  select x into v_bad
  from unnest(p_people) as x
  where x <> v_me
    and not exists (select 1 from public.contacts c where c.owner_id = v_me and c.person_id = x)
    and not (p_group is not null and exists (
      select 1 from public.group_members gm where gm.group_id = p_group and gm.person_id = x))
    and not (p_entry is not null and exists (
      select 1 from public.entry_parts ep where ep.entry_id = p_entry and ep.person_id = x))
  limit 1;
  if v_bad is not null then
    raise exception 'unknown_person' using errcode = 'P0001';
  end if;
end;
$$;

-- Everybody on an entry becomes a contact of everybody else on it, so the
-- relationship shows up on both dashboards.
create function public._link_participants(p_entry uuid) returns void
language sql security definer set search_path = ''
as $$
  insert into public.contacts (owner_id, person_id)
  select a.person_id, b.person_id
  from public.entry_parts a
  join public.entry_parts b on b.entry_id = a.entry_id and b.person_id <> a.person_id
  where a.entry_id = p_entry
  on conflict do nothing
$$;

-- Writes lines for an entry from (debtor, creditor, amount) rows, netting
-- opposite directions per pair so each pair has at most one line.
create function public._write_lines(p_entry uuid, p_lines jsonb) returns void
language sql security definer set search_path = ''
as $$
  insert into public.ledger_lines (entry_id, debtor_id, creditor_id, amount)
  select p_entry,
         case when s.net > 0 then s.a else s.b end,
         case when s.net > 0 then s.b else s.a end,
         abs(s.net)
  from (
    select least(l.debtor, l.creditor) as a,
           greatest(l.debtor, l.creditor) as b,
           sum(case when l.debtor < l.creditor then l.amount else -l.amount end) as net
    from jsonb_to_recordset(p_lines) as l (debtor uuid, creditor uuid, amount bigint)
    group by 1, 2
  ) s
  where s.net <> 0
$$;

-- Turns per-person net positions (paid - owed) into the fewest pairwise lines
-- by greedily matching the largest debtor with the largest creditor. With a
-- single payer this is exactly "everyone owes the payer their share".
create function public._expense_lines(p_parts jsonb) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  v_creditors uuid[];
  v_credit bigint[];
  v_debtors uuid[];
  v_debt bigint[];
  i integer := 1;
  j integer := 1;
  v_take bigint;
  v_lines jsonb := '[]'::jsonb;
begin
  select coalesce(array_agg(person_id order by net desc, person_id), '{}'),
         coalesce(array_agg(net order by net desc, person_id), '{}')
    into v_creditors, v_credit
  from (select (p ->> 'person_id')::uuid as person_id,
               (p ->> 'paid')::bigint - (p ->> 'owed')::bigint as net
        from jsonb_array_elements(p_parts) p) x
  where net > 0;

  select coalesce(array_agg(person_id order by net asc, person_id), '{}'),
         coalesce(array_agg(-net order by net asc, person_id), '{}')
    into v_debtors, v_debt
  from (select (p ->> 'person_id')::uuid as person_id,
               (p ->> 'paid')::bigint - (p ->> 'owed')::bigint as net
        from jsonb_array_elements(p_parts) p) x
  where net < 0;

  while i <= coalesce(array_length(v_debtors, 1), 0) and j <= coalesce(array_length(v_creditors, 1), 0) loop
    v_take := least(v_debt[i], v_credit[j]);
    v_lines := v_lines || jsonb_build_object(
      'debtor', v_debtors[i], 'creditor', v_creditors[j], 'amount', v_take);
    v_debt[i] := v_debt[i] - v_take;
    v_credit[j] := v_credit[j] - v_take;
    if v_debt[i] = 0 then i := i + 1; end if;
    if v_credit[j] = 0 then j := j + 1; end if;
  end loop;

  return v_lines;
end;
$$;

create function public._entry_snapshot(p_entry uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'entry', to_jsonb(e),
    'parts', coalesce((select jsonb_agg(to_jsonb(ep) order by ep.person_id)
                       from public.entry_parts ep where ep.entry_id = e.id), '[]'),
    'allocations', coalesce((select jsonb_agg(to_jsonb(ea))
                             from public.entry_allocations ea where ea.entry_id = e.id), '[]')
  )
  from public.entries e where e.id = p_entry
$$;

-- Locks an existing entry for editing and checks the caller may change it.
create function public._lock_entry_for_edit(p_entry uuid, p_kind text, p_expected_version integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_entry public.entries;
begin
  select * into v_entry from public.entries where id = p_entry for update;
  if not found or not public.is_entry_participant(p_entry) then
    raise exception 'entry_not_found' using errcode = 'P0001';
  end if;
  if v_entry.kind <> p_kind then
    raise exception 'wrong_kind' using errcode = 'P0001';
  end if;
  if v_entry.deleted_at is not null then
    raise exception 'entry_deleted' using errcode = 'P0001';
  end if;
  if p_expected_version is not null and v_entry.version <> p_expected_version then
    raise exception 'stale_entry' using errcode = 'P0001';
  end if;
end;
$$;

------------------------------------------------------------------------------
-- Profile & contacts
------------------------------------------------------------------------------

-- Called after sign-in. Links the account to the person with this phone
-- (creating it if nobody added them yet), or updates the existing profile.
create function public.claim_profile(p_name text, p_phone text, p_upi_id text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_verified_phone text := nullif(auth.jwt() ->> 'phone', '');
  v_person public.people;
  v_existing uuid := public.me();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  if v_existing is not null then
    update public.people
       set name = btrim(p_name), upi_id = nullif(btrim(p_upi_id), '')
     where id = v_existing;
    return v_existing;
  end if;

  -- With SMS login the number is verified and must be the one claimed.
  if v_verified_phone is not null and '+' || ltrim(v_verified_phone, '+') <> p_phone then
    raise exception 'phone_mismatch' using errcode = 'P0001';
  end if;

  select * into v_person from public.people where phone = p_phone for update;
  if found then
    if v_person.user_id is not null then
      raise exception 'phone_taken' using errcode = 'P0001';
    end if;
    update public.people
       set user_id = v_uid, name = btrim(p_name), upi_id = nullif(btrim(p_upi_id), '')
     where id = v_person.id;
    return v_person.id;
  end if;

  insert into public.people (phone, name, user_id, upi_id)
  values (p_phone, btrim(p_name), v_uid, nullif(btrim(p_upi_id), ''))
  returning id into v_existing;
  return v_existing;
end;
$$;

-- Adds a friend by phone. Returns their person id.
create function public.add_contact(p_phone text, p_name text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_person uuid;
begin
  insert into public.people (phone, name) values (p_phone, btrim(p_name))
  on conflict (phone) do nothing;
  select id into v_person from public.people where phone = p_phone;

  if v_person = v_me then
    raise exception 'cannot_add_self' using errcode = 'P0001';
  end if;

  insert into public.contacts (owner_id, person_id, nickname)
  values (v_me, v_person, btrim(p_name))
  on conflict (owner_id, person_id) do update set nickname = excluded.nickname;
  return v_person;
end;
$$;

create function public.set_nickname(p_person uuid, p_nickname text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
begin
  update public.contacts set nickname = nullif(btrim(p_nickname), '')
   where owner_id = v_me and person_id = p_person;
  if not found then
    raise exception 'unknown_person' using errcode = 'P0001';
  end if;
end;
$$;

-- Everyone the caller can see, with the name the caller knows them by.
-- Phone numbers of people who are not the caller's contacts are masked.
create function public.my_people()
returns table (
  id uuid, display_name text, phone text, upi_id text,
  is_registered boolean, is_contact boolean, is_me boolean
)
language sql stable security definer set search_path = ''
as $$
  with me as (select public.me() as id),
  visible as (
    -- Same rules as can_see_person(), but starting from my own rows instead of scanning everyone.
    select me.id as person_id from me where me.id is not null
    union select c.person_id from public.contacts c, me where c.owner_id = me.id
    union select b.person_id from public.entry_parts a
          join public.entry_parts b on b.entry_id = a.entry_id, me
          where a.person_id = me.id
    union select b.person_id from public.group_members a
          join public.group_members b on b.group_id = a.group_id, me
          where a.person_id = me.id
  )
  select p.id,
         coalesce(c.nickname, p.name),
         case when c.person_id is not null or p.id = me.id then p.phone
              else left(p.phone, 5) || repeat('•', greatest(char_length(p.phone) - 8, 0)) || right(p.phone, 3)
         end,
         p.upi_id,
         p.user_id is not null,
         c.person_id is not null,
         p.id = me.id
  from visible v
  join public.people p on p.id = v.person_id
  cross join me
  left join public.contacts c on c.owner_id = me.id and c.person_id = p.id
$$;

------------------------------------------------------------------------------
-- Households
------------------------------------------------------------------------------

create function public.save_household(p_id uuid, p_name text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_id uuid := p_id;
begin
  if cardinality(p_members) < 2 or cardinality(p_members) > 6
     or cardinality(p_members) <> (select count(distinct x) from unnest(p_members) x) then
    raise exception 'household_size' using errcode = 'P0001';
  end if;
  perform public._assert_allowed_people(p_members, null, null);

  if v_id is null then
    insert into public.households (owner_id, name) values (v_me, btrim(p_name)) returning id into v_id;
  else
    update public.households set name = btrim(p_name) where id = v_id and owner_id = v_me;
    if not found then
      raise exception 'household_not_found' using errcode = 'P0001';
    end if;
    delete from public.household_members where household_id = v_id;
  end if;

  begin
    insert into public.household_members (household_id, owner_id, person_id)
    select v_id, v_me, x from unnest(p_members) x;
  exception when unique_violation then
    raise exception 'already_in_household' using errcode = 'P0001';
  end;
  return v_id;
end;
$$;

create function public.delete_household(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.households where id = p_id and owner_id = public.require_me();
end;
$$;

------------------------------------------------------------------------------
-- Groups
------------------------------------------------------------------------------

create function public.create_group(p_name text, p_emoji text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_id uuid;
begin
  perform public._assert_allowed_people(p_members, null, null);
  insert into public.groups (name, emoji, created_by)
  values (btrim(p_name), nullif(btrim(p_emoji), ''), v_me) returning id into v_id;
  insert into public.group_members (group_id, person_id, added_by)
  select v_id, x, v_me from (select v_me as x union select unnest(p_members)) m;
  return v_id;
end;
$$;

create function public.update_group(p_group uuid, p_name text, p_emoji text, p_add_members uuid[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
begin
  if not public.is_group_member(p_group) then
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;
  perform public._assert_allowed_people(coalesce(p_add_members, '{}'), null, null);
  update public.groups set name = btrim(p_name), emoji = nullif(btrim(p_emoji), '') where id = p_group;
  insert into public.group_members (group_id, person_id, added_by)
  select p_group, x, v_me from unnest(coalesce(p_add_members, '{}')) x
  on conflict do nothing;
end;
$$;

------------------------------------------------------------------------------
-- Expenses & payments
------------------------------------------------------------------------------

-- Creates (p_entry is null) or edits an expense.
-- p_parts: [{"person_id": uuid, "paid": paise, "owed": paise, "shares": number|null}]
create function public.save_expense(
  p_entry uuid,
  p_description text,
  p_amount bigint,
  p_occurred_on date,
  p_group uuid,
  p_split_mode text,
  p_parts jsonb,
  p_expected_version integer default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_id uuid := p_entry;
  v_people uuid[];
  v_paid bigint;
  v_owed bigint;
  v_lines jsonb;
  v_before jsonb;
begin
  if jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) > 50 then
    raise exception 'invalid_parts' using errcode = 'P0001';
  end if;

  select array_agg((p ->> 'person_id')::uuid),
         sum((p ->> 'paid')::bigint),
         sum((p ->> 'owed')::bigint)
    into v_people, v_paid, v_owed
  from jsonb_array_elements(p_parts) p;

  if v_people is null
     or cardinality(v_people) <> (select count(distinct x) from unnest(v_people) x)
     or exists (select 1 from jsonb_array_elements(p_parts) p
                where (p ->> 'paid')::bigint < 0 or (p ->> 'owed')::bigint < 0) then
    raise exception 'invalid_parts' using errcode = 'P0001';
  end if;
  if v_paid <> p_amount or v_owed <> p_amount then
    raise exception 'split_mismatch' using errcode = 'P0001';
  end if;
  if not (v_me = any (v_people)) then
    raise exception 'must_participate' using errcode = 'P0001';
  end if;
  if p_group is not null then
    if not public.is_group_member(p_group) then
      raise exception 'group_not_found' using errcode = 'P0001';
    end if;
    if exists (select 1 from unnest(v_people) x
               where not exists (select 1 from public.group_members gm
                                 where gm.group_id = p_group and gm.person_id = x)) then
      raise exception 'not_group_member' using errcode = 'P0001';
    end if;
  end if;

  v_lines := public._expense_lines(p_parts);
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'nothing_to_split' using errcode = 'P0001';
  end if;

  if v_id is null then
    perform public._assert_allowed_people(v_people, p_group, null);
    insert into public.entries (kind, description, amount, occurred_on, group_id, split_mode, created_by)
    values ('expense', btrim(p_description), p_amount, coalesce(p_occurred_on, current_date),
            p_group, p_split_mode, v_me)
    returning id into v_id;
  else
    perform public._lock_entry_for_edit(v_id, 'expense', p_expected_version);
    perform public._assert_allowed_people(v_people, p_group, v_id);
    v_before := public._entry_snapshot(v_id);
    update public.entries
       set description = btrim(p_description), amount = p_amount,
           occurred_on = coalesce(p_occurred_on, occurred_on), group_id = p_group,
           split_mode = p_split_mode, updated_by = v_me, updated_at = now(),
           version = version + 1
     where id = v_id;
    delete from public.ledger_lines where entry_id = v_id;
    delete from public.entry_parts where entry_id = v_id;
  end if;

  insert into public.entry_parts (entry_id, person_id, paid, owed, shares)
  select v_id, (p ->> 'person_id')::uuid, (p ->> 'paid')::bigint, (p ->> 'owed')::bigint,
         (p ->> 'shares')::numeric
  from jsonb_array_elements(p_parts) p;

  perform public._write_lines(v_id, v_lines);
  perform public._link_participants(v_id);

  insert into public.entry_events (entry_id, actor_id, action, before)
  values (v_id, v_me, case when p_entry is null then 'created' else 'edited' end, v_before);
  return v_id;
end;
$$;

-- Creates or edits a payment of p_amount from p_from to p_to.
-- p_allocations (optional): [{"debtor": uuid, "creditor": uuid, "amount": paise}]
-- says which debts the payment clears. Default: p_from's debt to p_to.
-- Paying on behalf of someone (e.g. one half of a couple settling for both)
-- is expressed with several allocations. Whatever the allocations, each
-- person's net effect must equal what they actually paid or received.
create function public.save_payment(
  p_entry uuid,
  p_from uuid,
  p_to uuid,
  p_amount bigint,
  p_occurred_on date,
  p_method text,
  p_note text default null,
  p_allocations jsonb default null,
  p_group uuid default null,
  p_expected_version integer default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_id uuid := p_entry;
  v_alloc jsonb := coalesce(p_allocations,
    jsonb_build_array(jsonb_build_object('debtor', p_from, 'creditor', p_to, 'amount', p_amount)));
  v_people uuid[];
  v_before jsonb;
begin
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'invalid_payment' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_alloc) <> 'array' or jsonb_array_length(v_alloc) = 0
     or jsonb_array_length(v_alloc) > 50
     or exists (select 1 from jsonb_to_recordset(v_alloc) a (debtor uuid, creditor uuid, amount bigint)
                where a.amount is null or a.amount <= 0 or a.debtor is null or a.creditor is null
                   or a.debtor = a.creditor) then
    raise exception 'invalid_allocations' using errcode = 'P0001';
  end if;

  -- Conservation: clearing "debtor owes creditor x" moves debtor by +x and
  -- creditor by -x. The payer must end up +amount, the receiver -amount,
  -- and everyone else unchanged.
  if exists (
    select 1 from (
      select person, sum(delta) as delta from (
        select a.debtor as person, a.amount as delta
          from jsonb_to_recordset(v_alloc) a (debtor uuid, creditor uuid, amount bigint)
        union all
        select a.creditor, -a.amount
          from jsonb_to_recordset(v_alloc) a (debtor uuid, creditor uuid, amount bigint)
        union all select p_from, -p_amount
        union all select p_to, p_amount
      ) d group by person
    ) s where s.delta <> 0
  ) then
    raise exception 'allocation_mismatch' using errcode = 'P0001';
  end if;

  select array_agg(distinct x) into v_people from (
    select p_from as x union select p_to
    union select a.debtor from jsonb_to_recordset(v_alloc) a (debtor uuid, creditor uuid, amount bigint)
    union select a.creditor from jsonb_to_recordset(v_alloc) a (debtor uuid, creditor uuid, amount bigint)
  ) s;

  if not (v_me = any (v_people)) then
    raise exception 'must_participate' using errcode = 'P0001';
  end if;
  if p_group is not null and not public.is_group_member(p_group) then
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;

  if v_id is null then
    perform public._assert_allowed_people(v_people, p_group, null);
    insert into public.entries (kind, description, amount, occurred_on, group_id, method, created_by)
    values ('payment', coalesce(nullif(btrim(p_note), ''), 'Payment'), p_amount,
            coalesce(p_occurred_on, current_date), p_group, p_method, v_me)
    returning id into v_id;
  else
    perform public._lock_entry_for_edit(v_id, 'payment', p_expected_version);
    perform public._assert_allowed_people(v_people, p_group, v_id);
    v_before := public._entry_snapshot(v_id);
    update public.entries
       set description = coalesce(nullif(btrim(p_note), ''), 'Payment'), amount = p_amount,
           occurred_on = coalesce(p_occurred_on, occurred_on), group_id = p_group,
           method = p_method, updated_by = v_me, updated_at = now(), version = version + 1
     where id = v_id;
    delete from public.ledger_lines where entry_id = v_id;
    delete from public.entry_parts where entry_id = v_id;
    delete from public.entry_allocations where entry_id = v_id;
  end if;

  insert into public.entry_parts (entry_id, person_id, paid, owed)
  select v_id, x,
         case when x = p_from then p_amount else 0 end,
         case when x = p_to then p_amount else 0 end
  from unnest(v_people) x;

  insert into public.entry_allocations (entry_id, debtor_id, creditor_id, amount)
  select v_id, a.debtor, a.creditor, a.amount
  from jsonb_to_recordset(v_alloc) a (debtor uuid, creditor uuid, amount bigint);

  -- Clearing "debtor owes creditor" is recorded as the opposite line.
  perform public._write_lines(v_id, (
    select jsonb_agg(jsonb_build_object('debtor', a.creditor, 'creditor', a.debtor, 'amount', a.amount))
    from jsonb_to_recordset(v_alloc) a (debtor uuid, creditor uuid, amount bigint)
  ));
  perform public._link_participants(v_id);

  insert into public.entry_events (entry_id, actor_id, action, before)
  values (v_id, v_me, case when p_entry is null then 'created' else 'edited' end, v_before);
  return v_id;
end;
$$;

create function public.delete_entry(p_entry uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
begin
  perform 1 from public.entries where id = p_entry and deleted_at is null for update;
  if not found or not public.is_entry_participant(p_entry) then
    raise exception 'entry_not_found' using errcode = 'P0001';
  end if;
  insert into public.entry_events (entry_id, actor_id, action, before)
  values (p_entry, v_me, 'deleted', public._entry_snapshot(p_entry));
  update public.entries
     set deleted_at = now(), deleted_by = v_me, version = version + 1
   where id = p_entry;
end;
$$;

create function public.restore_entry(p_entry uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
begin
  perform 1 from public.entries where id = p_entry and deleted_at is not null for update;
  if not found or not public.is_entry_participant(p_entry) then
    raise exception 'entry_not_found' using errcode = 'P0001';
  end if;
  update public.entries
     set deleted_at = null, deleted_by = null, version = version + 1
   where id = p_entry;
  insert into public.entry_events (entry_id, actor_id, action)
  values (p_entry, v_me, 'restored');
end;
$$;

------------------------------------------------------------------------------
-- Read models
------------------------------------------------------------------------------

-- Lines from the caller's point of view: positive = other person owes me.
create function public._my_deltas()
returns table (entry_id uuid, other_id uuid, delta bigint)
language sql stable security definer set search_path = ''
as $$
  select l.entry_id, l.debtor_id, l.amount
  from public.ledger_lines l
  join public.entries e on e.id = l.entry_id and e.deleted_at is null
  where l.creditor_id = public.me()
  union all
  select l.entry_id, l.creditor_id, -l.amount
  from public.ledger_lines l
  join public.entries e on e.id = l.entry_id and e.deleted_at is null
  where l.debtor_id = public.me()
$$;

-- Net balance with everyone the caller has a ledger with. Positive = they owe me.
create function public.my_balances()
returns table (person_id uuid, net bigint, last_activity timestamptz)
language sql stable security definer set search_path = ''
as $$
  select d.other_id, sum(d.delta)::bigint, max(coalesce(e.updated_at, e.created_at))
  from public._my_deltas() d
  join public.entries e on e.id = d.entry_id
  group by d.other_id
$$;

-- Passbook with one person: every entry that changed our balance, oldest
-- first, with the running balance after it. Positive = they owe me.
create function public.person_ledger(p_other uuid)
returns table (
  entry_id uuid, kind text, description text, occurred_on date, created_at timestamptz,
  amount bigint, method text, delta bigint, running bigint
)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.kind, e.description, e.occurred_on, e.created_at, e.amount, e.method, d.delta,
         sum(d.delta) over (order by e.occurred_on, e.created_at, e.id)::bigint
  from (select entry_id, sum(delta)::bigint as delta from public._my_deltas()
        where other_id = p_other group by entry_id) d
  join public.entries e on e.id = d.entry_id
  order by e.occurred_on, e.created_at, e.id
$$;

-- Balances inside a group, from that group's entries only (so private debts
-- between two members never leak to the rest). Positive = member is owed.
create function public.group_balances(p_group uuid)
returns table (person_id uuid, net bigint, paid_total bigint, owed_total bigint)
language sql stable security definer set search_path = ''
as $$
  select gm.person_id,
         coalesce((select sum(case when l.creditor_id = gm.person_id then l.amount else -l.amount end)
                   from public.ledger_lines l
                   join public.entries e on e.id = l.entry_id
                   where e.group_id = p_group and e.deleted_at is null
                     and gm.person_id in (l.debtor_id, l.creditor_id)), 0)::bigint,
         coalesce((select sum(ep.paid) from public.entry_parts ep
                   join public.entries e on e.id = ep.entry_id
                   where e.group_id = p_group and e.deleted_at is null and e.kind = 'expense'
                     and ep.person_id = gm.person_id), 0)::bigint,
         coalesce((select sum(ep.owed) from public.entry_parts ep
                   join public.entries e on e.id = ep.entry_id
                   where e.group_id = p_group and e.deleted_at is null and e.kind = 'expense'
                     and ep.person_id = gm.person_id), 0)::bigint
  from public.group_members gm
  where gm.group_id = p_group and public.is_group_member(p_group)
$$;

-- Activity feed: newest events on the caller's entries, with what each entry
-- currently means for the caller (positive = I'm owed more).
create function public.my_activity(p_limit integer default 50, p_before bigint default null)
returns table (
  event_id bigint, action text, actor_id uuid, at timestamptz,
  entry_id uuid, kind text, description text, amount bigint, occurred_on date,
  is_deleted boolean, my_delta bigint
)
language sql stable security definer set search_path = ''
as $$
  select ev.id, ev.action, ev.actor_id, ev.created_at,
         e.id, e.kind, e.description, e.amount, e.occurred_on, e.deleted_at is not null,
         coalesce((select sum(case when l.creditor_id = public.me() then l.amount else -l.amount end)
                   from public.ledger_lines l
                   where l.entry_id = e.id and public.me() in (l.debtor_id, l.creditor_id)), 0)::bigint
  from public.entry_parts ep
  join public.entry_events ev on ev.entry_id = ep.entry_id
  join public.entries e on e.id = ev.entry_id
  where ep.person_id = public.me()
    and (p_before is null or ev.id < p_before)
  order by ev.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
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
  public.my_activity(integer, bigint)
to authenticated;
-- RLS policies call these helpers as the querying role.
grant execute on function
  public.is_entry_participant(uuid),
  public.is_group_member(uuid),
  public.can_see_person(uuid)
to authenticated;

-- Live updates: clients listen for new events and refetch.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.entry_events;
  end if;
end;
$$;
