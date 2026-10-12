-- Minimal stand-in for the parts of Supabase the migration relies on.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
-- The columns supabase/demo/seed_demo.sql writes, as in Supabase's auth.users.
create table auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  last_sign_in_at timestamptz,
  confirmation_token text,
  recovery_token text,
  email_change_token_new text,
  email_change text
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
