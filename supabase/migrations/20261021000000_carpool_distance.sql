-- Hisaab v10: car pools split by distance. Riders pay the driver for the
-- kilometres they actually ride (each side), at a rate per km the group sets
-- once. E.g. at ₹8/km, a rider picked up 14 km from the office pays ₹112 a
-- trip and one who rides 20 km pays ₹160; the driver pays nothing.
--
-- Additive; safe to run on a live database.

alter table public.groups drop constraint groups_carpool_style;
alter table public.groups
  add constraint groups_carpool_style check (carpool_style is null or carpool_style in ('fare', 'split', 'turns', 'distance'));

-- What a logged trip cost in total (riders' charges), for showing it later.
alter table public.carpool_trips add column total bigint;

-- How far each member rides, one way. Any member can set it for anyone in the group.
create table public.carpool_distances (
  group_id uuid not null references public.groups (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  km numeric(5, 1) not null,
  updated_by uuid references public.people (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (group_id, person_id),
  constraint carpool_distances_km check (km > 0 and km <= 500)
);

alter table public.carpool_distances enable row level security;
create policy carpool_distances_read on public.carpool_distances for select to authenticated
  using (public.is_group_member(group_id));
grant select on public.carpool_distances to authenticated;

-- Sets (or with p_km null, clears) how far a member rides, one way.
create function public.set_carpool_distance(p_group uuid, p_person uuid, p_km numeric) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
begin
  if not public.is_group_member(p_group) then
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.group_members where group_id = p_group and person_id = p_person) then
    raise exception 'not_group_member' using errcode = 'P0001';
  end if;
  if p_km is null then
    delete from public.carpool_distances where group_id = p_group and person_id = p_person;
    return;
  end if;
  if p_km <= 0 or p_km > 500 then
    raise exception 'invalid_km' using errcode = 'P0001';
  end if;
  insert into public.carpool_distances (group_id, person_id, km, updated_by)
  values (p_group, p_person, round(p_km, 1), v_me)
  on conflict (group_id, person_id) do update set km = excluded.km, updated_by = v_me, updated_at = now();
end;
$$;

-- As before, plus the 'distance' style (p_amount is the rate per km in paise).
create or replace function public.set_carpool_prefs(p_group uuid, p_style text, p_amount bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_me();
  if not public.is_group_member(p_group) then
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;
  if p_style in ('fare', 'split', 'distance') and p_amount is null then
    raise exception 'carpool_amount_needed' using errcode = 'P0001';
  end if;
  update public.groups
     set kind = 'carpool', carpool_style = p_style,
         carpool_amount = case when p_style = 'turns' then null else p_amount end
   where id = p_group;
end;
$$;

-- Logs one trip. With 'distance', p_amount (if given) overrides the rate per km for this trip.
create or replace function public.save_carpool_trip(
  p_group uuid, p_date date, p_direction text, p_driver uuid, p_riders uuid[], p_amount bigint default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_group public.groups;
  v_riders uuid[] := array(select distinct x from unnest(p_riders) x);
  v_amount bigint;
  v_total bigint;
  v_people uuid[];
  v_n integer;
  v_parts jsonb;
  v_entry uuid;
  v_id uuid;
begin
  select * into v_group from public.groups where id = p_group;
  if not found or not public.is_group_member(p_group) then
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;
  if v_group.kind <> 'carpool' or v_group.carpool_style is null then
    raise exception 'not_a_carpool' using errcode = 'P0001';
  end if;
  if p_direction not in ('am', 'pm') or p_date is null or p_date > current_date + 1 then
    raise exception 'invalid_trip' using errcode = 'P0001';
  end if;
  if p_driver is null or cardinality(v_riders) = 0 or p_driver = any (v_riders) then
    raise exception 'invalid_trip' using errcode = 'P0001';
  end if;
  v_people := p_driver || v_riders;
  if exists (select 1 from unnest(v_people) x
             where not exists (select 1 from public.group_members gm where gm.group_id = p_group and gm.person_id = x)) then
    raise exception 'not_group_member' using errcode = 'P0001';
  end if;
  if not (v_me = any (v_people)) then
    raise exception 'must_participate' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.carpool_trips
             where group_id = p_group and trip_date = p_date and direction = p_direction) then
    raise exception 'trip_already_logged' using errcode = 'P0001';
  end if;

  if v_group.carpool_style <> 'turns' then
    v_amount := coalesce(p_amount, v_group.carpool_amount);
    if v_amount is null or v_amount <= 0 or v_amount > 10000000 then
      raise exception 'carpool_amount_needed' using errcode = 'P0001';
    end if;
    if v_group.carpool_style = 'distance' then
      -- v_amount is the rate per km. Each rider owes the driver for their own
      -- distance; the driver owes nothing.
      if exists (select 1 from unnest(v_riders) r
                 where not exists (select 1 from public.carpool_distances cd
                                   where cd.group_id = p_group and cd.person_id = r)) then
        raise exception 'carpool_km_needed' using errcode = 'P0001';
      end if;
      select jsonb_agg(jsonb_build_object('person_id', r.person_id, 'paid', 0, 'owed', r.owed)), sum(r.owed)
        into v_parts, v_total
      from (select cd.person_id, round(cd.km * v_amount)::bigint as owed
            from unnest(v_riders) x
            join public.carpool_distances cd on cd.group_id = p_group and cd.person_id = x) r;
      v_parts := jsonb_build_array(jsonb_build_object('person_id', p_driver, 'paid', v_total, 'owed', 0)) || v_parts;
    elsif v_group.carpool_style = 'fare' then
      -- Each rider owes the driver the fare; the driver owes nothing.
      v_total := v_amount * cardinality(v_riders);
      v_parts := jsonb_build_array(jsonb_build_object('person_id', p_driver, 'paid', v_total, 'owed', 0))
                 || (select jsonb_agg(jsonb_build_object('person_id', r, 'paid', 0, 'owed', v_amount)) from unnest(v_riders) r);
    else
      -- The driver paid the trip's cost; everyone in the car shares it (extra paise to the driver first).
      v_total := v_amount;
      v_n := cardinality(v_people);
      select jsonb_agg(jsonb_build_object(
               'person_id', x.id,
               'paid', case when x.id = p_driver then v_total else 0 end,
               'owed', v_total / v_n + case when x.k <= v_total % v_n then 1 else 0 end) order by x.k)
        into v_parts
      from unnest(v_people) with ordinality as x(id, k);
    end if;
    v_entry := public.save_expense(
      null,
      '🚗 ' || case p_direction when 'am' then 'Morning' else 'Evening' end || ' ride · ' || to_char(p_date, 'DD Mon'),
      v_total, p_date, p_group, 'exact', v_parts, null);
  end if;

  insert into public.carpool_trips (group_id, trip_date, direction, driver_id, riders, amount, total, entry_id, created_by)
  values (p_group, p_date, p_direction, p_driver, v_riders, v_amount, v_total, v_entry, v_me)
  returning id into v_id;
  return v_id;
end;
$$;

-- A merged friend keeps their distance.
create or replace function public._merge_person(p_from uuid, p_into uuid) returns void
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
  delete from public.carpool_distances a
   where a.person_id = p_from
     and exists (select 1 from public.carpool_distances b where b.group_id = a.group_id and b.person_id = p_into);
  update public.carpool_distances set person_id = p_into where person_id = p_from;
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

revoke execute on function public.set_carpool_distance(uuid, uuid, numeric) from public, anon;
grant execute on function public.set_carpool_distance(uuid, uuid, numeric) to authenticated;
