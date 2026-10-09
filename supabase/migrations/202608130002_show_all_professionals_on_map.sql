-- Map pins are profile discovery, not a test of whether a professional has
-- finished configuring services or uploaded media. Return every professional
-- profile with a valid saved coordinate.
create or replace function public.get_map_professionals(
  user_latitude double precision,
  user_longitude double precision,
  result_limit integer default 500
)
returns table(
  id uuid,
  name text,
  category text,
  location text,
  rating numeric,
  reviews integer,
  price numeric,
  available boolean,
  verified boolean,
  image text,
  is_new boolean,
  latitude double precision,
  longitude double precision,
  distance_metres integer
)
language sql stable security invoker set search_path='' as $$
  select
    p.id,
    coalesce(p.display_name,p.business_name),
    coalesce((
      select i.name
      from public.professional_categories pc
      join public.interests i on i.id=pc.interest_id
      where pc.professional_id=p.id
      order by pc.is_primary desc,i.sort_order
      limit 1
    ),'Beauty'),
    coalesce(nullif(trim(p.location),''),nullif(trim(p.business_address),''),'Location selected'),
    p.rating_average,
    p.review_count,
    coalesce((
      select min(s.price)
      from public.professional_services s
      where s.professional_id=p.id and s.is_active
    ),0),
    exists(
      select 1 from public.professional_working_hours h
      where h.professional_id=p.id
        and h.day_of_week=extract(dow from now())::smallint
        and not h.is_closed
    ) and not exists(
      select 1 from public.professional_schedule_blocks b
      where b.professional_id=p.id and now() between b.starts_at and b.ends_at
    ),
    p.is_verified,
    coalesce(p.profile_photo_url,p.cover_image_url),
    p.created_at>now()-interval '30 days',
    p.latitude,
    p.longitude,
    round(6371000*2*asin(sqrt(
      power(sin(radians(p.latitude-user_latitude)/2),2)
      +cos(radians(user_latitude))*cos(radians(p.latitude))
      *power(sin(radians(p.longitude-user_longitude)/2),2)
    )))::integer
  from public.professional_profiles p
  where p.latitude is not null and p.longitude is not null
  order by
    6371000*2*asin(sqrt(
      power(sin(radians(p.latitude-user_latitude)/2),2)
      +cos(radians(user_latitude))*cos(radians(p.latitude))
      *power(sin(radians(p.longitude-user_longitude)/2),2)
    )),
    p.created_at desc
  limit least(greatest(result_limit,1),500);
$$;

revoke all on function public.get_map_professionals(double precision,double precision,integer) from public;
grant execute on function public.get_map_professionals(double precision,double precision,integer) to anon,authenticated;
