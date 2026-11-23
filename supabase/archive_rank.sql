create or replace function public.momentum_archive(p_from date,p_to date,p_cap text,p_query text,p_cut integer,p_limit integer)
returns jsonb language sql stable set search_path='' as $$
 with universe as materialized (
   select d.*, (unverifiable or (stage>0 and (stage=3 or p_from>=anchor-stage*3650+1)
     and checked>=least(p_to,desired))) as ready
   from public.daily_directory d where active and
   case when p_query<>'' then strpos(upper(symbol||' '||company),upper(p_query))>0
        when p_cap='All stocks' then cap<>'Index' when p_cap='Indices' then cap='Index' else cap=p_cap end
 ), daily as materialized (
   select p.ticker,v.day,v.o,v.c from universe u join public.daily_prices p using(ticker)
   cross join lateral unnest(p.days,p.opens,p.closes) as v(day,o,c)
   where u.ready and p.yr between extract(year from p_from) and extract(year from p_to)
     and v.day between p_from and p_to
 ), scores as (
   select ticker,count(*) filter(where abs(c-o)::bigint*100>=o::bigint*p_cut) hits,
     count(*) filter(where abs(c-o)::bigint*100>=o::bigint*5) h5,
     count(*) filter(where abs(c-o)::bigint*100>=o::bigint*3) h3,
     count(*) filter(where abs(c-o)::bigint*100>=o::bigint*2) h2
   from daily group by ticker
 ), matches as materialized (
   select s.*,u.symbol,u.cap from scores s join universe u using(ticker)
   where hits>0 or p_query<>'' or p_cap='Indices'
 ), top_stocks as materialized (
   select *,row_number() over(order by hits desc,h5 desc,h3 desc,h2 desc,symbol,ticker) pos from matches
   order by pos limit p_limit
 ), detail as (
   select t.ticker,t.symbol,t.cap,t.pos,
    (select cl.price from public.daily_prices pr cross join lateral unnest(pr.days,pr.closes) cl(day,price)
     where pr.ticker=t.ticker and pr.yr between extract(year from p_from)-1 and extract(year from p_from)
       and cl.day<p_from order by cl.day desc limit 1) prev,
    jsonb_agg(jsonb_build_array(d.day,d.o,d.c) order by d.day) bars
   from top_stocks t join daily d using(ticker) group by t.ticker,t.symbol,t.cap,t.pos
 )
 select jsonb_build_object('total',(select count(*) from universe),
 'pending',(select count(*) from universe where not coalesce(ready,false)),
 'unavailable',(select count(*) from universe u where unverifiable and not exists(select 1 from scores s where s.ticker=u.ticker)),'withData',(select count(*) from scores),'matched',(select count(*) from matches),
 'stocks',coalesce((select jsonb_agg(to_jsonb(detail) order by pos) from detail),'[]'::jsonb));
$$;
revoke all on function public.momentum_archive(date,date,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.momentum_archive(date,date,text,text,integer,integer) to service_role;
