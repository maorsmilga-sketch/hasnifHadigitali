-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query)

-- נזיל נוסף: additional liquid balances per team + branch, reset on period close
alter table current_period add column if not exists bank_maor numeric default 0;
alter table current_period add column if not exists bank_ido numeric default 0;
alter table current_period add column if not exists pocket_maor numeric default 0;
alter table current_period add column if not exists pocket_ravit numeric default 0;
alter table current_period add column if not exists pocket_ido numeric default 0;
alter table current_period add column if not exists pocket_dorin numeric default 0;
alter table current_period add column if not exists bit_other_amount numeric default 0;
alter table current_period add column if not exists bit_other_name text default '';
alter table current_period add column if not exists bit_other_team text default '';

-- History: keep the נזיל נוסף split per closed period (additive, existing rows untouched)
alter table history add column if not exists liquid_extra_maor numeric;
alter table history add column if not exists liquid_extra_ido numeric;
alter table history add column if not exists liquid_extra_branch numeric;
