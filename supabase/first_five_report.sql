-- Reward 0 is the no-target study. Keep the existing fixed-reward reports.
alter table public.basket_reports drop constraint basket_reports_reward_check,
  add constraint basket_reports_reward_check check
  (reward in (2,3) or (strategy='first-five' and reward=0));
create function public.read_first_five_report() returns jsonb
language sql stable security invoker set search_path='' as $$
 select report from public.basket_reports
 where user_id=(select auth.uid()) and strategy='first-five' and reward=0;
$$;
revoke all on function public.read_first_five_report() from public,anon,authenticated;
grant execute on function public.read_first_five_report() to authenticated;
