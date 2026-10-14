-- Hisaab v11: fix wrong numbers, and verify numbers over WhatsApp.
--
-- * Fix a friend's number you typed wrong. Their history with you moves to
--   the right number (joining up with anyone already there). Only while they
--   haven't joined, and only when nobody else keeps hisaab with that number
--   on their own. Links sent to the wrong number stop working.
-- * Change your own number. Same rules as signing up: a number that already
--   has history needs proof (WhatsApp/SMS verification or a friend's link).
-- * WhatsApp verification, free to run: the app gives you a short code, you
--   send it from your WhatsApp to Hisaab's WhatsApp number, and the
--   "whatsapp-verify" Edge Function confirms the number it came from. A
--   verified number is accepted wherever an OTP was.
--
-- Additive; safe to run on a live database.

alter table public.people add column phone_verified_at timestamptz;

-- One row per code handed out. Keyed by login (not person) so it also works
-- while signing up.
create table public.phone_verifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  phone text not null,
  code text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  verified_at timestamptz,
  constraint phone_verifications_phone check (phone ~ '^\+[1-9][0-9]{7,14}$')
);
create index phone_verifications_user_idx on public.phone_verifications (user_id, created_at desc);

-- Only reached through the functions below.
alter table public.phone_verifications enable row level security;
revoke all on public.phone_verifications from anon, authenticated;

------------------------------------------------------------------------------
-- WhatsApp verification
------------------------------------------------------------------------------

-- Is p_phone proven to belong to the signed-in login? An SMS OTP login, or a
-- WhatsApp verification in the last hour.
create function public._phone_verified(p_phone text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce('+' || ltrim(nullif(auth.jwt() ->> 'phone', ''), '+') = p_phone, false)
      or exists (select 1 from public.phone_verifications v
                 where v.user_id = auth.uid() and v.phone = p_phone
                   and v.verified_at > now() - interval '1 hour')
$$;

-- Hands out a code to send from p_phone's WhatsApp. At most 10 a day.
create function public.start_phone_verification(p_phone text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  if (select count(*) from public.phone_verifications
      where user_id = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'too_many_verifications' using errcode = 'P0001';
  end if;
  -- 8 characters from a 32-letter alphabet without look-alikes (no 0/O, 1/I).
  -- Random bytes from two v4 UUIDs (their first 4 bytes are fully random; no pgcrypto needed).
  select 'HSB-' || string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + (get_byte(b, i) % 32), 1), '' order by i)
    into v_code
  from (select decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex') as b) r,
       unnest(array[0, 1, 2, 3, 16, 17, 18, 19]) i;
  insert into public.phone_verifications (user_id, phone, code) values (v_uid, p_phone, v_code);
  return v_code;
end;
$$;

-- Has the signed-in login verified p_phone (in the last hour)?
create function public.phone_verification_status(p_phone text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public._phone_verified(p_phone)
$$;

-- Called by the whatsapp-verify Edge Function (service role only) for each
-- incoming message: p_from is the sender's WhatsApp number (digits, as
-- WhatsApp gives it). Confirms the code only if it was sent from the number
-- it was issued for. Returns whether it confirmed something.
create function public.confirm_whatsapp_verification(p_code text, p_from text) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.phone_verifications
     set verified_at = now()
   where code = upper(btrim(p_code))
     and phone = '+' || regexp_replace(coalesce(p_from, ''), '\D', '', 'g')
     and expires_at > now()
     and verified_at is null;
  return found;
end;
$$;

------------------------------------------------------------------------------
-- Signing up: a WhatsApp-verified number counts like an OTP-verified one.
------------------------------------------------------------------------------

create or replace function public.claim_profile(p_name text, p_phone text, p_upi_id text default null, p_invite text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_verified_phone text := nullif(auth.jwt() ->> 'phone', '');
  v_verified boolean;
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
  v_verified := public._phone_verified(p_phone);

  select p.id into v_placeholder
  from public.share_links s join public.people p on p.id = s.person_id
  where s.token = p_invite and s.revoked_at is null and p.phone is null and p.user_id is null
  for update of p;

  select * into v_person from public.people where phone = p_phone for update;
  if found then
    if v_person.user_id is not null then
      raise exception 'phone_taken' using errcode = 'P0001';
    end if;
    if not v_verified
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
       set user_id = v_uid, name = btrim(p_name), upi_id = nullif(btrim(p_upi_id), ''),
           phone_verified_at = case when v_verified then now() end
     where id = v_person.id;
    return v_person.id;
  end if;

  if v_placeholder is not null then
    update public.people
       set phone = p_phone, user_id = v_uid, name = btrim(p_name),
           upi_id = nullif(btrim(p_upi_id), ''), added_by = null,
           phone_verified_at = case when v_verified then now() end
     where id = v_placeholder;
    return v_placeholder;
  end if;

  insert into public.people (phone, name, user_id, upi_id, phone_verified_at)
  values (p_phone, btrim(p_name), v_uid, nullif(btrim(p_upi_id), ''), case when v_verified then now() end)
  returning id into v_existing;
  return v_existing;
end;
$$;

------------------------------------------------------------------------------
-- Changing numbers
------------------------------------------------------------------------------

-- Changes my own number. If the new number already has history (friends kept
-- hisaab with it before I joined), it needs proof: a verified number or the
-- link a friend sent to it; that history then joins mine.
create function public.change_my_phone(p_phone text, p_invite text default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_current text;
  v_verified boolean;
  v_target public.people;
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  select phone into v_current from public.people where id = v_me for update;
  v_verified := public._phone_verified(p_phone);
  if v_current = p_phone then
    if v_verified then
      update public.people set phone_verified_at = now() where id = v_me;
    end if;
    return v_me;
  end if;

  select * into v_target from public.people where phone = p_phone for update;
  if found then
    if v_target.user_id is not null then
      raise exception 'phone_taken' using errcode = 'P0001';
    end if;
    if not v_verified
       and (exists (select 1 from public.entry_parts where person_id = v_target.id)
            or exists (select 1 from public.group_members where person_id = v_target.id)
            or exists (select 1 from public.household_members where person_id = v_target.id))
       and not exists (select 1 from public.share_links s
                       where s.token = p_invite and s.person_id = v_target.id and s.revoked_at is null) then
      raise exception 'phone_needs_invite' using errcode = 'P0001';
    end if;
    -- Frees the number, then brings its history over to me.
    perform public._merge_person(v_target.id, v_me);
  end if;

  update public.people
     set phone = p_phone, phone_verified_at = case when v_verified then now() end
   where id = v_me;
  return v_me;
end;
$$;

-- Fixes a number I typed wrong for a friend who hasn't joined. Everything
-- about them moves to the right number (merging with whoever has it).
-- Refused when someone else keeps hisaab with that number without me, since
-- for them it may be the right number.
create function public.fix_contact_phone(p_person uuid, p_phone text) returns uuid
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
  if not found or v_friend.phone is null
     or not exists (select 1 from public.contacts where owner_id = v_me and person_id = p_person) then
    raise exception 'unknown_person' using errcode = 'P0001';
  end if;
  if v_friend.user_id is not null then
    raise exception 'already_joined' using errcode = 'P0001';
  end if;
  if v_friend.phone = p_phone then
    return p_person;
  end if;

  -- Someone else saved this number themselves, or has entries, groups or
  -- pairs with it that don't involve me.
  if exists (select 1 from public.contacts c
             where c.person_id = p_person and c.owner_id <> v_me and c.nickname is not null)
     or exists (select 1 from public.entry_parts ep join public.entries e on e.id = ep.entry_id
                where ep.person_id = p_person and e.created_by <> v_me
                  and not exists (select 1 from public.entry_parts m where m.entry_id = e.id and m.person_id = v_me))
     or exists (select 1 from public.group_members gm
                where gm.person_id = p_person
                  and not exists (select 1 from public.group_members m where m.group_id = gm.group_id and m.person_id = v_me))
     or exists (select 1 from public.household_members hm where hm.person_id = p_person and hm.owner_id <> v_me) then
    raise exception 'number_shared' using errcode = 'P0001';
  end if;

  -- Links sent to the wrong number must not let its owner in.
  update public.share_links set revoked_at = now() where person_id = p_person and revoked_at is null;

  select id into v_into from public.people where phone = p_phone for update;
  if v_into is null then
    update public.people set phone = p_phone where id = p_person;
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

-- my_people() also says whose number is verified.
drop function public.my_people();
create function public.my_people()
returns table (
  id uuid, display_name text, phone text, upi_id text,
  is_registered boolean, is_contact boolean, is_me boolean, can_set_phone boolean, phone_verified boolean
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
         p.phone is null and p.user_id is null and p.added_by = me.id,
         p.phone_verified_at is not null
  from visible v
  join public.people p on p.id = v.person_id
  cross join me
  left join public.contacts c on c.owner_id = me.id and c.person_id = p.id
$$;

------------------------------------------------------------------------------
-- Privileges: only this migration's new functions.
------------------------------------------------------------------------------

revoke execute on function
  public._phone_verified(text),
  public.start_phone_verification(text),
  public.phone_verification_status(text),
  public.confirm_whatsapp_verification(text, text),
  public.change_my_phone(text, text),
  public.fix_contact_phone(uuid, text),
  public.my_people()
from public, anon, authenticated;
grant execute on function
  public.start_phone_verification(text),
  public.phone_verification_status(text),
  public.change_my_phone(text, text),
  public.fix_contact_phone(uuid, text),
  public.my_people()
to authenticated;
grant execute on function public.confirm_whatsapp_verification(text, text) to service_role;
