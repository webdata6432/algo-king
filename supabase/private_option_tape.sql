-- Immutable, content-addressed archives for the owner's private research workspace.
insert into storage.buckets(id,name,public,file_size_limit)
values ('index-history','index-history',false,52428800)
on conflict(id) do nothing;

create function public.can_read_index_history()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users
    where id = (select auth.uid()) and email_confirmed_at is not null
      and lower(email) = 'webdata6432@gmail.com'
  );
$$;
revoke all on function public.can_read_index_history() from public, anon;
grant execute on function public.can_read_index_history() to authenticated;

create policy index_history_owner_read on storage.objects
for select to authenticated using
  (bucket_id = 'index-history' and (select public.can_read_index_history()));
create policy index_history_owner_add on storage.objects
for insert to authenticated with check
  (bucket_id = 'index-history' and (select public.can_read_index_history()));
