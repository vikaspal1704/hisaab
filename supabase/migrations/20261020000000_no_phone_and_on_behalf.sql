-- Hisaab v9: friends without a number, and expenses logged for others.
--
-- * A friend can be added by name only (the cook, a friend-of-a-friend on a
--   trip). Their number can be added later by whoever added them; if that
--   number is already in Hisaab, the two records become one and all history
--   follows. Anyone signing up still needs a number.
-- * An expense no longer has to include the person logging it ("Rahul paid
--   for Priya's ticket" can be logged by their flatmate). Whoever logs an
--   entry can always see and fix it; the people on it see it in "To check".
--
-- Additive; safe to run on a live database.

------------------------------------------------------------------------------
-- Friends without a number
------------------------------------------------------------------------------

alter table public.people
  alter column phone drop not null,
  -- Who created a number-less friend; only they may give them a number.
  add column added_by uuid references public.people (id) on delete set null,
  -- Signing up always claims a number.
  add constraint people_registered_has_phone check (user_id is null or phone is not null);

-- Adds a friend who has no number (yet). Returns their person id.
create function public.add_contact_by_name(p_name text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_person uuid;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  insert into public.people (name, added_by) values (btrim(p_name), v_me) returning id into v_person;
  insert into public.contacts (owner_id, person_id, nickname) values (v_me, v_person, btrim(p_name));
  return v_person;
end;
$$;

-- Folds p_from (a number-less friend) into p_into: every entry, group,
-- contact and setting that mentions p_from now mentions p_into, then p_from
-- is removed. Fails when both are on the same entry, since merging would
-- make one person owe themselves.
create function public._merge_person(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_from = p_into then
    return;
  end if;
  if exists (select 1 from public.entry_parts a
             join public.entry_parts b on b.entry_id = a.entry_id
             where a.person_id = p_from and b.person_id = p_into)
     or exists (select 1 from public.entry_allocations
                where p_from in (debtor_id, creditor_id) and p_into in (debtor_id, creditor_id))
     or exists (select 1 from public.carpool_trips
                where (driver_id = p_from or p_from = any (riders))
                  and (driver_id = p_into or p_into = any (riders))) then
    raise exception 'merge_conflict' using errcode = 'P0001';
  end if;

  update public.entry_parts set person_id = p_into where person_id = p_from;
  update public.ledger_lines set debtor_id = p_into where debtor_id = p_from;
  update public.ledger_lines set creditor_id = p_into where creditor_id = p_from;
  update public.entry_allocations set debtor_id = p_into where debtor_id = p_from;
  update public.entry_allocations set creditor_id = p_into where creditor_id = p_from;
  update public.entry_reactions set person_id = p_into where person_id = p_from;
  update public.entries
     set items = replace(items::text, p_from::text, p_into::text)::jsonb
   where items is not null and items::text like '%' || p_from::text || '%';

  delete from public.group_members a
   where a.person_id = p_from
     and exists (select 1 from public.group_members b where b.group_id = a.group_id and b.person_id = p_into);
  update public.group_members set person_id = p_into where person_id = p_from;
  update public.groups set kitty_holder = p_into where kitty_holder = p_from;
  update public.carpool_trips set driver_id = p_into where driver_id = p_from;
  update public.carpool_trips set riders = array_replace(riders, p_from, p_into) where p_from = any (riders);
  update public.recurring_rules
     set parts = replace(parts::text, p_from::text, p_into::text)::jsonb
   where parts::text like '%' || p_from::text || '%';

  delete from public.household_members a
   where a.person_id = p_from
     and exists (select 1 from public.household_members b where b.owner_id = a.owner_id and b.person_id = p_into);
  update public.household_members set person_id = p_into where person_id = p_from;
  update public.shortcuts
     set units = replace(units::text, p_from::text, p_into::text)::jsonb
   where units::text like '%' || p_from::text || '%';

  -- Contacts both ways; where someone already knows p_into, that row wins.
  delete from public.contacts a
   where (a.person_id = p_from
          and (a.owner_id = p_into
               or exists (select 1 from public.contacts b where b.owner_id = a.owner_id and b.person_id = p_into)))
      or (a.owner_id = p_from
          and (a.person_id = p_into
               or exists (select 1 from public.contacts b where b.owner_id = p_into and b.person_id = a.person_id)));
  update public.contacts set person_id = p_into where person_id = p_from;
  update public.contacts set owner_id = p_into where owner_id = p_from;

  update public.share_links a set revoked_at = coalesce(a.revoked_at, now())
   where a.person_id = p_from
     and exists (select 1 from public.share_links b
                 where b.owner_id = a.owner_id and b.person_id = p_into and b.revoked_at is null);
  update public.share_links set person_id = p_into where person_id = p_from;

  delete from public.people where id = p_from;
end;
$$;

-- Gives a number-less friend their number. If someone already has that
-- number, the friend becomes them (with all history). Only the person who
-- added the friend may do this. Returns the friend's person id after it.
create function public.set_contact_phone(p_person uuid, p_phone text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_friend public.people;
  v_into uuid;
  v_nickname text;
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  select * into v_friend from public.people where id = p_person for update;
  if not found or v_friend.phone is not null or v_friend.user_id is not null
     or v_friend.added_by is distinct from v_me then
    raise exception 'unknown_person' using errcode = 'P0001';
  end if;

  select id into v_into from public.people where phone = p_phone for update;
  if v_into is null then
    update public.people set phone = p_phone, added_by = null where id = p_person;
    return p_person;
  end if;
  if v_into = v_me then
    raise exception 'cannot_add_self' using errcode = 'P0001';
  end if;

  select nickname into v_nickname from public.contacts where owner_id = v_me and person_id = p_person;
  perform public._merge_person(p_person, v_into);
  insert into public.contacts (owner_id, person_id, nickname)
  values (v_me, v_into, v_nickname)
  on conflict (owner_id, person_id) do nothing;
  return v_into;
end;
$$;

-- my_people() also says which number-less friends I may give a number to.
drop function public.my_people();
create function public.my_people()
returns table (
  id uuid, display_name text, phone text, upi_id text,
  is_registered boolean, is_contact boolean, is_me boolean, can_set_phone boolean
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
         p.id = me.id,
         p.phone is null and p.user_id is null and p.added_by = me.id
  from visible v
  join public.people p on p.id = v.person_id
  cross join me
  left join public.contacts c on c.owner_id = me.id and c.person_id = p.id
$$;

-- Adding by number never creates a number-less person by accident.
create or replace function public.add_contact(p_phone text, p_name text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_person uuid;
begin
  if p_phone is null then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
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

create or replace function public.add_contacts(p_contacts jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_added integer;
begin
  if jsonb_typeof(p_contacts) <> 'array' or jsonb_array_length(p_contacts) > 500 then
    raise exception 'too_many_contacts' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_contacts) c where c ->> 'phone' is null) then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;

  -- If a number appears twice, the first name in the list wins.
  insert into public.people (phone, name)
  select distinct on (c.value ->> 'phone') c.value ->> 'phone', btrim(c.value ->> 'name')
  from jsonb_array_elements(p_contacts) with ordinality as c (value, ord)
  order by c.value ->> 'phone', c.ord
  on conflict (phone) do nothing;

  insert into public.contacts (owner_id, person_id, nickname)
  select distinct on (p.id) v_me, p.id, btrim(c.value ->> 'name')
  from jsonb_array_elements(p_contacts) with ordinality as c (value, ord)
  join public.people p on p.phone = c.value ->> 'phone'
  where p.id <> v_me
  order by p.id, c.ord
  on conflict (owner_id, person_id) do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

-- Joining from a passbook link someone sent to a number-less friend makes
-- you that friend: the number you sign up with is added to them (merging
-- with anyone who already has it, under the usual invite rules).
create or replace function public.claim_profile(p_name text, p_phone text, p_upi_id text default null, p_invite text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_verified_phone text := nullif(auth.jwt() ->> 'phone', '');
  v_person public.people;
  v_existing uuid := public.me();
  v_placeholder uuid;
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

  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  -- With SMS login the number is verified and must be the one claimed.
  if v_verified_phone is not null and '+' || ltrim(v_verified_phone, '+') <> p_phone then
    raise exception 'phone_mismatch' using errcode = 'P0001';
  end if;

  select p.id into v_placeholder
  from public.share_links s join public.people p on p.id = s.person_id
  where s.token = p_invite and s.revoked_at is null and p.phone is null and p.user_id is null
  for update of p;

  select * into v_person from public.people where phone = p_phone for update;
  if found then
    if v_person.user_id is not null then
      raise exception 'phone_taken' using errcode = 'P0001';
    end if;
    if v_verified_phone is null
       and (exists (select 1 from public.entry_parts where person_id = v_person.id)
            or exists (select 1 from public.group_members where person_id = v_person.id)
            or exists (select 1 from public.household_members where person_id = v_person.id))
       and not exists (select 1 from public.share_links s
                       where s.token = p_invite and s.person_id = v_person.id and s.revoked_at is null) then
      raise exception 'phone_needs_invite' using errcode = 'P0001';
    end if;
    if v_placeholder is not null then
      perform public._merge_person(v_placeholder, v_person.id);
    end if;
    update public.people
       set user_id = v_uid, name = btrim(p_name), upi_id = nullif(btrim(p_upi_id), '')
     where id = v_person.id;
    return v_person.id;
  end if;

  if v_placeholder is not null then
    update public.people
       set phone = p_phone, user_id = v_uid, name = btrim(p_name),
           upi_id = nullif(btrim(p_upi_id), ''), added_by = null
     where id = v_placeholder;
    return v_placeholder;
  end if;

  insert into public.people (phone, name, user_id, upi_id)
  values (p_phone, btrim(p_name), v_uid, nullif(btrim(p_upi_id), ''))
  returning id into v_existing;
  return v_existing;
end;
$$;

------------------------------------------------------------------------------
-- Expenses logged for others
------------------------------------------------------------------------------

create index entries_created_by_idx on public.entries (created_by);

-- Whoever logged an entry keeps seeing it (and can fix it) even when they're not on it.
create or replace function public.is_entry_participant(p_entry uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.entry_parts ep
    where ep.entry_id = p_entry and ep.person_id = public.me()
  ) or exists (
    select 1 from public.entries e
    where e.id = p_entry and e.created_by = public.me()
  )
$$;

-- Everybody on an entry, and whoever logged it, become contacts of each
-- other, so the people on it can see who added it for them.
create or replace function public._link_participants(p_entry uuid) returns void
language sql security definer set search_path = ''
as $$
  with everyone as (
    select ep.person_id from public.entry_parts ep where ep.entry_id = p_entry
    union
    select e.created_by from public.entries e where e.id = p_entry
  )
  insert into public.contacts (owner_id, person_id)
  select a.person_id, b.person_id
  from everyone a
  join everyone b on b.person_id <> a.person_id
  on conflict do nothing
$$;

-- Same as before, minus "the caller must be on it". The people on it must
-- still be the caller's friends (or group members), checked by
-- _assert_allowed_people, and they see it in "To check".
create or replace function public.save_expense(
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

-- Entries I'm on, plus ones I logged for others.
create or replace function public.my_activity(p_limit integer default 50, p_before bigint default null)
returns table (
  event_id bigint, action text, actor_id uuid, at timestamptz,
  entry_id uuid, kind text, description text, amount bigint, occurred_on date,
  is_deleted boolean, my_delta bigint
)
language sql stable security definer set search_path = ''
as $$
  with mine as (
    select ep.entry_id from public.entry_parts ep where ep.person_id = public.me()
    union
    select e.id from public.entries e where e.created_by = public.me()
  )
  select ev.id, ev.action, ev.actor_id, ev.created_at,
         e.id, e.kind, e.description, e.amount, e.occurred_on, e.deleted_at is not null,
         coalesce((select sum(case when l.creditor_id = public.me() then l.amount else -l.amount end)
                   from public.ledger_lines l
                   where l.entry_id = e.id and public.me() in (l.debtor_id, l.creditor_id)), 0)::bigint
  from mine
  join public.entry_events ev on ev.entry_id = mine.entry_id
  join public.entries e on e.id = ev.entry_id
  where p_before is null or ev.id < p_before
  order by ev.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

create or replace function public.search_entries(p_query text, p_limit integer default 50)
returns table (
  entry_id uuid, kind text, description text, amount bigint, occurred_on date,
  group_id uuid, my_delta bigint
)
language sql stable security definer set search_path = ''
as $$
  with q as (
    select '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           case when btrim(p_query) ~ '^₹?\s*[0-9]{1,8}(\.[0-9]{1,2})?$'
                then round(regexp_replace(btrim(p_query), '[₹\s]', '', 'g')::numeric * 100)::bigint
           end as paise
    where char_length(btrim(coalesce(p_query, ''))) between 1 and 60
  ),
  mine as (
    select ep.entry_id from public.entry_parts ep where ep.person_id = public.me()
    union
    select e.id from public.entries e where e.created_by = public.me()
  )
  select e.id, e.kind, e.description, e.amount, e.occurred_on, e.group_id,
         coalesce((select sum(case when l.creditor_id = public.me() then l.amount else -l.amount end)
                   from public.ledger_lines l
                   where l.entry_id = e.id and public.me() in (l.debtor_id, l.creditor_id)), 0)::bigint
  from q, mine
  join public.entries e on e.id = mine.entry_id
  where e.deleted_at is null
    and (e.description ilike q.pat
     or e.occasion ilike q.pat
     or e.amount = q.paise
     or exists (select 1 from jsonb_array_elements(coalesce(e.items -> 'lines', '[]')) l where l ->> 'name' ilike q.pat)
     or exists (select 1 from public.groups g where g.id = e.group_id and g.name ilike q.pat)
     or exists (select 1 from public.entry_parts p
                join public.people pp on pp.id = p.person_id
                left join public.contacts c on c.owner_id = public.me() and c.person_id = p.person_id
                where p.entry_id = e.id and p.person_id <> public.me()
                  and coalesce(c.nickname, pp.name) ilike q.pat))
  order by e.occurred_on desc, e.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

-- As before, and whoever logged an entry for others also hears when one of them questions it.
create or replace function public.my_reviews()
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
    from public.entries e
    where e.deleted_at is null and e.kind in ('expense', 'payment', 'forgive')
      and (exists (select 1 from public.entry_parts ep where ep.entry_id = e.id and ep.person_id = public.me())
           or e.created_by = public.me())
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
-- Privileges: only this migration's new functions.
------------------------------------------------------------------------------

revoke execute on function
  public.my_people(),
  public.add_contact_by_name(text),
  public.set_contact_phone(uuid, text),
  public._merge_person(uuid, uuid)
from public, anon;
grant execute on function
  public.my_people(),
  public.add_contact_by_name(text),
  public.set_contact_phone(uuid, text)
to authenticated;
