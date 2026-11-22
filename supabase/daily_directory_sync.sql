alter table public.daily_directory add column unverifiable boolean not null default false;
create function public.sync_archive_directory(catalog jsonb) returns void language plpgsql as $$
begin
 if jsonb_typeof(catalog)<>'array' or jsonb_array_length(catalog)<1000 then raise exception 'Incomplete directory'; end if;
 insert into public.daily_directory(ticker,symbol,company,cap,instrument)
 select coalesce(e->>3,'AMFI:'||(e->>4)), e->>0,e->>1,e->>2,e->>5 from jsonb_array_elements(catalog)e
 on conflict(ticker) do update set active=true,symbol=excluded.symbol,company=excluded.company,cap=excluded.cap,
   stage=case when daily_directory.instrument=excluded.instrument then daily_directory.stage else 0 end,
   instrument=excluded.instrument;
 update public.daily_directory set active=false where cap<>'Index' and active and ticker not in
  (select coalesce(e->>3,'AMFI:'||(e->>4)) from jsonb_array_elements(catalog)e);
end;$$;
revoke all on function public.sync_archive_directory(jsonb) from public,anon,authenticated;
grant execute on function public.sync_archive_directory(jsonb) to service_role;
select cron.schedule('ak-daily-directory','50 9 * * *',$job$
 select net.http_post(url:='https://wpqcyyevhxqbhudsxydd.supabase.co/functions/v1/daily-ingest',
 headers:=jsonb_build_object('Content-Type','application/json','x-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='ak_daily_worker')),
 body:='{"directory":true}'::jsonb,timeout_milliseconds:=90000);
$job$);
select cron.schedule('ak-daily-drain','* * * * *',$job$select public.dispatch_daily_work();select public.dispatch_daily_work();$job$);
