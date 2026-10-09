create table if not exists public.professional_studio_photos(
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  image_url text not null,
  aspect_ratio numeric not null default 1 check(aspect_ratio>0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists professional_studio_photos_profile_idx on public.professional_studio_photos(professional_id,sort_order,created_at);
alter table public.professional_studio_photos enable row level security;
create policy "studio photos are public" on public.professional_studio_photos for select using(true);
create policy "professionals add own studio photos" on public.professional_studio_photos for insert to authenticated with check(exists(select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));
create policy "professionals delete own studio photos" on public.professional_studio_photos for delete to authenticated using(exists(select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));

create or replace function public.get_creator_profile(profile_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object(
  'id',p.id,'name',coalesce(p.display_name,p.business_name),'business_name',p.business_name,
  'bio',coalesce(p.bio,''),'location',coalesce(nullif(trim(p.business_address),''),nullif(trim(p.location),''),'Location not provided'),
  'verified',p.is_verified,'avatar',p.profile_photo_url,
  'followers',(select count(*) from public.professional_follows f where f.professional_id=p.id),
  'following',exists(select 1 from public.professional_follows f where f.professional_id=p.id and f.user_id=(select auth.uid())),
  'bookings',(select count(*) from public.bookings b where b.professional_id=p.id and b.status='completed'),
  'rating',coalesce((select avg(r.rating) from public.reviews r where r.professional_id=p.id and r.moderation_status='published'),0),
  'review_count',(select count(*) from public.reviews r where r.professional_id=p.id and r.moderation_status='published'),
  'category',coalesce((select i.name from public.professional_services s join public.interests i on i.id=s.interest_id where s.professional_id=p.id and s.is_active order by s.sort_order,s.created_at limit 1),'Beauty'),
  'socials',jsonb_build_object('instagram',(select sl.url from public.professional_social_links sl where sl.professional_id=p.id and sl.platform='instagram' limit 1),'snapchat',(select sl.url from public.professional_social_links sl where sl.professional_id=p.id and sl.platform='snapchat' limit 1),'whatsapp',(select sl.url from public.professional_social_links sl where sl.professional_id=p.id and sl.platform='whatsapp' limit 1),'telephone',(select u.phone from public.users u where u.id=p.user_id)),
  'portfolio',coalesce((select jsonb_agg(jsonb_build_object('id',fp.id,'image',fp.image_url,'caption',fp.caption,'aspect_ratio',fp.aspect_ratio) order by fp.created_at desc) from public.feed_posts fp where fp.professional_id=p.id and fp.is_published),'[]'::jsonb),
  'studio',coalesce((select jsonb_agg(jsonb_build_object('id',sp.id,'image',sp.image_url,'aspect_ratio',sp.aspect_ratio) order by sp.sort_order,sp.created_at) from public.professional_studio_photos sp where sp.professional_id=p.id),'[]'::jsonb),
  'reviews',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'author',x.author,'avatar',x.avatar,'rating',x.rating,'body',x.body,'service',x.service,'created_at',x.created_at) order by x.created_at desc) from (select r.id,u.full_name author,u.avatar_url avatar,r.rating,r.body,b.service_name service,r.created_at from public.reviews r join public.users u on u.id=r.customer_id join public.bookings b on b.id=r.booking_id where r.professional_id=p.id and r.moderation_status='published' order by r.created_at desc limit 3)x),'[]'::jsonb)
) from public.professional_profiles p where p.id=profile_id;
$$;
revoke all on function public.get_creator_profile(uuid) from public;
grant execute on function public.get_creator_profile(uuid) to anon,authenticated;
