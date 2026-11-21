create table public.member_profiles (
 user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
 mobile text check (mobile is null or mobile ~ '^\+[1-9][0-9]{7,14}$'),
 photo text check(photo is null or (length(photo)<160000 and photo like 'data:image/jpeg;base64,%'))
);
alter table public.member_profiles enable row level security;
revoke all on public.member_profiles from public,anon,authenticated;
grant select,insert,update on public.member_profiles to authenticated;
create policy own_profile on public.member_profiles for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
