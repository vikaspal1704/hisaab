-- Hisaab v8: "who's already on Hisaab" when importing contacts.
-- The app sends SHA-256 hashes of numbers ("hisaab:" + E.164), never the
-- numbers themselves, and gets back only the hashes that belong to people
-- who have signed up. Phone numbers are guessable, so hashing keeps them out
-- of logs and requests rather than making them secret; a daily limit stops
-- anyone checking the whole number space. Additive; safe to run on a live database.

alter table public.people
  add column phone_hash text generated always as (encode(sha256(('hisaab:' || phone)::bytea), 'hex')) stored;
create index people_registered_hash_idx on public.people (phone_hash) where user_id is not null;

-- How many numbers each person checked per day (no client access).
create table public.contact_lookups (
  person_id uuid not null references public.people (id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  primary key (person_id, day)
);
alter table public.contact_lookups enable row level security;

create function public.match_contacts(p_hashes text[]) returns setof text
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_n integer := coalesce(cardinality(p_hashes), 0);
  v_total integer;
begin
  if v_n > 2000 then
    raise exception 'too_many_lookups' using errcode = 'P0001';
  end if;
  insert into public.contact_lookups (person_id, day, count) values (v_me, current_date, v_n)
  on conflict (person_id, day) do update set count = public.contact_lookups.count + excluded.count
  returning count into v_total;
  if v_total > 10000 then
    raise exception 'too_many_lookups' using errcode = 'P0001';
  end if;
  return query
    select distinct p.phone_hash
    from public.people p
    where p.user_id is not null and p.id <> v_me and p.phone_hash = any (p_hashes);
end;
$$;

revoke execute on function public.match_contacts(text[]) from public, anon;
grant execute on function public.match_contacts(text[]) to authenticated;
