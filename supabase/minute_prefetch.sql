-- Retain space in the free bucket for owner-requested symbols and expired contracts.
create table if not exists public.minute_fetch_queue (
 instrument text not null, month text not null, retry_at timestamptz not null,
 primary key(instrument,month)
);
alter table public.minute_fetch_queue enable row level security;
revoke all on public.minute_fetch_queue from public,anon,authenticated;
grant all on public.minute_fetch_queue to service_role;

create or replace function public.dispatch_minute_archive() returns integer
language plpgsql security definer set search_path='' as $$
declare job record; planned integer:=0;
begin
 if not pg_try_advisory_xact_lock(41319003) then return 0; end if;
 if (select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects)>700000000 then return 0; end if;
 for job in
  with universe as materialized (
   select instrument,ticker,cap from public.daily_directory
   where active and (instrument ~ '^NSE_EQ\|[A-Z0-9]{12}$' or cap='Index')
   order by case cap when 'Index' then 0 when 'Large Cap' then 1 when 'Mid Cap' then 2 else 3 end,ticker
  )
  select u.instrument,m.ym
  from universe u cross join lateral (
   select to_char(m,'YYYY-MM') ym from generate_series(
    date '2022-01-01',date_trunc('month',now() at time zone 'Asia/Kolkata'),interval '1 month') m
   where exists(select 1 from public.daily_prices p where p.ticker=u.ticker and p.yr=extract(year from m)
     and p.days[1] < (m+interval '1 month')::date and p.days[cardinality(p.days)] >= m::date)
   and not exists(select 1 from public.minute_fetch_queue q where q.instrument=u.instrument
     and q.month=to_char(m,'YYYY-MM') and q.retry_at>now())
   and not exists(select 1 from storage.objects o where o.bucket_id='minute-archive'
     and o.name='spot/'||regexp_replace(u.instrument,'[^A-Za-z0-9]','_','g')||'/'||to_char(m,'YYYY-MM')||'.gz'
     and o.updated_at >= least(m+interval '1 month',date_trunc('day',(now() at time zone 'Asia/Kolkata') - interval '15 hours 31 minutes') + interval '15 hours 31 minutes') at time zone 'Asia/Kolkata')
   order by m desc limit 4
  ) m limit 4
 loop
  insert into public.minute_fetch_queue values(job.instrument,job.ym,now()+interval '6 hours')
   on conflict(instrument,month) do update set retry_at=excluded.retry_at;
  perform net.http_post(url:='https://wpqcyyevhxqbhudsxydd.supabase.co/functions/v1/fyers-account',
   headers:=jsonb_build_object('Content-Type','application/json','x-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='ak_daily_worker')),
   body:=jsonb_build_object('action','minuteMonth','warm',true,'instrument',job.instrument,'month',job.ym),timeout_milliseconds:=60000);
  planned:=planned+1;
 end loop;
 return planned;
end;$$;
revoke all on function public.dispatch_minute_archive() from public,anon,authenticated;
select cron.schedule('ak-minute-prefetch','*/10 * * * *',$job$select public.dispatch_minute_archive();$job$);
