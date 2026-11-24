create function public.read_weakness_report() returns jsonb
language sql stable security invoker set search_path='' as $$
 select report from public.basket_reports
 where user_id=(select auth.uid()) and strategy='confirmed-weakness' and reward=2;
$$;
revoke all on function public.read_weakness_report() from public,anon,authenticated;
grant execute on function public.read_weakness_report() to authenticated;
