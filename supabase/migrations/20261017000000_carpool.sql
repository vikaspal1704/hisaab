-- Hisaab v6: car pools. A carpool group logs each trip (morning and evening
-- separately) with its driver and riders, in one of three styles:
--   fare  — every rider pays the driver a fixed fare for the trip
--   split — the trip's fuel/toll is split equally among everyone in the car
--   turns — no money: drivers and riders are counted so turns stay fair
-- Money styles book an ordinary expense per trip, so balances, passbooks,
-- search and statements all just work. Additive; safe to run on a live database.

alter table public.groups drop constraint groups_kind;
alter table public.groups
  add constraint groups_kind check (kind in ('friends', 'trip', 'home', 'office', 'carpool')),
  add column carpool_style text,
  add column carpool_amount bigint,
  add constraint groups_carpool_style check (carpool_style is null or carpool_style in ('fare', 'split', 'turns')),
  add constraint groups_carpool_amount check (carpool_amount is null or carpool_amount between 1 and 10000000);

create table public.carpool_trips (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  trip_date date not null,
  direction text not null,
  driver_id uuid not null references public.people (id) on delete cascade,
  riders uuid[] not null,
  -- fare per rider (fare) or the trip's cost (split); null for turns
  amount bigint,
  entry_id uuid references public.entries (id) on delete set null,
  created_by uuid not null references public.people (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint carpool_trips_direction check (direction in ('am', 'pm')),
  constraint carpool_trips_riders check (cardinality(riders) between 1 and 20),
  constraint carpool_trips_once unique (group_id, trip_date, direction)
);
create index carpool_trips_group_date_idx on public.carpool_trips (group_id, trip_date desc);

alter table public.carpool_trips enable row level security;
create policy carpool_trips_read on public.carpool_trips for select to authenticated
  using (public.is_group_member(group_id));
grant select on public.carpool_trips to authenticated;

-- How this car pool shares costs. Any member can change it; it applies to new trips.
create function public.set_carpool_prefs(p_group uuid, p_style text, p_amount bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_me();
  if not public.is_group_member(p_group) then
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;
  if p_style in ('fare', 'split') and p_amount is null then
    raise exception 'carpool_amount_needed' using errcode = 'P0001';
  end if;
  update public.groups
     set kind = 'carpool', carpool_style = p_style,
         carpool_amount = case when p_style = 'turns' then null else p_amount end
   where id = p_group;
end;
$$;

-- Logs one trip. The person logging it must be in the car. Returns the trip id.
create function public.save_carpool_trip(
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
    if v_group.carpool_style = 'fare' then
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

  insert into public.carpool_trips (group_id, trip_date, direction, driver_id, riders, amount, entry_id, created_by)
  values (p_group, p_date, p_direction, p_driver, v_riders, v_amount, v_entry, v_me)
  returning id into v_id;
  return v_id;
end;
$$;

-- Undo a trip: removes it from the count and deletes its expense (which stays
-- in the expense's history like any other delete).
create function public.delete_carpool_trip(p_trip uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_trip public.carpool_trips;
begin
  select * into v_trip from public.carpool_trips where id = p_trip for update;
  if not found or not public.is_group_member(v_trip.group_id)
     or not (v_me = v_trip.driver_id or v_me = any (v_trip.riders) or v_me = v_trip.created_by) then
    raise exception 'trip_not_found' using errcode = 'P0001';
  end if;
  if v_trip.entry_id is not null
     and exists (select 1 from public.entries where id = v_trip.entry_id and deleted_at is null) then
    perform public.delete_entry(v_trip.entry_id);
  end if;
  delete from public.carpool_trips where id = p_trip;
end;
$$;

-- Who drove and who rode. "seats" = seats given as driver minus rides taken:
-- below zero means you've been riding more than driving.
create function public.carpool_summary(p_group uuid)
returns table (person_id uuid, drives integer, rides integer, seats integer)
language sql stable security definer set search_path = ''
as $$
  select gm.person_id,
         coalesce((select count(*) from public.carpool_trips t where t.group_id = p_group and t.driver_id = gm.person_id), 0)::integer,
         coalesce((select count(*) from public.carpool_trips t where t.group_id = p_group and gm.person_id = any (t.riders)), 0)::integer,
         (coalesce((select sum(cardinality(t.riders)) from public.carpool_trips t where t.group_id = p_group and t.driver_id = gm.person_id), 0)
          - coalesce((select count(*) from public.carpool_trips t where t.group_id = p_group and gm.person_id = any (t.riders)), 0))::integer
  from public.group_members gm
  where gm.group_id = p_group and public.is_group_member(p_group)
$$;

-- Only this file's functions: new functions are executable by everyone until revoked.
revoke execute on function
  public.set_carpool_prefs(uuid, text, bigint),
  public.save_carpool_trip(uuid, date, text, uuid, uuid[], bigint),
  public.delete_carpool_trip(uuid),
  public.carpool_summary(uuid)
from public, anon;
grant execute on function
  public.set_carpool_prefs(uuid, text, bigint),
  public.save_carpool_trip(uuid, date, text, uuid, uuid[], bigint),
  public.delete_carpool_trip(uuid),
  public.carpool_summary(uuid)
to authenticated;
