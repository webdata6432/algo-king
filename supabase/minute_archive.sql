insert into storage.buckets(id,name,public) values ('minute-archive','minute-archive',false)
on conflict(id) do nothing;
