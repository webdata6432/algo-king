create function public.owner_momentum_archive(p_from date,p_to date,p_cap text,p_query text,p_cut integer,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null
  and lower(u.email)='webdata6432@gmail.com') then raise insufficient_privilege; end if;
 if p_from is null or p_to is null or p_from>p_to or p_to>(now() at time zone 'Asia/Kolkata')::date
  or p_cut not in(1,2,3,5) or p_limit<1 or p_limit is null or length(p_query)>100
  or p_cap not in ('Large Cap','Small Cap','Mid Cap','Indices','All stocks') then
  raise exception 'Invalid scan filters'; end if;
 return public.momentum_archive(p_from,p_to,p_cap,p_query,p_cut,p_limit);
end;$$;
revoke all on function public.owner_momentum_archive(date,date,text,text,integer,integer) from public,anon;
grant execute on function public.owner_momentum_archive(date,date,text,text,integer,integer) to authenticated;
