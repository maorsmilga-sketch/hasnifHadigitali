-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query)

create table if not exists debt_log (
  id          uuid primary key default gen_random_uuid(),
  person      text not null check (person in ('ido','maor')),
  amount      numeric not null,
  created_by  text,
  created_at  timestamptz not null default now()
);

-- Match the access policy of the existing tables so the app's anon key
-- can read/write it (same fix needed for blue_table_expenses earlier):
alter table debt_log disable row level security;
