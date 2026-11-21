create table public.angel_connections (
 user_id uuid primary key references auth.users on delete cascade,
 sealed text not null
);
alter table public.angel_connections enable row level security;
revoke all on public.angel_connections from public, anon, authenticated;
grant select,insert,update,delete on public.angel_connections to service_role;
