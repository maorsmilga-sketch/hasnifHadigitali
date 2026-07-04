-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query)

alter table players add column if not exists debt numeric not null default 0;
