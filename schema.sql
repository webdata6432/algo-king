create table if not exists public.market_bars(symbol text not null,session date not null,cap text not null,open numeric not null check(open>0),close numeric not null check(close>0),primary key(symbol,session));
alter table public.market_bars enable row level security;
drop policy if exists market_read on public.market_bars;
create policy market_read on public.market_bars for select using(true);
grant select on public.market_bars to anon;
create or replace view public.market_returns with(security_invoker=true) as
with series as(select *,lag(close) over(partition by symbol order by session) as prev from public.market_bars), moves as(select *,100*(close-open)/open as intraday,100*(close-prev)/prev as actual_return from series)
select *,abs(intraday)>=1 as hit_1,abs(intraday)>=3 as hit_3,abs(intraday)>=5 as hit_5 from moves;
grant select on public.market_returns to anon;
create table if not exists public.strategies(id bigint generated always as identity primary key,config jsonb not null);
create table if not exists public.backtests(id bigint generated always as identity primary key,strategy_id bigint references public.strategies,created_at timestamptz default now(),trades jsonb,summary jsonb);
alter table public.strategies enable row level security;
alter table public.backtests enable row level security;
