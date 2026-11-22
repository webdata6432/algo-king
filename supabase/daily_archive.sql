create extension if not exists pg_cron;
create extension if not exists pg_net;
create table public.daily_directory (
  ticker text primary key, symbol text not null, company text not null, cap text not null,
  instrument text not null, active boolean not null default true,
  stage smallint not null default 0, anchor date not null default ((now() at time zone 'Asia/Kolkata')::date),
  checked date, desired date not null default ((now() at time zone 'Asia/Kolkata')::date),
  retry_at timestamptz not null default now(), lease uuid, attempts int not null default 0,
  last_error text
);
create table public.daily_prices (
  ticker text not null references public.daily_directory(ticker), yr int not null,
  days date[] not null, opens integer[] not null, closes integer[] not null,
  primary key(ticker,yr)
);
alter table public.daily_directory enable row level security;
alter table public.daily_prices enable row level security;
revoke all on public.daily_directory,public.daily_prices from public, anon, authenticated;
grant all on public.daily_directory,public.daily_prices to service_role;
create function public.claim_daily_work(n int) returns setof public.daily_directory language sql as $$
 with jobs as (select ticker from public.daily_directory where active and retry_at<=now() and
   (stage<3 or checked is null or checked<desired) order by
   case when stage>0 and checked<desired then 0 else 1 end,stage,
   case cap when 'Index' then 0 when 'Mid Cap' then 1 when 'Large Cap' then 2 else 3 end,ticker
   limit least(32,n) for update skip locked)
 update public.daily_directory d set lease=gen_random_uuid(),retry_at=now()+interval '4 minutes'
 from jobs where d.ticker=jobs.ticker returning d.*;
$$;
create function public.finish_daily_work(t text,token uuid,history boolean,through_day date, observed jsonb)
returns void language plpgsql as $$
declare item public.daily_directory;
begin
 select * into item from public.daily_directory where ticker=t and lease=token for update;
 if not found then return; end if;
 with incoming as (
  select (v->>0)::date d,(v->>1)::integer o,(v->>2)::integer c from jsonb_array_elements(observed) v
 ), combined as (
  select e.d,e.o,e.c,0 priority from public.daily_prices p
  cross join lateral unnest(p.days,p.opens,p.closes) e(d,o,c)
  where p.ticker=t and p.yr in(select distinct extract(year from d)::int from incoming)
  union all select d,o,c,1 from incoming
 ), merged as(select distinct on(d) d,o,c from combined order by d,priority desc)
 insert into public.daily_prices(ticker,yr,days,opens,closes)
 select t,extract(year from d)::int,array_agg(d order by d),array_agg(o order by d),array_agg(c order by d)
 from merged group by extract(year from d)::int on conflict(ticker,yr) do update set
 days=excluded.days,opens=excluded.opens,closes=excluded.closes;
 update public.daily_directory set stage=stage+case when history then 1 else 0 end,
 checked=case when not history or stage=0 then greatest(checked,through_day) else checked end,
 retry_at=now(),lease=null,attempts=0,last_error=null where ticker=t;
end;$$;
create function public.daily_worker_auth(candidate text) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from vault.decrypted_secrets where name='ak_daily_worker' and decrypted_secret=candidate);
$$;
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'ak_daily_worker');
create function public.dispatch_daily_work() returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.daily_directory where active and retry_at<=now() and (stage<3 or checked is null or checked<desired)) then
 perform net.http_post(url:='https://wpqcyyevhxqbhudsxydd.supabase.co/functions/v1/daily-ingest',
  headers:=jsonb_build_object('Content-Type','application/json','x-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='ak_daily_worker')),
  body:='{}'::jsonb,timeout_milliseconds:=100000);
 end if;
end;$$;
revoke all on function public.claim_daily_work(int),public.finish_daily_work(text,uuid,boolean,date,jsonb),public.daily_worker_auth(text),public.dispatch_daily_work() from public,anon,authenticated;
grant execute on function public.claim_daily_work(int),public.finish_daily_work(text,uuid,boolean,date,jsonb),public.daily_worker_auth(text) to service_role;
-- UTC 10:01 = 15:31 India, including any special weekend trading sessions.
select cron.schedule('ak-daily-close','1 10 * * *',$job$
 update public.daily_directory set desired=(now() at time zone 'Asia/Kolkata')::date where active;
 select public.dispatch_daily_work();
$job$);
-- Reconcile a delayed end-of-day publication after market close.
select cron.schedule('ak-daily-reconcile','30 14 * * *',$job$
 update public.daily_directory set checked=least(checked,desired-1) where active and checked>=desired;
 select public.dispatch_daily_work();
$job$);
select cron.schedule('ak-daily-drain','* * * * *',$job$select public.dispatch_daily_work();$job$);
