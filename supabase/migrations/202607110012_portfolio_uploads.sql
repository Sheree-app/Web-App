-- Worker portfolio uploads. Files are public because feed images are public.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('portfolio','portfolio',true,10485760,array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "portfolio images are public" on storage.objects for select to public using(bucket_id='portfolio');
create policy "professionals upload portfolio images" on storage.objects for insert to authenticated
with check(bucket_id='portfolio' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.professional_profiles where user_id=(select auth.uid())));
create policy "professionals delete own portfolio images" on storage.objects for delete to authenticated
using(bucket_id='portfolio' and (storage.foldername(name))[1]=(select auth.uid())::text);
