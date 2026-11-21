create table public.site_unlock_secret(id integer primary key check(id=1),pem text not null);
alter table public.site_unlock_secret enable row level security;
revoke all on public.site_unlock_secret from public,anon,authenticated;
grant select on public.site_unlock_secret to service_role;
