create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  customer_id uuid not null references public.users(id) on delete cascade,
  professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text not null check (char_length(trim(body)) between 10 and 1000),
  created_at timestamptz not null default now()
);

create index reviews_professional_created_idx on public.reviews(professional_id,created_at desc);
alter table public.reviews enable row level security;
create policy "reviews are publicly readable" on public.reviews for select to anon,authenticated using (true);
create policy "customers review completed bookings" on public.reviews for insert to authenticated with check (
  customer_id=(select auth.uid()) and exists(
    select 1 from public.bookings b where b.id=booking_id and b.customer_id=(select auth.uid())
      and b.professional_id=professional_id and b.status='completed'
  )
);
grant select on public.reviews to anon,authenticated;
grant insert(rating,body,booking_id,customer_id,professional_id) on public.reviews to authenticated;

create or replace function public.get_creator_profile(profile_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('id',p.id,'name',coalesce(p.display_name,p.business_name),'business_name',p.business_name,'bio',coalesce(p.bio,''),'location',coalesce(p.location,p.business_address,'Accra'),'verified',p.is_verified,'avatar',p.profile_photo_url,'cover',coalesce(p.cover_image_url,(select image_url from public.feed_posts where professional_id=p.id and is_published order by created_at desc limit 1)),'years',coalesce(p.years_experience,0),'followers',(select count(*) from public.professional_follows f where f.professional_id=p.id),'following',exists(select 1 from public.professional_follows f where f.professional_id=p.id and f.user_id=(select auth.uid())),'bookings',(select count(*) from public.bookings b where b.professional_id=p.id and b.status='completed'),'rating',coalesce((select avg(r.rating) from public.reviews r where r.professional_id=p.id),0),'review_count',(select count(*) from public.reviews r where r.professional_id=p.id),'category',coalesce((select i.name from public.professional_services s join public.interests i on i.id=s.interest_id where s.professional_id=p.id and s.is_active order by s.sort_order,s.created_at limit 1),'Beauty'),'portfolio',coalesce((select jsonb_agg(jsonb_build_object('id',fp.id,'image',fp.image_url,'caption',fp.caption,'aspect_ratio',fp.aspect_ratio) order by fp.created_at desc) from public.feed_posts fp where fp.professional_id=p.id and fp.is_published),'[]'::jsonb),'reviews',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'author',x.author,'avatar',x.avatar,'rating',x.rating,'body',x.body,'service',x.service,'created_at',x.created_at) order by x.created_at desc) from (select r.id,u.full_name author,u.avatar_url avatar,r.rating,r.body,b.service_name service,r.created_at from public.reviews r join public.users u on u.id=r.customer_id join public.bookings b on b.id=r.booking_id where r.professional_id=p.id order by r.created_at desc limit 3) x),'[]'::jsonb)) from public.professional_profiles p where p.id=profile_id;
$$;

grant execute on function public.get_creator_profile(uuid) to anon,authenticated;
