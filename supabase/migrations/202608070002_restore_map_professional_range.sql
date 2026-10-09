-- Restore country-wide coverage for the Explore map.
--
-- The map view needs every eligible professional with a saved pin (see
-- 202607180001_hide_self_bookings_expand_map.sql), which the client requests by
-- passing a very large radius (up to 20,000 km) and a result limit of 500.
-- 202607280003_scalability_foundation.sql tightened the internal caps to a
-- 50 km radius / 50 results to bound reads, which silently dropped every
-- beautician beyond 50 km (or beyond the 50 closest by distance/rating) from
-- the map — including brand-new profiles that have no reviews yet and therefore
-- sort last.
--
-- This migration redefines the function with the caps restored to the map-wide
-- values while preserving the scalability work (index-friendly bounding box,
-- maintained rating aggregates, bounded CTEs). The nearby carousel still passes
-- a 400 m radius / small limit, which remains well within these caps.

create or replace function public.get_nearby_professionals(
  user_latitude double precision,user_longitude double precision,radius_metres integer default 400,result_limit integer default 20
) returns table(id uuid,name text,category text,location text,rating numeric,reviews integer,price numeric,available boolean,verified boolean,image text,is_new boolean,latitude double precision,longitude double precision,distance_metres integer)
language sql stable security invoker set search_path='' as $$
with service_summary as (
  select distinct on (s.professional_id) s.professional_id,
    min(s.price) over(partition by s.professional_id) price,i.name category
  from public.professional_services s left join public.interests i on i.id=s.interest_id
  where s.is_active order by s.professional_id,s.sort_order,s.created_at
), post_summary as (
  select distinct on (fp.professional_id) fp.professional_id,fp.image_url
  from public.feed_posts fp where fp.is_published
  order by fp.professional_id,fp.created_at desc,fp.id desc
), candidates as (
  select p.*,ss.price,ss.category,ps.image_url,
    6371000*2*asin(sqrt(power(sin(radians(p.latitude-user_latitude)/2),2)+cos(radians(user_latitude))*cos(radians(p.latitude))*power(sin(radians(p.longitude-user_longitude)/2),2))) distance
  from public.professional_profiles p join service_summary ss on ss.professional_id=p.id
  left join post_summary ps on ps.professional_id=p.id
  where p.latitude between user_latitude-(least(greatest(radius_metres,1),20000000)/111320.0)
      and user_latitude+(least(greatest(radius_metres,1),20000000)/111320.0)
    and p.longitude between user_longitude-(least(greatest(radius_metres,1),20000000)/(111320.0*greatest(cos(radians(user_latitude)),0.1)))
      and user_longitude+(least(greatest(radius_metres,1),20000000)/(111320.0*greatest(cos(radians(user_latitude)),0.1)))
)
select p.id,coalesce(p.display_name,p.business_name),coalesce(p.category,'Beauty'),
  coalesce(p.location,p.business_address,'Nearby'),p.rating_average,p.review_count,p.price,
  exists(select 1 from public.professional_working_hours h where h.professional_id=p.id and h.day_of_week=extract(dow from now())::smallint and not h.is_closed)
    and not exists(select 1 from public.professional_schedule_blocks b where b.professional_id=p.id and now() between b.starts_at and b.ends_at),
  p.is_verified,coalesce(p.image_url,p.cover_image_url,p.profile_photo_url),p.created_at>now()-interval '30 days',
  p.latitude,p.longitude,round(p.distance)::integer
from candidates p
where p.distance<=least(greatest(radius_metres,1),20000000)
  and coalesce(p.image_url,p.cover_image_url,p.profile_photo_url) is not null
order by p.distance,p.rating_average desc
limit least(greatest(result_limit,1),500)
$$;
grant execute on function public.get_nearby_professionals(double precision,double precision,integer,integer) to anon,authenticated;
