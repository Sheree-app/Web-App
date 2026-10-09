-- A professional can use customer mode to book services. If they book their
-- own profile, keep the slot occupied but do not present it as client work.
create or replace function public.get_professional_dashboard() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pid uuid; result jsonb;
begin
 select id into pid from public.professional_profiles where user_id=auth.uid();
 if pid is null then raise exception 'Professional profile required'; end if;
 select jsonb_build_object(
  'profile',(select jsonb_build_object('name',coalesce(p.display_name,p.business_name),'business_name',p.business_name,'avatar_url',p.profile_photo_url) from public.professional_profiles p where p.id=pid),
  'today_count',(select count(*) from public.bookings b where b.professional_id=pid and b.customer_id<>auth.uid() and b.starts_at::date=current_date and b.status in('requested','confirmed')),
  'upcoming_count',(select count(*) from public.bookings b where b.professional_id=pid and b.customer_id<>auth.uid() and b.starts_at>=now() and b.status in('requested','confirmed')),
  'pending_count',(select count(*) from public.bookings b where b.professional_id=pid and b.customer_id<>auth.uid() and b.status='requested'),
  'month_revenue',(select coalesce(sum(b.price),0) from public.bookings b where b.professional_id=pid and b.customer_id<>auth.uid() and b.status='completed' and date_trunc('month',b.ends_at)=date_trunc('month',now())),
  'today',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'booking_reference',b.booking_reference,'customer_name',u.full_name,'customer_avatar',u.avatar_url,'service_name',b.service_name,'starts_at',b.starts_at,'ends_at',b.ends_at,'status',b.status,'payment_status',b.payment_status,'price',b.price,'deposit_amount',b.deposit_amount) order by b.starts_at) from public.bookings b join public.users u on u.id=b.customer_id where b.professional_id=pid and b.customer_id<>auth.uid() and b.starts_at::date=current_date and b.status in('requested','confirmed')),'[]'::jsonb),
  'next_booking',(select jsonb_build_object('id',b.id,'booking_reference',b.booking_reference,'customer_name',u.full_name,'customer_avatar',u.avatar_url,'service_name',b.service_name,'starts_at',b.starts_at,'ends_at',b.ends_at,'status',b.status,'payment_status',b.payment_status,'price',b.price,'deposit_amount',b.deposit_amount) from public.bookings b join public.users u on u.id=b.customer_id where b.professional_id=pid and b.customer_id<>auth.uid() and b.starts_at>=now() and b.status in('requested','confirmed') order by b.starts_at limit 1)
 ) into result;
 return result;
end;$$;

revoke all on function public.get_professional_dashboard() from public;
grant execute on function public.get_professional_dashboard() to authenticated;

create or replace function public.get_professional_booking_requests() returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'booking_reference',b.booking_reference,'customer_name',u.full_name,'service_name',b.service_name,'starts_at',b.starts_at,'deposit_amount',b.deposit_amount,'payment_status',b.payment_status) order by b.starts_at),'[]'::jsonb)
from public.bookings b join public.users u on u.id=b.customer_id join public.professional_profiles p on p.id=b.professional_id
where p.user_id=auth.uid() and b.customer_id<>auth.uid() and b.status='requested' and b.starts_at>=now();
$$;

revoke all on function public.get_professional_booking_requests() from public;
grant execute on function public.get_professional_booking_requests() to authenticated;

-- Map view needs every eligible professional with a saved pin. The nearby
-- carousel still passes a 400 metre radius and a small result limit.
create or replace function public.get_nearby_professionals(
  user_latitude double precision,user_longitude double precision,radius_metres integer default 400,result_limit integer default 20
)
returns table(id uuid,name text,category text,location text,rating numeric,reviews integer,price numeric,available boolean,verified boolean,image text,is_new boolean,latitude double precision,longitude double precision,distance_metres integer)
language sql stable security invoker set search_path='' as $$
  select p.id,coalesce(p.display_name,p.business_name),coalesce(x.category,'Beauty'),coalesce(p.location,p.business_address,'Nearby'),
    coalesce(x.rating,0),coalesce(x.reviews,0),x.price,
    exists(select 1 from public.professional_working_hours h where h.professional_id=p.id and h.day_of_week=extract(dow from now())::smallint and not h.is_closed)
      and not exists(select 1 from public.professional_schedule_blocks b where b.professional_id=p.id and now() between b.starts_at and b.ends_at),
    p.is_verified,coalesce(x.image,p.cover_image_url,p.profile_photo_url),(p.created_at>now()-interval '30 days'),p.latitude,p.longitude,
    round(6371000*2*asin(sqrt(power(sin(radians(p.latitude-user_latitude)/2),2)+cos(radians(user_latitude))*cos(radians(p.latitude))*power(sin(radians(p.longitude-user_longitude)/2),2))))::integer
  from public.professional_profiles p
  cross join lateral (
    select min(s.price) price,max(fp.rating) rating,max(fp.rating_count) reviews,
      (array_agg(i.name order by s.sort_order,s.created_at))[1] category,
      (array_agg(fp.image_url order by fp.created_at desc) filter(where fp.image_url is not null))[1] image
    from public.professional_services s left join public.interests i on i.id=s.interest_id
    left join public.feed_posts fp on fp.professional_id=p.id and fp.is_published
    where s.professional_id=p.id and s.is_active
  ) x
  where p.latitude is not null and p.longitude is not null and x.price is not null
    and coalesce(x.image,p.cover_image_url,p.profile_photo_url) is not null
    and 6371000*2*asin(sqrt(power(sin(radians(p.latitude-user_latitude)/2),2)+cos(radians(user_latitude))*cos(radians(p.latitude))*power(sin(radians(p.longitude-user_longitude)/2),2))) <= least(greatest(radius_metres,1),20000000)
  order by 6371000*2*asin(sqrt(power(sin(radians(p.latitude-user_latitude)/2),2)+cos(radians(user_latitude))*cos(radians(p.latitude))*power(sin(radians(p.longitude-user_longitude)/2),2))),coalesce(x.rating,0) desc
  limit least(greatest(result_limit,1),500);
$$;

grant execute on function public.get_nearby_professionals(double precision,double precision,integer,integer) to anon,authenticated;
