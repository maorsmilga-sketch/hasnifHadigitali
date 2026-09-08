-- Run this once in the Supabase SQL Editor
-- Amount the club owes a player (חובות לשחקנים). Separate from players.debt
-- which is what the player owes the club (shown on חובות with Ido/Maor).

alter table players add column if not exists owed_to_player numeric not null default 0;
