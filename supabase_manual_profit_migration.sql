-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query)

-- Manual profit override for the open period (NULL = automatic calculation; cleared on period close)
alter table current_period add column if not exists manual_profit numeric;
