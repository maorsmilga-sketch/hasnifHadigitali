-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query)
-- Adds old_balance so the debt log can show before/after values

alter table player_debt_log add column if not exists old_balance numeric;
