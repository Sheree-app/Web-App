create table public.feed_post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  image_url text not null check (image_url ~ '^https?://'),
  aspect_ratio numeric(5,3) not null check (aspect_ratio between .4 and 2),
  sort_order smallint not null check (sort_order between 0 and 7),
  created_at timestamptz not null default now(),
  unique (post_id, sort_order)
);
alter table public.feed_post_images enable row level security;
create policy "published post images are public" on public.feed_post_images for select to anon,authenticated using(exists(select 1 from public.feed_posts where id=post_id and is_published));
create policy "professionals manage own post images" on public.feed_post_images for all to authenticated using(exists(select 1 from public.feed_posts fp join public.professional_profiles p on p.id=fp.professional_id where fp.id=post_id and p.user_id=(select auth.uid()))) with check(exists(select 1 from public.feed_posts fp join public.professional_profiles p on p.id=fp.professional_id where fp.id=post_id and p.user_id=(select auth.uid())));
grant select on public.feed_post_images to anon,authenticated;
grant insert,update,delete on public.feed_post_images to authenticated;
insert into public.feed_post_images(post_id,image_url,aspect_ratio,sort_order) select id,image_url,aspect_ratio,0 from public.feed_posts on conflict(post_id,sort_order) do nothing;
