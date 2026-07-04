-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query)

alter table blue_table_bonuses add column if not exists note text;
