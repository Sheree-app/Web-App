-- Deleted accounts were still discoverable on the customer map.
--
-- account-delete calls admin.auth.admin.deleteUser(id, true), which only
-- soft-deletes the auth user, so the public.users and professional_profiles rows
-- survive (the on delete cascade never fires). The function then anonymises the
-- profile — business_name/display_name become 'Former professional', bio,
-- location, address and photos are cleared — but it left latitude, longitude and
-- show_on_map untouched.
--
-- get_map_professionals() intentionally returns *every* profile with a saved pin
-- (see 202608130002_show_all_professionals_on_map.sql) and only filters on
-- show_on_map + coordinates, so the anonymised row kept rendering as a pin
-- labelled "Former professional". Nearby carousel and marketplace search could
-- leak the same row.
--
-- Add an explicit tombstone the edge function can set, and make every discovery
-- surface ignore tombstoned profiles. Row deletion is not an option: bookings,
-- payouts and disputes reference professional_profiles with on delete restrict,
-- which is exactly why the account is anonymised instead of removed.

alter table public.professional_profiles
  add column if not exists deleted_at timestamptz;

comment on column public.professional_profiles.deleted_at is
  'Set when the owner deletes their account. Non-null rows must never surface in customer discovery, even if coordinates remain.';

-- Backfill rows the previous account-delete implementation already anonymised,
-- and drop the leftover pin so existing ghosts disappear immediately.
update public.professional_profiles
set deleted_at = coalesce(updated_at, now()),
    show_on_map = false,
    latitude = null,
    longitude = null
where deleted_at is null
  and business_name = 'Former professional'
  and display_name = 'Former professional';

-- Customer map pins.
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
  where p.deleted_at is null
    and p.show_on_map
    and p.latitude is not null and p.longitude is not null
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

-- Nearby carousel (same map screen data source).
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
    and p.deleted_at is null
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

-- Marketplace search: 'Former professional' is still a searchable business_name,
-- so keep tombstoned profiles out of the professional results.
drop function if exists public.search_marketplace(text,integer,numeric,numeric,numeric,text,boolean);

create function public.search_marketplace(
  query_text text,result_limit integer default 80,minimum_price numeric default null,
  maximum_price numeric default null,minimum_rating numeric default 0,
  price_sort text default 'relevance',include_unpriced boolean default true
) returns table(kind text,id uuid,professional_id uuid,title text,subtitle text,category text,location text,image text,price numeric,rating numeric,review_count bigint,verified boolean,available boolean,aspect_ratio numeric,created_at timestamptz,rank real)
language sql stable security invoker set search_path='' as $$
with q as (
  select trim(coalesce(query_text,'')) term,
    replace(replace(replace(trim(coalesce(query_text,'')),'\','\\'),'%','\%'),'_','\_') pattern
), pro_candidates as materialized (
  select p.* from public.professional_profiles p,q
  where q.term<>'' and p.deleted_at is null and (
    (coalesce(p.display_name,'')||' '||p.business_name||' '||coalesce(p.bio,'')||' '||coalesce(p.location,'')||' '||coalesce(p.business_address,'')) ilike '%'||q.pattern||'%'
  ) limit 200
), service_candidates as materialized (
  select s.* from public.professional_services s,q where s.is_active and q.term<>'' and (
    (s.name||' '||s.description) ilike '%'||q.pattern||'%'
  ) limit 300
), post_candidates as materialized (
  select fp.* from public.feed_posts fp,q where fp.is_published and q.term<>'' and (
    fp.caption ilike '%'||q.pattern||'%'
  ) limit 300
), combined as (
  select 'professional'::text,p.id,p.id professional_id,coalesce(p.display_name,p.business_name) title,
    coalesce(p.bio,'') subtitle,'Professional'::text category,coalesce(p.location,p.business_address,'Accra') location,
    coalesce(p.profile_photo_url,p.cover_image_url) image,
    (select min(s.price) from public.professional_services s where s.professional_id=p.id and s.is_active) price,
    p.rating_average rating,p.review_count::bigint review_count,p.is_verified verified,
    exists(select 1 from public.professional_working_hours h where h.professional_id=p.id and h.day_of_week=extract(dow from now())::smallint and not h.is_closed) available,
    null::numeric aspect_ratio,p.created_at,
    (case when lower(coalesce(p.display_name,p.business_name))=lower(q.term) then 3 else 0 end
      + case when lower(coalesce(p.display_name,p.business_name)) like lower(q.term)||'%' then 1 else 0 end
      + case when position(lower(q.term) in lower(coalesce(p.display_name,p.business_name)))>0
             then 1.0/position(lower(q.term) in lower(coalesce(p.display_name,p.business_name))) else 0 end)::real rank
  from pro_candidates p cross join q
  union all
  select 'service',s.id,s.professional_id,s.name,coalesce(p.display_name,p.business_name)||' · '||s.description,
    coalesce(i.name,'Service'),coalesce(p.location,p.business_address,'Accra'),
    coalesce((select sp.storage_path from public.service_photos sp where sp.service_id=s.id order by sp.sort_order,sp.created_at limit 1),p.profile_photo_url,p.cover_image_url),
    s.price,p.rating_average,p.review_count::bigint,p.is_verified,
    exists(select 1 from public.professional_working_hours h where h.professional_id=p.id and h.day_of_week=extract(dow from now())::smallint and not h.is_closed),
    null::numeric,s.created_at,
    (case when lower(s.name)=lower(q.term) then 3 else 0 end
      + case when lower(s.name) like lower(q.term)||'%' then 1 else 0 end
      + case when position(lower(q.term) in lower(s.name))>0
             then 1.0/position(lower(q.term) in lower(s.name)) else 0 end)::real
  from service_candidates s join public.professional_profiles p on p.id=s.professional_id and p.deleted_at is null left join public.interests i on i.id=s.interest_id cross join q
  union all
  select 'post',fp.id,fp.professional_id,fp.caption,coalesce(p.display_name,p.business_name),i.name,
    coalesce(p.location,p.business_address,'Accra'),fp.image_url,fp.price_from,p.rating_average,p.review_count::bigint,
    p.is_verified,false,fp.aspect_ratio,fp.created_at,
    (case when position(lower(q.term) in lower(fp.caption))>0
          then 1.0/position(lower(q.term) in lower(fp.caption)) else 0 end)::real
  from post_candidates fp join public.professional_profiles p on p.id=fp.professional_id and p.deleted_at is null join public.interests i on i.id=fp.interest_id cross join q
  union all
  select 'category',i.id,null::uuid,i.name,'Browse every '||lower(i.name)||' result',i.name,''::text,i.image_url,
    null::numeric,0::numeric,0::bigint,false,false,null::numeric,i.created_at,
    (case when lower(i.name)=lower(q.term) then 3 else 0 end
      + case when lower(i.name) like lower(q.term)||'%' then 1 else 0 end
      + case when position(lower(q.term) in lower(i.name))>0
             then 1.0/position(lower(q.term) in lower(i.name)) else 0 end)::real
  from public.interests i cross join q where i.is_active and i.name ilike '%'||q.pattern||'%'
)
select * from combined
where rating>=minimum_rating and (
  price is null and include_unpriced or
  price is not null and (minimum_price is null or price>=minimum_price) and (maximum_price is null or price<=maximum_price)
)
order by case when price_sort='low_to_high' then price end asc nulls last,
  case when price_sort='high_to_low' then price end desc nulls last,
  rank desc,verified desc,rating desc,created_at desc
limit least(greatest(result_limit,1),100)
$$;
grant execute on function public.search_marketplace(text,integer,numeric,numeric,numeric,text,boolean) to anon,authenticated;
