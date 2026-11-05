-- Standing monthly expenses (מנויים חודשיים) for הוצאות כלליות.
-- Run once in the project SQL Editor. Additive only - touches nothing else.
-- Approved by Maor Nov 5: 65₪ app subscription + 40₪ phone subscription,
-- monthly from 2026-11, catch-up of missed months on next app open,
-- per-expense stop/restart, ledger-only.

create table if not exists public.standing_expenses (
  id                uuid primary key default gen_random_uuid(),
  label             text not null,
  amount_ils        numeric not null,
  category          text not null default 'subscription',
  other_description text,
  active            boolean not null default true,
  since_month       text not null default to_char(now(), 'YYYY-MM'),
  created_at        timestamptz not null default now()
);

create table if not exists public.standing_expense_applications (
  standing_id uuid not null references public.standing_expenses(id) on delete cascade,
  month       text not null,
  expense_id  uuid,
  applied_at  timestamptz not null default now(),
  primary key (standing_id, month)
);

alter table public.standing_expenses enable row level security;
alter table public.standing_expense_applications enable row level security;

create policy allowed_users_only on public.standing_expenses
  for all to authenticated
  using (public.is_allowed_user()) with check (public.is_allowed_user());
create policy allowed_users_only on public.standing_expense_applications
  for all to authenticated
  using (public.is_allowed_user()) with check (public.is_allowed_user());

-- Seed the two approved standing expenses:
insert into public.standing_expenses (label, amount_ils, category, other_description, since_month)
values
  ('מנוי אפליקציה', 65, 'subscription', null, '2026-11'),
  ('מנוי טלפון',    40, 'other',        'מנוי טלפון', '2026-11')
on conflict do nothing;

-- Atomic monthly apply: for each active standing expense x each given month,
-- claim the (standing_id, month) occurrence via the registry PK, then insert
-- the matching blue_table_expenses row - all in one transaction. Concurrent
-- calls cannot double-book: ON CONFLICT DO NOTHING yields no row, no expense.
-- A crash rolls back claim and expense together.
create or replace function public.apply_standing_expenses(p_months text[], p_current_month text)
returns setof uuid
language plpgsql
as $$
declare
  s record;
  m text;
  claimed uuid;
  eid uuid;
begin
  for s in select * from public.standing_expenses where active loop
    foreach m in array p_months loop
      if m >= s.since_month and m <= p_current_month then
        insert into public.standing_expense_applications (standing_id, month)
        values (s.id, m)
        on conflict do nothing
        returning standing_id into claimed;
        if claimed is not null then
          insert into public.blue_table_expenses (description, amount_ils, category, other_description, created_by, created_at)
          values (
            case when m = p_current_month then s.label else s.label || ' · ' || m end,
            s.amount_ils, s.category, s.other_description, 'אוטומטי 📅', now()
          )
          returning id into eid;
          update public.standing_expense_applications set expense_id = eid
          where standing_id = s.id and month = m;
          return next eid;
        end if;
      end if;
    end loop;
  end loop;
  return;
end $$;

revoke all on function public.apply_standing_expenses(text[], text) from public, anon;
grant execute on function public.apply_standing_expenses(text[], text) to authenticated;
