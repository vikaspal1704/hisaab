-- Removes everything supabase/demo/seed_demo.sql added: the demo friends
-- (numbers +1 202-555-01xx), every entry they're on, the demo groups and pairs,
-- shortcuts that use them, and their login-less accounts. Your own friends and
-- entries without demo people are left alone. Safe to run more than once.

do $$
declare
  demo uuid[] := array(select id from public.people where phone like '+120255501%');
  -- Friends without a number who only appear alongside demo friends (e.g. Bunty).
  nameless uuid[] := array(
    select distinct ep.person_id
    from public.entry_parts ep
    join public.people p on p.id = ep.person_id and p.phone is null and p.user_id is null
    where exists (select 1 from public.entry_parts d where d.entry_id = ep.entry_id and d.person_id = any (demo))
      and not exists (select 1 from public.entry_parts o
                      where o.person_id = ep.person_id
                        and not exists (select 1 from public.entry_parts d where d.entry_id = o.entry_id and d.person_id = any (demo))));
begin
  delete from public.entries e
   where e.created_by = any (demo)
      or exists (select 1 from public.entry_parts p where p.entry_id = e.id and p.person_id = any (demo))
      or exists (select 1 from public.ledger_lines l where l.entry_id = e.id and (l.debtor_id = any (demo) or l.creditor_id = any (demo)))
      or exists (select 1 from public.entry_allocations a where a.entry_id = e.id and (a.debtor_id = any (demo) or a.creditor_id = any (demo)));
  delete from public.groups g
   where exists (select 1 from public.group_members m where m.group_id = g.id and m.person_id = any (demo));
  delete from public.households h
   where exists (select 1 from public.household_members m where m.household_id = h.id and m.person_id = any (demo));
  delete from public.shortcuts s
   where exists (select 1 from unnest(demo) x where s.units::text like '%' || x::text || '%');
  delete from public.people where id = any (demo) or id = any (nameless);
  delete from auth.users where email like '%@demo.hisaab.invalid';
end;
$$;
