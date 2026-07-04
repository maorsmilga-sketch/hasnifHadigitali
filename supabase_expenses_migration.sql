-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query)

create table if not exists blue_table_expenses (
  id                 uuid primary key default gen_random_uuid(),
  description        text not null,
  amount_ils         numeric not null,
  category           text not null check (category in ('subscription','event','other')),
  other_description  text,
  created_by         text,
  created_at         timestamptz not null default now()
);

alter table history add column if not exists total_general_expenses_ils numeric;
alter table history add column if not exists detail_expenses jsonb;

-- Match the access policy of the existing blue_table_* tables so the app's
-- anon key can read/write it. If those tables have RLS disabled, mirror that:
alter table blue_table_expenses disable row level security;

-- If instead the other blue_table_* tables use RLS + policies, replace the
-- line above with equivalent policies for blue_table_expenses, e.g.:
-- alter table blue_table_expenses enable row level security;
-- create policy "allow all" on blue_table_expenses for all using (true) with check (true);
