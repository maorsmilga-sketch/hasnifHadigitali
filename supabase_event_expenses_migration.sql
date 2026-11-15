-- אירועים: additive storage and one-to-one ordinary expense linkage.
-- Run once in Supabase SQL Editor after reviewing. Rerunnable; no seeds/data resets.
-- Requires existing public.is_allowed_user(), blue_table_expenses and history.
begin;
create table if not exists public.event_expense_events (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 1 and 160),
 event_date date not null,
 location text not null default '' check (length(location) <= 300),
 archived boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.event_expense_items (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.event_expense_events(id),
 category text not null check(category in ('alcohol','pizza','snacks','food','venue','other')),
 description text not null default '' check(length(description) <= 500),
 amount_ils numeric(14,2) not null check(amount_ils > 0),
 payer text not null check(payer in ('maor','ido','branch')),
 closed_history_id text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(category <> 'other' or length(trim(description)) > 0)
);
create index if not exists event_expense_items_event_idx on public.event_expense_items(event_id);
create table if not exists public.event_expense_interest (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.event_expense_events(id),
 player_id uuid not null,
 player_name text not null check(length(trim(player_name)) > 0),
 paid boolean not null default false,
 amount_ils numeric(14,2) not null default 50 check(amount_ils > 0),
 method text check(method in ('bit','cash','paybox')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(event_id,player_id),
 check((paid and method is not null) or (not paid and method is null))
);
-- Retry identity for the narrow atomic archive operation (not financial totals).
create table if not exists public.event_expense_close_runs (
 id uuid primary key,
 history_id text not null,
 created_at timestamptz not null default now()
);
-- Keep stable event identity across ordinary-expense deletion on period close.
alter table public.blue_table_expenses add column if not exists event_item_id uuid;
create unique index if not exists blue_table_expenses_event_item_unique
 on public.blue_table_expenses(event_item_id) where event_item_id is not null;

-- New tables follow the same allow-list as the rest of the app.
-- Writes go through scoped functions so direct clients cannot bypass linked-row guards.
do $$ declare t text; begin
 foreach t in array array['event_expense_events','event_expense_items','event_expense_interest','event_expense_close_runs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('drop policy if exists allowed_users_read on public.%I',t);
  execute format('create policy allowed_users_read on public.%I for select to authenticated using(public.is_allowed_user())',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('revoke insert,update,delete on public.%I from anon,authenticated',t);
 end loop;
end $$;

create or replace function public.event_expense_authorize()
returns void language plpgsql security invoker set search_path=public as $$
begin
 if not public.is_allowed_user() then raise exception 'Not authorized'; end if;
 -- Shared by every module write and the scoped close operation.
 perform pg_advisory_xact_lock(684271915);
end $$;

create or replace function public.event_expense_save_event(p_data jsonb)
returns setof public.event_expense_events
language plpgsql security definer set search_path=public as $$
declare eid uuid := (p_data->>'id')::uuid; oldrow public.event_expense_events;
begin
 perform public.event_expense_authorize();
 select * into oldrow from public.event_expense_events where id=eid;
 if found and oldrow.updated_at is distinct from (p_data->>'expected_updated_at')::timestamptz then
  if oldrow.name=trim(p_data->>'name') and oldrow.event_date=(p_data->>'event_date')::date and oldrow.location=coalesce(p_data->>'location','') and oldrow.archived=coalesce((p_data->>'archived')::boolean,false) then
   return query select * from public.event_expense_events where id=eid; return;
  end if;
  raise exception 'האירוע השתנה במכשיר אחר. רענן לפני עריכה';
 end if;
 if oldrow.id is not null then
  update public.event_expense_events set name=trim(p_data->>'name'),event_date=(p_data->>'event_date')::date,
   location=coalesce(p_data->>'location',''),archived=coalesce((p_data->>'archived')::boolean,false),updated_at=clock_timestamp() where id=eid;
 else
  insert into public.event_expense_events(id,name,event_date,location,archived)
   values(eid,trim(p_data->>'name'),(p_data->>'event_date')::date,coalesce(p_data->>'location',''),false);
 end if;
 if oldrow.id is not null and oldrow.name is distinct from trim(p_data->>'name') then
  perform set_config('event_expenses.internal','yes',true);
  update public.blue_table_expenses b set description=trim(p_data->>'name')||' · '||
   case i.category when 'alcohol' then 'אלכוהול' when 'pizza' then 'פיצות' when 'snacks' then 'חטיפים / נשנושים' when 'food' then 'חטיפים / נשנושים' when 'venue' then 'תשלום למקום' else 'אחר' end||
   case when length(i.description)>0 then ' · '||i.description else '' end
  from public.event_expense_items i where b.event_item_id=i.id and i.event_id=eid and i.closed_history_id is null;
 end if;
 return query select * from public.event_expense_events where id=eid;
end $$;

create or replace function public.event_expense_save_item(p_data jsonb)
returns setof public.event_expense_items
language plpgsql security definer set search_path=public as $$
declare iid uuid:=(p_data->>'id')::uuid; er public.event_expense_events; ir public.event_expense_items; label text;
begin
 perform public.event_expense_authorize();
 select * into er from public.event_expense_events where id=(p_data->>'event_id')::uuid;
 if not found or er.archived then raise exception 'יש לפתוח אירוע פעיל לפני עריכה'; end if;
 select * into ir from public.event_expense_items where id=iid;
 if found then
  if ir.event_id<>er.id or ir.closed_history_id is not null then raise exception 'ההוצאה שייכת לתקופה סגורה ולא ניתנת לעריכה'; end if;
  -- Identical retries are safe; conflicting changes from another device are not overwritten.
  if ir.updated_at is distinct from (p_data->>'expected_updated_at')::timestamptz then
   if ir.category=p_data->>'category' and ir.description=coalesce(p_data->>'description','') and ir.amount_ils=(p_data->>'amount_ils')::numeric and ir.payer=p_data->>'payer' then
    return query select * from public.event_expense_items where id=iid; return;
   end if;
   raise exception 'ההוצאה השתנתה במכשיר אחר. רענן לפני עריכה';
  end if;
  update public.event_expense_items set category=p_data->>'category',description=trim(coalesce(p_data->>'description','')),
   amount_ils=(p_data->>'amount_ils')::numeric,payer=p_data->>'payer',updated_at=clock_timestamp() where id=iid;
 else
  insert into public.event_expense_items(id,event_id,category,description,amount_ils,payer)
   values(iid,er.id,p_data->>'category',trim(coalesce(p_data->>'description','')),(p_data->>'amount_ils')::numeric,p_data->>'payer');
 end if;
 select * into ir from public.event_expense_items where id=iid;
 label:=er.name||' · '||case p_data->>'category' when 'alcohol' then 'אלכוהול' when 'pizza' then 'פיצות' when 'snacks' then 'חטיפים / נשנושים' when 'food' then 'חטיפים / נשנושים' when 'venue' then 'תשלום למקום' else 'אחר' end;
 if length(trim(coalesce(p_data->>'description','')))>0 then label:=label||' · '||trim(p_data->>'description'); end if;
 perform set_config('event_expenses.internal','yes',true);
 insert into public.blue_table_expenses(id,event_item_id,description,amount_ils,category,created_by)
 values(iid,iid,label,ir.amount_ils,'event','אירוע')
 on conflict(event_item_id) where event_item_id is not null do update
 set description=excluded.description,amount_ils=excluded.amount_ils,category='event';
 return query select * from public.event_expense_items where id=iid;
end $$;

create or replace function public.event_expense_delete_item(p_id uuid,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path=public as $$
declare ir public.event_expense_items;
begin
 perform public.event_expense_authorize();
 select * into ir from public.event_expense_items where id=p_id;
 if not found then return; end if;
 if ir.closed_history_id is not null then raise exception 'ההוצאה שייכת לתקופה סגורה ולא ניתנת למחיקה'; end if;
 if ir.updated_at is distinct from p_expected_updated_at then raise exception 'ההוצאה השתנתה. רענן לפני מחיקה'; end if;
 if exists(select 1 from public.event_expense_events where id=ir.event_id and archived) then raise exception 'האירוע בארכיון'; end if;
 perform set_config('event_expenses.internal','yes',true);
 delete from public.blue_table_expenses where event_item_id=p_id;
 delete from public.event_expense_items where id=p_id;
end $$;

create or replace function public.event_expense_save_interest(p_data jsonb)
returns setof public.event_expense_interest language plpgsql security definer set search_path=public as $$
declare rid uuid:=(p_data->>'id')::uuid; ir public.event_expense_interest;
begin
 perform public.event_expense_authorize();
 if not exists(select 1 from public.event_expense_events where id=(p_data->>'event_id')::uuid and not archived) then raise exception 'האירוע אינו פעיל'; end if;
 select * into ir from public.event_expense_interest where id=rid;
 if found and (ir.event_id<>(p_data->>'event_id')::uuid or ir.updated_at is distinct from (p_data->>'expected_updated_at')::timestamptz) then
  if ir.event_id=(p_data->>'event_id')::uuid and ir.player_id=(p_data->>'player_id')::uuid and ir.paid=(p_data->>'paid')::boolean and ir.amount_ils=(p_data->>'amount_ils')::numeric and ir.method is not distinct from nullif(p_data->>'method','') then
   return query select * from public.event_expense_interest where id=rid; return;
  end if;
  raise exception 'הרישום השתנה. רענן לפני עריכה';
 end if;
 insert into public.event_expense_interest(id,event_id,player_id,player_name,paid,amount_ils,method)
 values(rid,(p_data->>'event_id')::uuid,(p_data->>'player_id')::uuid,p_data->>'player_name',(p_data->>'paid')::boolean,(p_data->>'amount_ils')::numeric,nullif(p_data->>'method',''))
 on conflict(id) do update set paid=excluded.paid,amount_ils=excluded.amount_ils,method=excluded.method,updated_at=clock_timestamp();
 return query select * from public.event_expense_interest where id=rid;
end $$;

create or replace function public.event_expense_delete_interest(p_id uuid,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform public.event_expense_authorize();
 if exists(select 1 from public.event_expense_interest i join public.event_expense_events e on e.id=i.event_id where i.id=p_id and (e.archived or i.updated_at is distinct from p_expected_updated_at)) then raise exception 'הרישום השתנה או נמצא בארכיון'; end if;
 delete from public.event_expense_interest where id=p_id;
end $$;

-- Generated records cannot be edited/deleted through the old generic endpoint.
create or replace function public.event_expense_guard_ordinary()
returns trigger language plpgsql set search_path=public as $$
begin
 if (case when TG_OP='INSERT' then new.event_item_id is not null when TG_OP='DELETE' then old.event_item_id is not null else old.event_item_id is not null or new.event_item_id is not null end)
 and coalesce(current_setting('event_expenses.internal',true),'')<>'yes' then
  raise exception 'הוצאה מקושרת לאירוע. יש לערוך אותה בכרטיס האירוע';
 end if;
 if TG_OP='DELETE' then return old; end if; return new;
end $$;
drop trigger if exists event_expense_guard_ordinary on public.blue_table_expenses;
create trigger event_expense_guard_ordinary before insert or update or delete on public.blue_table_expenses for each row execute function public.event_expense_guard_ordinary();

-- An already-open older app must refresh before closing a period containing linked rows.
-- Reject before its history insert/reset, not after any balances have been reset.
create or replace function public.event_expense_guard_legacy_close()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.entry_type='regular' and coalesce(current_setting('event_expenses.internal',true),'')<>'yes'
 and exists(select 1 from public.blue_table_expenses where event_item_id is not null) then
  raise exception 'נוסף מודול אירועים. יש לרענן את האפליקציה לפני סגירת התקופה';
 end if;
 return new;
end $$;
drop trigger if exists event_expense_guard_legacy_close on public.history;
create trigger event_expense_guard_legacy_close before insert on public.history for each row execute function public.event_expense_guard_legacy_close();

-- Atomic history insert + ordinary-expense archive/delete, using the exact client snapshot.
-- All existing history/profit figures are supplied unchanged by the current close code.
-- Other table resets/deletes remain in the existing close flow.
create or replace function public.event_expense_close_snapshot(p_history jsonb,p_expenses jsonb,p_operation_id uuid)
returns setof public.history language plpgsql security definer set search_path=public as $$
declare keys text; current_rows jsonb; result public.history; previous_id text; supplied_count integer; accepted_count integer;
begin
 perform public.event_expense_authorize();
 select history_id into previous_id from public.event_expense_close_runs where id=p_operation_id;
 if found then
  select * into result from public.history where id::text=previous_id;
  if not found then raise exception 'הסגירה כבר נרשמה בעבר. אין לרשום אותה מחדש'; end if;
  if not (to_jsonb(result) @> p_history) then raise exception 'הסגירה הקודמת כבר נשמרה והנתונים השתנו. יש לרענן ולבדוק את ההיסטוריה לפני ניסיון נוסף'; end if;
  return next result; return;
 end if;
 -- Also serialize ordinary manual expenses during the brief compare/archive transaction.
 lock table public.blue_table_expenses in share row exclusive mode;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) into current_rows from public.blue_table_expenses x;
 if current_rows is distinct from (select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]'::jsonb) from jsonb_populate_recordset(null::public.blue_table_expenses,p_expenses) v) then
  raise exception 'רשימת ההוצאות השתנתה בזמן הסגירה. לא נשמרה סגירה. יש לנסות שוב';
 end if;
 if (p_history->'detail_expenses') is distinct from (select coalesce(jsonb_agg(jsonb_build_object('description',v->'description','category',v->'category','other_description',coalesce(v->>'other_description',''),'amount_ils',(v->>'amount_ils')::numeric,'date',to_char((v->>'created_at')::timestamptz at time zone 'Asia/Jerusalem','YYYY-MM-DD')) order by ord),'[]'::jsonb) from jsonb_array_elements(p_expenses) with ordinality as t(v,ord)) then
  raise exception 'פירוט ההוצאות אינו תואם לרשומות הסגירה';
 end if;
 if (p_history->>'total_general_expenses_ils')::numeric is distinct from (select coalesce(sum((v->>'amount_ils')::numeric),0) from jsonb_array_elements(p_expenses) v) then raise exception 'סכום ההוצאות אינו תואם'; end if;
 -- Only existing, explicitly supplied non-generated history columns may be inserted.
 select string_agg(quote_ident(k),',' order by k) into keys from jsonb_object_keys(p_history) k
 join pg_attribute a on a.attrelid='public.history'::regclass and a.attname=k and a.attnum>0 and not a.attisdropped
 where k not in ('id','created_at');
 select count(*) into supplied_count from jsonb_object_keys(p_history);
 select count(*) into accepted_count from jsonb_object_keys(p_history) k join pg_attribute a on a.attrelid='public.history'::regclass and a.attname=k and a.attnum>0 and not a.attisdropped where k not in ('id','created_at');
 if keys is null or supplied_count<>accepted_count then raise exception 'History schema does not match the close payload'; end if;
 perform set_config('event_expenses.internal','yes',true);
 execute format('insert into public.history(%s) select %s from jsonb_populate_record(null::public.history,$1) returning *',keys,keys) into result using p_history;
 update public.event_expense_items set closed_history_id=result.id::text,updated_at=clock_timestamp()
 where id in(select event_item_id from public.blue_table_expenses where event_item_id is not null);
 perform set_config('event_expenses.internal','yes',true);
 delete from public.blue_table_expenses where id in(select (v->>'id')::uuid from jsonb_array_elements(p_expenses) v);
 insert into public.event_expense_close_runs(id,history_id) values(p_operation_id,result.id::text);
 return next result;
end $$;

-- All SECURITY DEFINER entry points explicitly check the existing user allow-list.
revoke all on function public.event_expense_authorize() from public,anon,authenticated;
revoke all on function public.event_expense_save_event(jsonb) from public,anon;
revoke all on function public.event_expense_save_item(jsonb) from public,anon;
revoke all on function public.event_expense_delete_item(uuid,timestamptz) from public,anon;
revoke all on function public.event_expense_save_interest(jsonb) from public,anon;
revoke all on function public.event_expense_delete_interest(uuid,timestamptz) from public,anon;
revoke all on function public.event_expense_close_snapshot(jsonb,jsonb,uuid) from public,anon;
grant execute on function public.event_expense_save_event(jsonb),public.event_expense_save_item(jsonb),public.event_expense_delete_item(uuid,timestamptz),public.event_expense_save_interest(jsonb),public.event_expense_delete_interest(uuid,timestamptz),public.event_expense_close_snapshot(jsonb,jsonb,uuid) to authenticated;
commit;
