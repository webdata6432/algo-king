create table public.exchange_reports(day date primary key, status text not null default 'pending', retry_at timestamptz not null default now(), matches int not null default 0);
alter table public.exchange_reports enable row level security;
revoke all on public.exchange_reports from public,anon,authenticated;
grant all on public.exchange_reports to service_role;
insert into public.exchange_reports(day) select d::date from generate_series('2024-07-08'::date,((now() at time zone 'Asia/Kolkata')::date-1)::timestamp,'1 day')d;
create function public.merge_exchange_session(p_day date,p_rows jsonb) returns int language plpgsql set search_path='' as $$
declare rec record; n int:=0;
begin
 for rec in select d.ticker,(e->>1)::int o,(e->>2)::int c from jsonb_array_elements(p_rows)e join public.daily_directory d on d.instrument='NSE_EQ|'||(e->>0) where d.active and d.unverifiable and d.ticker like 'AMFI:%' and (e->>1)::int>0 and (e->>2)::int>0 order by d.ticker for update of d loop
  insert into public.daily_prices as a(ticker,yr,days,opens,closes) values(rec.ticker,extract(year from p_day)::int,array[p_day],array[rec.o],array[rec.c])
  on conflict(ticker,yr) do update set(days,opens,closes)=(select array_agg(d order by d),array_agg(o order by d),array_agg(c order by d) from unnest(a.days||excluded.days,a.opens||excluded.opens,a.closes||excluded.closes) u(d,o,c)) where not p_day=any(a.days);
  n:=n+1;
 end loop;
 update public.exchange_reports set status='done',matches=n where day=p_day;
 return n;
end;$$;
revoke all on function public.merge_exchange_session(date,jsonb) from public,anon,authenticated;
grant execute on function public.merge_exchange_session(date,jsonb) to service_role;
select cron.schedule('ak-exchange-supplement','*/5 * * * *',$job$
 insert into public.exchange_reports(day) select (now() at time zone 'Asia/Kolkata')::date where (now() at time zone 'Asia/Kolkata')::time>='15:31' on conflict do nothing;
 select net.http_post(url:='https://wpqcyyevhxqbhudsxydd.supabase.co/functions/v1/exchange-daily',headers:=jsonb_build_object('Content-Type','application/json','x-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='ak_daily_worker')),body:='{}'::jsonb,timeout_milliseconds:=90000) where exists(select from public.exchange_reports where status='pending' and retry_at<=now());
$job$);
