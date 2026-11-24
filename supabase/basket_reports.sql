create table public.basket_reports (
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy text not null,
  reward smallint not null check (reward in (2,3)),
  report jsonb not null,
  primary key (user_id, strategy, reward)
);
alter table public.basket_reports enable row level security;
revoke all on public.basket_reports from public, anon, authenticated;
grant select on public.basket_reports to authenticated;
create policy read_own_basket_reports on public.basket_reports for select to authenticated
  using (user_id = (select auth.uid()));
create function public.read_sector_report(p_reward integer)
returns jsonb language sql stable security invoker set search_path='' as $$
  select report from public.basket_reports
  where user_id=(select auth.uid()) and strategy='sector-momentum' and reward=p_reward;
$$;
revoke all on function public.read_sector_report(integer) from public, anon, authenticated;
grant execute on function public.read_sector_report(integer) to authenticated;
