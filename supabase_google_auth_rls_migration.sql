-- Lock every public table to signed-in, allow-listed Google accounts.
-- Run only after the Google sign-in version of the site is live and both users have signed in.

create table if not exists public.allowed_users (
  email    text primary key,
  user_key text not null
);
alter table public.allowed_users enable row level security;

insert into public.allowed_users (email, user_key) values
  ('reuvenido@gmail.com',  'ido'),
  ('maorsmilga@gmail.com', 'maor')
on conflict (email) do update set user_key = excluded.user_key;

create or replace function public.is_allowed_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_users
    where email = lower(auth.jwt() ->> 'email')
  );
$$;

revoke all on function public.is_allowed_user() from public, anon;
grant execute on function public.is_allowed_user() to authenticated;

do $$
declare
  t text;
  p record;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> 'allowed_users'
  loop
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;

    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy allowed_users_only on public.%I for all to authenticated
         using (public.is_allowed_user()) with check (public.is_allowed_user())', t);
  end loop;
end $$;

-- Rollback (re-opens every table to the anon key):
-- do $$
-- declare t text;
-- begin
--   for t in select tablename from pg_tables where schemaname = 'public' loop
--     execute format('alter table public.%I disable row level security', t);
--   end loop;
-- end $$;
