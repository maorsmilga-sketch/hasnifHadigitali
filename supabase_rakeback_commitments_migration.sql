-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query)

create table if not exists rakeback_commitments (
  id          int primary key default 1,
  data        jsonb not null default '{"people":[],"paymentCols":11}',
  updated_at  timestamptz not null default now()
);

insert into rakeback_commitments (id, data)
values (1, '{"people":[],"paymentCols":11}')
on conflict (id) do nothing;

-- Match the access policy of the other tables so the app's anon key can read/write
alter table rakeback_commitments disable row level security;
