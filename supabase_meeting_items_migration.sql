-- ישיבות: shared tasks & talking points table for the two partners.
-- Run once in the project SQL Editor. Additive only - touches nothing else.

create table if not exists public.meeting_items (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('task','topic')),
  body       text not null default '',
  author     text not null default '',
  done       boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.meeting_items enable row level security;

-- Same allow-list policy as every other table (from the Google-auth migration):
create policy allowed_users_only on public.meeting_items
  for all to authenticated
  using (public.is_allowed_user())
  with check (public.is_allowed_user());
