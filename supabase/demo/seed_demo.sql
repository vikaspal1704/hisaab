-- Hisaab demo data: fills YOUR account with demo friends, groups and history so
-- you can try every feature. Run it in the Supabase SQL Editor AFTER you have
-- signed in to the app once and finished "Set up your profile".
--
-- * It attaches everything to the account that signed in most recently. To pick
--   a specific account, put its Google email in v_email below.
-- * Demo friends use fictional numbers (+1 202-555-01xx, reserved for fiction),
--   so no real person can ever be linked to them. Their logins can't be used.
-- * Remove it all again with supabase/demo/remove_demo.sql.
--
-- Needs all six migrations in supabase/migrations.

-- Act as a given user for the RPCs below (they read auth.uid() from these claims).
create or replace function pg_temp.act(p_uid uuid) returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;

-- Parts for "payer paid, split equally between people" (largest remainder, earlier people get the extra paisa).
create or replace function pg_temp.eq(p_payer uuid, p_amount bigint, p_people uuid[]) returns jsonb
language sql as $$
  select jsonb_agg(jsonb_build_object(
           'person_id', x.id,
           'paid', case when x.id = p_payer then p_amount else 0 end,
           'owed', p_amount / cardinality(p_people) + case when x.n <= p_amount % cardinality(p_people) then 1 else 0 end)
         order by x.n)
  from unnest(p_people) with ordinality as x(id, n)
$$;

-- A demo friend with a (login-less) account.
create or replace function pg_temp.demo_user(p_name text, p_phone text, p_upi text) returns uuid
language plpgsql as $$
declare
  v_uid uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
          'demo-' || right(p_phone, 4) || '@demo.hisaab.invalid',
          '{"provider": "email", "providers": ["email"]}', jsonb_build_object('full_name', p_name),
          now(), now(), '', '', '', '');
  perform pg_temp.act(v_uid);
  perform public.claim_profile(p_name, p_phone, p_upi);
  return v_uid;
end;
$$;

do $$
declare
  -- Optional: your Google email, if the most recent sign-in isn't you.
  v_email text := null;

  d date := current_date;
  me_uid uuid;   me uuid;
  r_uid uuid;    rahul uuid;
  p_uid uuid;    priya uuid;
  a_uid uuid;    amit uuid;
  n_uid uuid;    neha uuid;
  j_uid uuid;    arjun uuid;
  s_uid uuid;    sneha uuid;
  dk_uid uuid;   deepak uuid;
  i_uid uuid;    ishita uuid;
  kabir uuid;
  goa uuid; office uuid; flat uuid; carpool uuid;
  e uuid;
  v_payer uuid;
  v_people uuid[];
  i integer;
  v_day date;
begin
  select p.user_id, p.id into me_uid, me
  from public.people p join auth.users u on u.id = p.user_id
  where coalesce(u.email, '') not like '%@demo.hisaab.invalid'
    and (v_email is null or lower(u.email) = lower(v_email))
  order by u.last_sign_in_at desc nulls last, p.created_at desc
  limit 1;
  if me is null then
    raise exception 'No profile found. Sign in to the app, finish "Set up your profile", then run this again.';
  end if;
  if exists (select 1 from public.people where phone like '+120255501%') then
    raise exception 'Demo data is already there. Run supabase/demo/remove_demo.sql first to start over.';
  end if;

  -- People ------------------------------------------------------------------
  r_uid  := pg_temp.demo_user('Rahul Verma',  '+12025550101', 'rahul.demo@okaxis');
  p_uid  := pg_temp.demo_user('Priya Nair',   '+12025550102', 'priya.demo@oksbi');
  a_uid  := pg_temp.demo_user('Amit Shah',    '+12025550103', null);
  n_uid  := pg_temp.demo_user('Neha Kapoor',  '+12025550104', 'neha.demo@okicici');
  j_uid  := pg_temp.demo_user('Arjun Kapoor', '+12025550105', null);
  s_uid  := pg_temp.demo_user('Sneha Iyer',   '+12025550106', 'sneha.demo@ybl');
  dk_uid := pg_temp.demo_user('Deepak Rao',   '+12025550108', null);
  i_uid  := pg_temp.demo_user('Ishita Sen',   '+12025550109', null);
  select id into rahul  from public.people where user_id = r_uid;
  select id into priya  from public.people where user_id = p_uid;
  select id into amit   from public.people where user_id = a_uid;
  select id into neha   from public.people where user_id = n_uid;
  select id into arjun  from public.people where user_id = j_uid;
  select id into sneha  from public.people where user_id = s_uid;
  select id into deepak from public.people where user_id = dk_uid;
  select id into ishita from public.people where user_id = i_uid;

  -- Your contacts (Kabir isn't on Hisaab: he exists only as your contact).
  perform pg_temp.act(me_uid);
  perform public.add_contact('+12025550101', 'Rahul');
  perform public.add_contact('+12025550102', 'Priya');
  perform public.add_contact('+12025550103', 'Amit');
  perform public.add_contact('+12025550104', 'Neha');
  perform public.add_contact('+12025550105', 'Arjun');
  perform public.add_contact('+12025550106', 'Sneha');
  perform public.add_contact('+12025550108', 'Deepak');
  perform public.add_contact('+12025550109', 'Ishita');
  kabir := public.add_contact('+12025550107', 'Kabir');
  -- Amit and you keep exact accounts; everyone else is baari (take turns).
  perform public.set_contact_prefs(amit, 'exact', 0, 50000, 14);

  -- Their contacts (so they can add entries with you).
  perform pg_temp.act(r_uid); perform public.add_contact((select phone from public.people where id = me), 'Me');
  perform pg_temp.act(p_uid); perform public.add_contact((select phone from public.people where id = me), 'Me');
  perform pg_temp.act(a_uid); perform public.add_contact((select phone from public.people where id = me), 'Me');
  perform pg_temp.act(n_uid); perform public.add_contact((select phone from public.people where id = me), 'Me');
  perform public.add_contact('+12025550105', 'Arjun');
  perform pg_temp.act(j_uid); perform public.add_contact((select phone from public.people where id = me), 'Me');
  perform public.add_contact('+12025550104', 'Neha');
  perform pg_temp.act(s_uid); perform public.add_contact((select phone from public.people where id = me), 'Me');
  perform public.add_contact('+12025550101', 'Rahul');

  -- Rahul: baari friend who is behind -------------------------------------------
  perform pg_temp.act(me_uid);
  e := public.save_expense(null, 'Dinner at Toit', 640000, d - 40, null, 'equal', pg_temp.eq(me, 640000, array[me, rahul]));
  perform pg_temp.act(r_uid);
  perform public.react_to_entry(e, 'confirmed', null);
  perform public.save_expense(null, '🎬 Movie night', 64000, d - 33, null, 'equal', pg_temp.eq(rahul, 64000, array[me, rahul]));
  perform pg_temp.act(me_uid);
  e := public.save_expense(null, '🚕 Cab to airport', 76000, d - 26, null, 'equal', pg_temp.eq(me, 76000, array[me, rahul]));
  -- ...then corrected, so the entry has an edit in its history.
  perform public.save_expense(e, '🚕 Cab to airport (with toll)', 82000, d - 26, null, 'equal', pg_temp.eq(me, 82000, array[me, rahul]), 1);
  -- Lent / borrowed: money handed over without a bill.
  perform public.save_payment(null, me, rahul, 200000, d - 15, 'upi', 'Petrol money', null, null, null);
  -- Deleted entry (shows in Activity; can be restored).
  e := public.save_expense(null, '🍕 Pizza (added twice by mistake)', 50000, d - 7, null, 'equal', pg_temp.eq(me, 50000, array[me, rahul]));
  perform public.delete_entry(e);
  perform public.save_shortcut('☕ Chai with Rahul', '☕ Chai', 6000, null,
    jsonb_build_array(jsonb_build_object('key', me, 'repId', me, 'memberIds', jsonb_build_array(me)),
                      jsonb_build_object('key', rahul, 'repId', rahul, 'memberIds', jsonb_build_array(rahul))));

  -- Priya: you're behind; she added a few things; she questioned one -------------
  perform pg_temp.act(p_uid);
  perform public.save_expense(null, 'Brunch at Social', 180000, d - 18, null, 'equal', pg_temp.eq(priya, 180000, array[me, priya]));
  perform public.save_expense(null, '🚕 Uber pool', 34000, d - 1, null, 'equal', pg_temp.eq(priya, 34000, array[me, priya]));
  perform pg_temp.act(me_uid);
  e := public.save_expense(null, '🛒 DMart groceries', 115000, d - 10, null, 'equal', pg_temp.eq(me, 115000, array[me, priya]));
  perform pg_temp.act(p_uid);
  perform public.react_to_entry(e, 'questioned', 'Wasn''t half of it your protein powder? 😄');

  -- Amit: exact accounts -------------------------------------------------------
  perform pg_temp.act(me_uid);
  perform public.save_expense(null, '☕ Chai & bun maska', 7400, d - 9, null, 'equal', pg_temp.eq(me, 7400, array[me, amit]));
  perform pg_temp.act(a_uid);
  perform public.save_expense(null, '🏸 Badminton court', 60000, d - 6, null, 'equal', pg_temp.eq(amit, 60000, array[me, amit]));

  -- Neha & Arjun: a couple, kept as one pair ---------------------------------------
  perform pg_temp.act(me_uid);
  perform public.save_household(null, 'Neha & Arjun', array[neha, arjun]);
  -- You paid brunch; the couple counts as one unit with 2 shares, booked on Neha.
  perform public.save_expense(null, 'Sunday brunch', 300000, d - 21, null, 'exact',
    jsonb_build_array(jsonb_build_object('person_id', me, 'paid', 300000, 'owed', 100000),
                      jsonb_build_object('person_id', neha, 'paid', 0, 'owed', 200000)));
  -- Arjun pays you back for both of them: Neha now owes Arjun instead of you.
  perform pg_temp.act(j_uid);
  perform public.save_payment(null, arjun, me, 200000, d - 14, 'upi', 'Brunch — for both of us',
    jsonb_build_array(jsonb_build_object('debtor', neha, 'creditor', me, 'amount', 200000),
                      jsonb_build_object('debtor', arjun, 'creditor', neha, 'amount', 200000)), null, null);
  perform pg_temp.act(n_uid);
  perform public.save_expense(null, '🎤 Concert tickets', 900000, d - 2, null, 'equal', pg_temp.eq(neha, 900000, array[me, neha, arjun]));

  -- Sneha: treats, a "chhod do", and a small difference that counts as even ----------
  perform pg_temp.act(s_uid);
  perform public.save_treat(sneha, 420000, '🎂 Birthday dinner', 'Birthday', d - 30, array[me, rahul], null);
  perform pg_temp.act(me_uid);
  perform public.save_treat(me, 250000, '🎉 Promotion party', 'Promotion', d - 6, array[sneha, rahul, priya], null);
  perform public.save_expense(null, '☕ Chai', 8000, d - 5, null, 'equal', pg_temp.eq(me, 8000, array[me, sneha]));
  perform public.forgive_balance(sneha, 4000, 'Chai is on me');
  perform pg_temp.act(s_uid);
  perform public.save_expense(null, '🥟 Momos', 18000, d - 4, null, 'equal', pg_temp.eq(sneha, 18000, array[me, sneha]));
  perform pg_temp.act(me_uid);

  -- Kabir: not on Hisaab yet, owes you for a while (a gentle reminder shows up) ---------
  perform public.save_expense(null, '🏏 IPL tickets', 300000, d - 30, null, 'equal', pg_temp.eq(me, 300000, array[me, kabir]));

  -- Goa trip: kitty, item split, a big shared bill ---------------------------------
  goa := public.create_group('Goa trip', '🏖️', array[rahul, priya, ishita]);
  perform public.set_group_prefs(goa, 'trip', 0, me);
  perform public.add_to_kitty(goa, rahul, 500000, d - 13, 'upi');
  perform public.add_to_kitty(goa, priya, 500000, d - 13, 'upi');
  perform public.add_to_kitty(goa, ishita, 500000, d - 13, 'cash');
  perform public.save_kitty_expense('🛵 Scooty rental (3 days)', 480000, d - 12, goa, 'equal', pg_temp.eq(me, 480000, array[me, rahul, priya, ishita]));
  perform public.save_kitty_expense('🏝️ Beach shack lunch', 360000, d - 11, goa, 'equal', pg_temp.eq(me, 360000, array[me, rahul, priya, ishita]));
  perform pg_temp.act(p_uid);
  perform public.save_expense(null, '🏡 Villa (2 nights)', 1600000, d - 12, goa, 'equal', pg_temp.eq(priya, 1600000, array[me, rahul, priya, ishita]));
  perform pg_temp.act(r_uid);
  -- Item split: shares worked out by the app's own rules (src/lib/itemSplit.ts).
  perform public.save_itemized_expense(null, '🦞 Thalassa dinner', d - 10, goa,
    jsonb_build_array(
      jsonb_build_object('person_id', me,    'paid', 0,      'owed', 159483),
      jsonb_build_object('person_id', rahul, 'paid', 743000, 'owed', 221399),
      jsonb_build_object('person_id', priya, 'paid', 0,      'owed', 221398),
      jsonb_build_object('person_id', ishita, 'paid', 0,      'owed', 140720)),
    jsonb_build_object(
      'lines', jsonb_build_array(
        jsonb_build_object('name', 'Seafood platter', 'amount', 320000, 'people', jsonb_build_array(me, rahul, priya)),
        jsonb_build_object('name', 'Veg thali',       'amount', 90000,  'people', jsonb_build_array(ishita)),
        jsonb_build_object('name', 'Cocktails',       'amount', 180000, 'people', jsonb_build_array(rahul, priya)),
        jsonb_build_object('name', 'Mocktails',       'amount', 70000,  'people', jsonb_build_array(me, ishita))),
      'tax', 33000, 'tip', 50000, 'discount', 0));
  perform pg_temp.act(i_uid);
  perform public.save_payment(null, ishita, me, 50000, d - 8, 'upi', 'Goa settle', null, goa, null);

  -- Office chai: daily, rotating payer, not everyone in every day -------------------
  perform pg_temp.act(me_uid);
  office := public.create_group('Office chai', '☕', array[rahul, deepak, ishita]);
  perform public.set_group_prefs(office, 'office', 10000, null);
  i := 0;
  for v_day in select g::date from generate_series(d - 15, d - 1, interval '1 day') g
               where extract(isodow from g) < 6 loop
    v_payer := (array[rahul, me, deepak, ishita])[1 + i % 4];
    v_people := case when i % 3 = 2 then array_remove(array[me, rahul, deepak, ishita], case when v_payer = deepak then ishita else deepak end)
                     else array[me, rahul, deepak, ishita] end;
    perform pg_temp.act(case v_payer when rahul then r_uid when deepak then dk_uid when ishita then i_uid else me_uid end);
    perform public.save_expense(null, case when i % 2 = 0 then '☕ Chai + samosa' else '☕ Chai + biscuits' end,
      (cardinality(v_people) * 4000 + (i % 3) * 1000)::bigint, v_day, office, 'equal',
      pg_temp.eq(v_payer, (cardinality(v_people) * 4000 + (i % 3) * 1000)::bigint, v_people));
    i := i + 1;
  end loop;
  -- A weekday snack box, started 3 days ago: the missed days get posted when you open the app.
  perform pg_temp.act(me_uid);
  perform public.save_recurring(null, office, '🥪 Snack box', 24000, 'equal', pg_temp.eq(me, 24000, array[me, rahul, deepak, ishita]), 1, d - 3, 'weekdays');
  perform public.save_shortcut('🍱 Lunch crew', '🍱 Lunch', null, office,
    (select jsonb_agg(jsonb_build_object('key', m, 'repId', m, 'memberIds', jsonb_build_array(m)))
     from unnest(array[me, rahul, deepak, ishita]) m));

  -- Car pool: fuel split per trip, morning and evening, rotating driver --------------
  perform pg_temp.act(me_uid);
  carpool := public.create_group('Car pool', '🚗', array[deepak, ishita]);
  perform public.set_carpool_prefs(carpool, 'split', 30000);
  i := 0;
  for v_day in select g::date from generate_series(d - 8, d - 1, interval '1 day') g
               where extract(isodow from g) < 6 loop
    v_payer := (array[deepak, me, ishita])[1 + i % 3];
    perform pg_temp.act(case v_payer when deepak then dk_uid when ishita then i_uid else me_uid end);
    perform public.save_carpool_trip(carpool, v_day, 'am', v_payer, array_remove(array[me, deepak, ishita], v_payer), null);
    -- Ishita leaves early on alternate evenings.
    v_people := array_remove(array_remove(array[me, deepak, ishita], v_payer), case when i % 2 = 1 and v_payer <> ishita then ishita end);
    perform public.save_carpool_trip(carpool, v_day, 'pm', v_payer, v_people, case when i = 2 then 35000 end);
    i := i + 1;
  end loop;

  -- Flat 302: rent and WiFi every month --------------------------------------------
  flat := public.create_group('Flat 302', '🏠', array[priya]);
  perform public.set_group_prefs(flat, 'home', 10000, null);
  perform public.save_recurring(null, flat, '📶 WiFi', 99900, 'equal', pg_temp.eq(me, 99900, array[me, priya]), 5, date_trunc('month', d)::date, 'monthly');
  perform pg_temp.act(p_uid);
  perform public.save_recurring(null, flat, '🏠 Rent', 1800000, 'equal', pg_temp.eq(priya, 1800000, array[me, priya]), 1, date_trunc('month', d)::date, 'monthly');
  perform public.save_expense(null, '🧑‍🍳 Cook salary', 600000, d - 20, flat, 'equal', pg_temp.eq(priya, 600000, array[me, priya]));

  -- Share links: see a friend's view of your hisaab, no login ------------------------
  perform pg_temp.act(me_uid);
  perform public.create_share_link(rahul);
  perform public.create_share_link(kabir);

  -- Make history look lived-in: entries happened on their dates, not all just now.
  -- The last two days stay recent so "To check" has something in it.
  update public.entries x
     set created_at = x.occurred_on + time '19:30' + (random() * interval '90 minutes')
   where x.occurred_on < d - 2
     and exists (select 1 from public.entry_parts ep where ep.entry_id = x.id
                 and ep.person_id in (rahul, priya, amit, neha, arjun, sneha, deepak, ishita, kabir));
  update public.entry_events ev
     set created_at = x.created_at + (ev.id - (select min(id) from public.entry_events f where f.entry_id = x.id)) * interval '7 minutes'
    from public.entries x
   where ev.entry_id = x.id and x.occurred_on < d - 2
     and exists (select 1 from public.entry_parts ep where ep.entry_id = x.id
                 and ep.person_id in (rahul, priya, amit, neha, arjun, sneha, deepak, ishita, kabir));
  update public.entry_reactions rx set updated_at = x.created_at + interval '1 day'
    from public.entries x where rx.entry_id = x.id and x.occurred_on < d - 2;
end;
$$;

-- Links to open (in a private window) to see the hisaab from Rahul's and Kabir's side.
select p.name as friend, 'https://vikaspal1704.github.io/hisaab/#/s/' || s.token as link_without_login
from public.share_links s join public.people p on p.id = s.person_id
where p.phone like '+120255501%' and s.revoked_at is null;
