alter table public.professional_profiles
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table public.professional_profiles
  drop constraint if exists professional_profiles_valid_coordinates;
alter table public.professional_profiles
  add constraint professional_profiles_valid_coordinates check (
    (latitude is null and longitude is null) or
    (latitude between -90 and 90 and longitude between -180 and 180)
  );

create or replace function public.set_my_professional_location(latitude_value double precision, longitude_value double precision)
returns void language plpgsql security definer set search_path='' as $$
begin
  if latitude_value not between -90 and 90 or longitude_value not between -180 and 180 then
    raise exception 'Invalid coordinates';
  end if;
  update public.professional_profiles
  set latitude=latitude_value,longitude=longitude_value,updated_at=now()
  where user_id=(select auth.uid());
  if not found then raise exception 'Professional profile required'; end if;
end $$;

revoke all on function public.set_my_professional_location(double precision,double precision) from public;
grant execute on function public.set_my_professional_location(double precision,double precision) to authenticated;

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
    and 6371000*2*asin(sqrt(power(sin(radians(p.latitude-user_latitude)/2),2)+cos(radians(user_latitude))*cos(radians(p.latitude))*power(sin(radians(p.longitude-user_longitude)/2),2))) <= least(greatest(radius_metres,1),50000)
  order by 6371000*2*asin(sqrt(power(sin(radians(p.latitude-user_latitude)/2),2)+cos(radians(user_latitude))*cos(radians(p.latitude))*power(sin(radians(p.longitude-user_longitude)/2),2))),coalesce(x.rating,0) desc
  limit least(greatest(result_limit,1),50);
$$;
grant execute on function public.get_nearby_professionals(double precision,double precision,integer,integer) to anon,authenticated;
