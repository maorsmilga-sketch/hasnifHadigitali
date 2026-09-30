-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query)

-- Add BadBeat usage percentage (default 65%, never reset on period close)
alter table current_period add column if not exists badbeat_percent numeric default 65;

-- Add Bank Leumi balance (display-only, never reset on period close)
alter table current_period add column if not exists bank_leumi numeric default 0;
