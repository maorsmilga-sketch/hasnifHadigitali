-- Run once in Supabase SQL Editor
-- Log for player.debt updates on the "חובות" page (club receivable from players).
-- Separate from debt_log (ido/maor) and player_debt_log (owed_to_player).

create table if not exists coffer_debt_log (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid references players(id) on delete set null,
  action       text not null,
  amount       numeric not null default 0,
  old_balance  numeric,
  new_balance  numeric not null,
  description  text,
  created_by   text,
  created_at   timestamptz not null default now()
);

create index if not exists coffer_debt_log_created_at_idx on coffer_debt_log (created_at desc);

-- If using Google Auth RLS, add coffer_debt_log to allowed tables (same as other tables).
