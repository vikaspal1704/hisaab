-- Hisaab v4: office crews (daily chai), daily/weekday repeats, closing a
-- trip kitty. Additive; safe to run on a live database.

------------------------------------------------------------------------------
-- Office crew groups
------------------------------------------------------------------------------

alter table public.groups drop constraint groups_kind;
alter table public.groups add constraint groups_kind check (kind in ('friends', 'trip', 'home', 'office'));

------------------------------------------------------------------------------
-- Repeats: monthly (rent), every weekday (office snacks), every day
------------------------------------------------------------------------------

alter table public.recurring_rules
  add column frequency text not null default 'monthly',
  add constraint recurring_frequency check (frequency in ('monthly', 'weekdays', 'daily'));

-- The next occurrence after p_from.
create function public._next_occurrence(p_from date, p_frequency text, p_day integer) returns date
language sql immutable set search_path = ''
as $$
  select case p_frequency
    when 'daily' then p_from + 1
    -- Friday → Monday, Saturday → Monday, otherwise the next day.
    when 'weekdays' then p_from + case extract(isodow from p_from)::int when 5 then 3 when 6 then 2 else 1 end
    else public._next_month_day(p_from, p_day)
  end
$$;

-- The first occurrence on or after p_start.
create function public._first_occurrence(p_start date, p_frequency text, p_day integer) returns date
language sql immutable set search_path = ''
as $$
  select case p_frequency
    when 'daily' then p_start
    when 'weekdays' then p_start + case extract(isodow from p_start)::int when 6 then 2 when 7 then 1 else 0 end
    else case
      when date_trunc('month', p_start)::date + (p_day - 1) >= p_start then date_trunc('month', p_start)::date + (p_day - 1)
      else public._next_month_day(p_start, p_day)
    end
  end
$$;

drop function public.save_recurring(uuid, uuid, text, bigint, text, jsonb, integer, date);

create function public.save_recurring(
  p_id uuid, p_group uuid, p_description text, p_amount bigint, p_split_mode text,
  p_parts jsonb, p_day_of_month integer, p_start_on date, p_frequency text default 'monthly'
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

  v_first := public._first_occurrence(coalesce(p_start_on, current_date), p_frequency, coalesce(p_day_of_month, 1));

  if v_id is null then
    insert into public.recurring_rules
      (group_id, created_by, description, amount, split_mode, parts, day_of_month, next_on, frequency)
    values (p_group, v_me, btrim(p_description), p_amount, p_split_mode, p_parts,
            coalesce(p_day_of_month, 1), v_first, p_frequency)
    returning id into v_id;
  else
    update public.recurring_rules
       set description = btrim(p_description), amount = p_amount, split_mode = p_split_mode,
           parts = p_parts, day_of_month = coalesce(p_day_of_month, 1), next_on = v_first, frequency = p_frequency
     where id = v_id and group_id = p_group;
    if not found then
      raise exception 'recurring_not_found' using errcode = 'P0001';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.run_due_recurring() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_rule public.recurring_rules;
  v_posted integer := 0;
  v_rounds integer;
  v_label text;
begin
  for v_rule in
    select r.* from public.recurring_rules r
    where r.active and r.next_on <= current_date
      and exists (select 1 from public.group_members gm where gm.group_id = r.group_id and gm.person_id = v_me)
      and exists (select 1 from jsonb_array_elements(r.parts) p where (p ->> 'person_id')::uuid = v_me)
    for update skip locked
  loop
    v_rounds := 0;
    -- Catch up at most a month of missed days.
    while v_rule.next_on <= current_date and v_rounds < 31 loop
      v_label := case v_rule.frequency when 'monthly' then to_char(v_rule.next_on, 'Mon YYYY') else to_char(v_rule.next_on, 'DD Mon') end;
      perform public.save_expense(
        null, v_rule.description || ' · ' || v_label, v_rule.amount,
        v_rule.next_on, v_rule.group_id, v_rule.split_mode, v_rule.parts, null);
      v_rule.next_on := public._next_occurrence(v_rule.next_on, v_rule.frequency, v_rule.day_of_month);
      v_rounds := v_rounds + 1;
      v_posted := v_posted + 1;
    end loop;
    -- Anything older than a month is skipped rather than posted in bulk.
    if v_rule.next_on <= current_date then
      v_rule.next_on := public._first_occurrence(current_date + 1, v_rule.frequency, v_rule.day_of_month);
    end if;
    update public.recurring_rules set next_on = v_rule.next_on where id = v_rule.id;
  end loop;
  return v_posted;
end;
$$;

------------------------------------------------------------------------------
-- Closing a trip kitty
------------------------------------------------------------------------------

-- What the kitty holder owes each member (positive) or is owed (negative),
-- counting kitty entries only: their contributions minus their share of spends.
create function public.kitty_settlement(p_group uuid)
returns table (person_id uuid, amount bigint)
language sql stable security definer set search_path = ''
as $$
  select m.person_id,
         coalesce(sum(case when l.creditor_id = m.person_id then l.amount else -l.amount end), 0)::bigint
  from public.groups g
  join public.group_members m on m.group_id = g.id and m.person_id <> g.kitty_holder
  left join public.entries e on e.group_id = g.id and e.kitty and e.deleted_at is null
  left join public.ledger_lines l on l.entry_id = e.id
    and ((l.debtor_id = g.kitty_holder and l.creditor_id = m.person_id)
      or (l.debtor_id = m.person_id and l.creditor_id = g.kitty_holder))
  where g.id = p_group and g.kitty_holder is not null and public.is_group_member(p_group)
  group by m.person_id
$$;

-- The holder returns the leftovers (or collects any shortfall) and the kitty
-- closes. Recorded as kitty payments, so the kitty nets to zero.
create function public.close_kitty(p_group uuid, p_method text) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_holder uuid := public._kitty_holder(p_group);
  v_row record;
  v_id uuid;
  v_count integer := 0;
begin
  if v_holder <> public.require_me() then
    raise exception 'only_kitty_holder' using errcode = 'P0001';
  end if;
  for v_row in select * from public.kitty_settlement(p_group) where amount <> 0 loop
    if v_row.amount > 0 then
      v_id := public.save_payment(null, v_holder, v_row.person_id, v_row.amount, current_date, p_method,
                                  'Kitty leftover returned', null, p_group, null);
    else
      v_id := public.save_payment(null, v_row.person_id, v_holder, -v_row.amount, current_date, p_method,
                                  'Kitty shortfall', null, p_group, null);
    end if;
    update public.entries set kitty = true where id = v_id;
    v_count := v_count + 1;
  end loop;
  update public.groups set kitty_holder = null where id = p_group;
  return v_count;
end;
$$;

-- Collected/spent now ignore the closing payments (money going back out).
drop function public.group_kitty(uuid);
create function public.group_kitty(p_group uuid)
returns table (holder_id uuid, collected bigint, spent bigint)
language sql stable security definer set search_path = ''
as $$
  select g.kitty_holder,
         coalesce((select sum(e.amount) from public.entries e
                   join public.entry_parts ep on ep.entry_id = e.id and ep.person_id = g.kitty_holder and ep.owed > 0
                   where e.group_id = g.id and e.kitty and e.kind = 'payment' and e.deleted_at is null), 0)::bigint,
         coalesce((select sum(e.amount) from public.entries e
                   where e.group_id = g.id and e.kitty and e.kind = 'expense' and e.deleted_at is null), 0)::bigint
  from public.groups g
  where g.id = p_group and public.is_group_member(p_group)
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.save_recurring(uuid, uuid, text, bigint, text, jsonb, integer, date, text),
  public.run_due_recurring(),
  public.kitty_settlement(uuid),
  public.close_kitty(uuid, text),
  public.group_kitty(uuid)
to authenticated;
-- Re-grant everything else clients use (the revoke above covers all functions).
grant execute on function
  public.me(), public.claim_profile(text, text, text), public.add_contact(text, text), public.add_contacts(jsonb),
  public.set_nickname(uuid, text), public.my_people(), public.save_household(uuid, text, uuid[]),
  public.delete_household(uuid), public.create_group(text, text, uuid[]), public.update_group(uuid, text, text, uuid[]),
  public.save_expense(uuid, text, bigint, date, uuid, text, jsonb, integer),
  public.save_payment(uuid, uuid, uuid, bigint, date, text, text, jsonb, uuid, integer),
  public.delete_entry(uuid), public.restore_entry(uuid), public.my_balances(), public.person_ledger(uuid),
  public.group_balances(uuid), public.my_activity(integer, bigint), public.is_entry_participant(uuid),
  public.is_group_member(uuid), public.can_see_person(uuid),
  public.set_contact_prefs(uuid, text, bigint, bigint, integer), public.mark_nudged(uuid),
  public.set_group_prefs(uuid, text, bigint, uuid), public.forgive_balance(uuid, bigint, text),
  public.save_treat(uuid, bigint, text, text, date, uuid[], uuid), public.treat_summary(uuid),
  public.save_shortcut(text, text, bigint, uuid, jsonb), public.delete_shortcut(uuid),
  public.react_to_entry(uuid, text, text), public.my_reviews(), public.create_share_link(uuid),
  public.revoke_share_link(uuid), public.add_to_kitty(uuid, uuid, bigint, date, text),
  public.save_kitty_expense(text, bigint, date, uuid, text, jsonb), public.stop_recurring(uuid),
  public.save_push_subscription(text, text, text), public.delete_push_subscription(text)
to authenticated;
grant execute on function public.shared_view(text), public.shared_react(text, uuid, text, text) to anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.push_targets(bigint), public.digest_targets(), public.drop_push_subscription(text) to service_role;
  end if;
end;
$$;
