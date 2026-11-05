-- Standing monthly expenses (מנויים חודשיים) for הוצאות כלליות. v2.
-- Approved by Maor Nov 5: 65₪ מנוי אפליקציה + 40₪ מנוי טלפון, start 2026-11, catchup approved.
-- Safely rerunnable: stable seed identity, guarded policies, additive only - touches nothing else.

create table if not exists public.standing_expenses (
  id                uuid primary key default gen_random_uuid(),
  label             text not null,
  amount_ils        numeric not null check (amount_ils > 0),
  category          text not null default 'subscription',
  other_description text,
  active            boolean not null default true,
  since_month       text not null default to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM'),
  created_at        timestamptz not null default now()
);

-- Stable natural key for rerun-safe seeding (guarded so a pre-existing table also gets it):
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'standing_expenses_label_key' and conrelid = 'public.standing_expenses'::regclass
  ) then
    alter table public.standing_expenses add constraint standing_expenses_label_key unique (label);
  end if;
end $$;

create table if not exists public.standing_expense_applications (
  standing_id uuid not null references public.standing_expenses(id) on delete cascade,
  month       text not null,
  expense_id  uuid,
  applied_at  timestamptz not null default now(),
  primary key (standing_id, month)
);

alter table public.standing_expenses enable row level security;
alter table public.standing_expense_applications enable row level security;

-- Same allow-list policy as every other table; drop-if-exists makes rerun safe:
drop policy if exists allowed_users_only on public.standing_expenses;
create policy allowed_users_only on public.standing_expenses
  for all to authenticated
  using (public.is_allowed_user()) with check (public.is_allowed_user());
drop policy if exists allowed_users_only on public.standing_expense_applications;
create policy allowed_users_only on public.standing_expense_applications
  for all to authenticated
  using (public.is_allowed_user()) with check (public.is_allowed_user());

-- Seed the two approved standing expenses; unique label makes reruns no-ops,
-- and existing (possibly user-edited) rows are never deleted or overwritten:
insert into public.standing_expenses (label, amount_ils, category, other_description, since_month)
values
  ('מנוי אפליקציה', 65, 'subscription', null, '2026-11'),
  ('מנוי טלפון',    40, 'other',        'מנוי טלפון', '2026-11')
on conflict (label) do nothing;

-- Atomic monthly apply. For each active standing expense x each requested month the
-- (standing_id, month) occurrence is claimed via the registry PK inside the SAME
-- transaction as the expense insert: concurrent callers cannot double-book
-- (ON CONFLICT DO NOTHING yields no row -> no expense), and a crash rolls back
-- claim and expense together. The server, not the client, decides the current
-- month (Asia/Jerusalem): malformed months abort with an error, future months
-- are silently skipped (booked on a later open), months before a subscription's
-- since_month are never booked (stop/restart is future-only, no retroactive charges).
create or replace function public.apply_standing_expenses(p_months text[])
returns setof uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  s record;
  m text;
  v_now_month text := to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM');
  claimed uuid;
  eid uuid;
begin
  if p_months is null or coalesce(array_length(p_months, 1), 0) = 0 then
    return;
  end if;
  if array_length(p_months, 1) > 120 then
    raise exception 'p_months may contain at most 120 months';
  end if;
  foreach m in array p_months loop
    if m !~ '^\d{4}-(0[1-9]|1[0-2])$' then
      raise exception 'invalid month %', m;
    end if;
  end loop;
  for s in select * from public.standing_expenses where active loop
    foreach m in array p_months loop
      if m >= s.since_month and m <= v_now_month then
        insert into public.standing_expense_applications (standing_id, month)
        values (s.id, m)
        on conflict (standing_id, month) do nothing
        returning standing_id into claimed;
        if claimed is not null then
          insert into public.blue_table_expenses (description, amount_ils, category, other_description, created_by, created_at)
          values (
            case when m = v_now_month then s.label else s.label || ' · ' || m end,
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

revoke all on function public.apply_standing_expenses(text[]) from public, anon;
grant execute on function public.apply_standing_expenses(text[]) to authenticated;
