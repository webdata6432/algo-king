create table public.fyers_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sealed text not null,
  pending_state uuid,
  state_expires timestamptz
);
alter table public.fyers_connections enable row level security;
revoke all on public.fyers_connections from public, anon, authenticated;
grant select, insert, update, delete on public.fyers_connections to service_role;
