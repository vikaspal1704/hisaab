-- Hisaab v5: split a bill by item, search the ledger, and only hand over a
-- pre-joining friend's history to someone who can prove it's theirs.
-- Additive; safe to run on a live database.

------------------------------------------------------------------------------
-- Split by item
------------------------------------------------------------------------------

-- The bill as entered: {"lines": [{"name", "amount", "people": [person ids]}],
-- "tax", "tip", "discount"}. Display only — the ledger comes from entry_parts.
alter table public.entries
  drop constraint entries_split_mode,
  add column items jsonb,
  add constraint entries_split_mode check (
    (kind = 'expense' and split_mode in ('equal', 'exact', 'shares', 'items'))
    or (kind <> 'expense' and split_mode is null)
  ),
  add constraint entries_items check (items is null or (split_mode = 'items' and jsonb_typeof(items) = 'object'));

-- Re-saving an itemised bill some other way drops the stale item list.
create function public._clear_stale_items() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.items := null;
  return new;
end;
$$;

create trigger entries_clear_stale_items
  before update on public.entries
  for each row when (new.split_mode is distinct from 'items' and new.items is not null)
  execute function public._clear_stale_items();

-- Saves an expense split by item. The client works out each person's share
-- (equal per item, charges in proportion); this checks the bill adds up and
-- stores it next to the parts.
create function public.save_itemized_expense(
  p_entry uuid,
  p_description text,
  p_occurred_on date,
  p_group uuid,
  p_parts jsonb,
  p_items jsonb,
  p_expected_version integer default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_lines jsonb := p_items -> 'lines';
  v_tax bigint;
  v_tip bigint;
  v_discount bigint;
  v_people uuid[];
  v_total bigint;
  v_id uuid;
begin
  if jsonb_typeof(p_items) is distinct from 'object' or jsonb_typeof(v_lines) is distinct from 'array'
     or jsonb_array_length(v_lines) not between 1 and 100
     or exists (
       select 1 from jsonb_array_elements(v_lines) l
       where jsonb_typeof(l -> 'name') is distinct from 'string'
          or char_length(btrim(l ->> 'name')) not between 1 and 60
          or coalesce(l ->> 'amount', '') !~ '^[1-9][0-9]{0,9}$'
          or jsonb_typeof(l -> 'people') is distinct from 'array'
          or jsonb_array_length(l -> 'people') not between 1 and 50
          or exists (select 1 from jsonb_array_elements(l -> 'people') x
                     where jsonb_typeof(x) <> 'string'
                        or x #>> '{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
     or exists (select 1 from unnest(array['tax', 'tip', 'discount']) k
                where p_items ? k and coalesce(p_items ->> k, '') !~ '^[0-9]{1,10}$') then
    raise exception 'invalid_items' using errcode = 'P0001';
  end if;

  v_tax := coalesce((p_items ->> 'tax')::bigint, 0);
  v_tip := coalesce((p_items ->> 'tip')::bigint, 0);
  v_discount := coalesce((p_items ->> 'discount')::bigint, 0);
  select sum((l ->> 'amount')::bigint) + v_tax + v_tip - v_discount into v_total
  from jsonb_array_elements(v_lines) l;
  if v_total <= 0 then
    raise exception 'invalid_items' using errcode = 'P0001';
  end if;

  select array_agg(distinct (x #>> '{}')::uuid) into v_people
  from jsonb_array_elements(v_lines) l, jsonb_array_elements(l -> 'people') x;
  if exists (select 1 from unnest(v_people) p where not public.can_see_person(p)) then
    raise exception 'unknown_person' using errcode = 'P0001';
  end if;
  if p_group is not null and exists (
    select 1 from unnest(v_people) p
    where not exists (select 1 from public.group_members gm where gm.group_id = p_group and gm.person_id = p)
  ) then
    raise exception 'not_group_member' using errcode = 'P0001';
  end if;

  -- Checks the parts add up to the bill, who may be on it, and edit rights.
  v_id := public.save_expense(p_entry, p_description, v_total, p_occurred_on, p_group, 'items', p_parts, p_expected_version);

  update public.entries
     set items = jsonb_build_object(
           'lines', (select jsonb_agg(jsonb_build_object(
                                'name', btrim(l ->> 'name'),
                                'amount', (l ->> 'amount')::bigint,
                                'people', l -> 'people') order by o)
                     from jsonb_array_elements(v_lines) with ordinality as t(l, o)),
           'tax', v_tax, 'tip', v_tip, 'discount', v_discount)
   where id = v_id;
  return v_id;
end;
$$;

------------------------------------------------------------------------------
-- Search
------------------------------------------------------------------------------

-- My live (not deleted) entries matching a word (what, item, group, who) or an exact amount.
create function public.search_entries(p_query text, p_limit integer default 50)
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
  mine as (select ep.entry_id from public.entry_parts ep where ep.person_id = public.me())
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

------------------------------------------------------------------------------
-- Statements (export)
------------------------------------------------------------------------------

-- Every live entry in a group with who paid and what it did to each member's
-- balance, for a group member to download. Same scope as group_balances.
create function public.group_statement(p_group uuid)
returns table (
  entry_id uuid, kind text, description text, amount bigint, occurred_on date,
  payers jsonb, effects jsonb
)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.kind, e.description, e.amount, e.occurred_on,
         coalesce((select jsonb_object_agg(ep.person_id, ep.paid) from public.entry_parts ep
                   where ep.entry_id = e.id and ep.paid > 0), '{}'),
         coalesce((select jsonb_object_agg(x.person_id, x.net) from (
                     select p.person_id, sum(p.net)::bigint as net from (
                       select l.creditor_id as person_id, l.amount as net from public.ledger_lines l where l.entry_id = e.id
                       union all
                       select l.debtor_id, -l.amount from public.ledger_lines l where l.entry_id = e.id
                     ) p group by p.person_id) x), '{}')
  from public.entries e
  where e.group_id = p_group and e.deleted_at is null and public.is_group_member(p_group)
  order by e.occurred_on, e.created_at, e.id
$$;

------------------------------------------------------------------------------
-- Friends who join later
------------------------------------------------------------------------------

-- Entries can be recorded against a number before its owner joins. Google
-- sign-in doesn't verify that number, so a profile that already has history
-- is only handed over with a verified (OTP) number, or with a link a friend
-- sent to it (their passbook link doubles as the invite).
drop function public.claim_profile(text, text, text);
create function public.claim_profile(p_name text, p_phone text, p_upi_id text default null, p_invite text default null)
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
    if v_verified_phone is null
       and (exists (select 1 from public.entry_parts where person_id = v_person.id)
            or exists (select 1 from public.group_members where person_id = v_person.id)
            or exists (select 1 from public.household_members where person_id = v_person.id))
       and not exists (select 1 from public.share_links s
                       where s.token = p_invite and s.person_id = v_person.id and s.revoked_at is null) then
      raise exception 'phone_needs_invite' using errcode = 'P0001';
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

-- Only this file's functions: new functions are executable by everyone until revoked.
revoke execute on function
  public._clear_stale_items(),
  public.save_itemized_expense(uuid, text, date, uuid, jsonb, jsonb, integer),
  public.search_entries(text, integer),
  public.group_statement(uuid),
  public.claim_profile(text, text, text, text)
from public, anon;
grant execute on function
  public.save_itemized_expense(uuid, text, date, uuid, jsonb, jsonb, integer),
  public.search_entries(text, integer),
  public.group_statement(uuid),
  public.claim_profile(text, text, text, text)
to authenticated;
