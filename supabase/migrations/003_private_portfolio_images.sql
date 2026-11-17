begin;

alter table public.portfolio_assets
  add column storage_path text check (
    storage_path is null or
    (split_part(storage_path, '/', 1) = user_id::text and split_part(storage_path, '/', 2) <> '')
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio-images', 'portfolio-images', false, 52428800,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif']);

create policy portfolio_image_read on storage.objects
  for select to authenticated using (
    bucket_id = 'portfolio-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy portfolio_image_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'portfolio-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy portfolio_image_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'portfolio-images' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

commit;
