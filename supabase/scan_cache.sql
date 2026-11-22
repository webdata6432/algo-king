create table public.fyers_daily_cache (
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  first_day date not null,
  last_day date not null,
  bars jsonb,
  refreshed_at timestamptz not null default now(),
  primary key (user_id,ticker,first_day,last_day)
);
alter table public.fyers_daily_cache enable row level security;
revoke all on public.fyers_daily_cache from public, anon, authenticated;
grant all on public.fyers_daily_cache to service_role;

create function public.read_fyers_scan(p_owner uuid,p_symbols text[],p_from date,p_to date)
returns table(ticker text,bars jsonb)
language sql stable set search_path='' as $$
  select chosen.ticker,case when chosen.bars is null then null else
    coalesce((select jsonb_agg(b.value order by b.ord)
      from jsonb_array_elements(chosen.bars) with ordinality as b(value,ord)
      where (b.value->>0)::bigint >= extract(epoch from (p_from::timestamp at time zone 'Asia/Kolkata'))
        and (b.value->>0)::bigint < extract(epoch from ((p_to+1)::timestamp at time zone 'Asia/Kolkata'))),'[]'::jsonb) end
  from (
    select distinct on (c.ticker) c.ticker,c.bars
    from public.fyers_daily_cache c
    where c.user_id=p_owner and c.ticker=any(p_symbols) and c.first_day<=p_from and c.last_day>=p_to
      and c.refreshed_at>=now()-interval '7 days'
      and (c.last_day < (c.refreshed_at at time zone 'Asia/Kolkata')::date
           or c.refreshed_at >= ((p_to+1)::timestamp at time zone 'Asia/Kolkata')
           or (c.last_day=(c.refreshed_at at time zone 'Asia/Kolkata')::date
               and (c.refreshed_at at time zone 'Asia/Kolkata')::time >= time '18:30')
           or c.refreshed_at>=now()-interval '5 minutes')
    order by c.ticker,c.refreshed_at desc
  ) as chosen;
$$;
revoke all on function public.read_fyers_scan(uuid,text[],date,date) from public,anon,authenticated;
grant execute on function public.read_fyers_scan(uuid,text[],date,date) to service_role;
create index fyers_daily_cache_age on public.fyers_daily_cache(refreshed_at);
create function public.expire_old_fyers_history() returns trigger
language plpgsql set search_path='' as $$
begin
  delete from public.fyers_daily_cache where refreshed_at < now()-interval '7 days';
  return null;
end;
$$;
revoke all on function public.expire_old_fyers_history() from public,anon,authenticated;
create trigger expire_old_fyers_history after insert on public.fyers_daily_cache
for each statement execute function public.expire_old_fyers_history();
