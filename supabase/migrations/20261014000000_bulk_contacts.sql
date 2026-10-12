-- Hisaab v3: import many contacts at once (from a phone's contact picker or
-- a .vcf/.csv file). Additive; safe to run on a live database.

-- Adds up to 500 friends in one call. Phones must already be normalised to
-- E.164 by the client. People already in my contacts keep the name I gave
-- them. Returns how many new contacts were added.
create function public.add_contacts(p_contacts jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_added integer;
begin
  if jsonb_typeof(p_contacts) <> 'array' or jsonb_array_length(p_contacts) > 500 then
    raise exception 'too_many_contacts' using errcode = 'P0001';
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

revoke execute on function public.add_contacts(jsonb) from public, anon;
grant execute on function public.add_contacts(jsonb) to authenticated;
