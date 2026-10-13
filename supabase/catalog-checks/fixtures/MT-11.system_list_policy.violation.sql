-- MT-11.system_list_policy: a policy on a Supabase Storage table, which supautils lets postgres create (E3).
create policy mt_11_storage_select on storage.objects
for select
to authenticated
using (bucket_id = 'mt_11_bucket');
