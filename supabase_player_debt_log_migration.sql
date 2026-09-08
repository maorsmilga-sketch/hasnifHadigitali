-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query)
-- History of player-debt updates (separate from partner debt_log, which is ido/maor only)

create table if not exists player_debt_log (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid references players(id) on delete set null,
  action       text not null,
  amount       numeric not null,
  new_balance  numeric not null,
  description  text not null,
  created_by   text,
  created_at   timestamptz not null default now()
);

alter table player_debt_log disable row level security;
