-- Bounded reads, maintained summaries, and aggregation-safe discovery.

alter table public.feed_posts
  add column if not exists like_count integer not null default 0,
  add column if not exists comment_count integer not null default 0;

alter table public.professional_profiles
  add column if not exists rating_average numeric(3,2) not null default 0,
  add column if not exists review_count integer not null default 0;

update public.feed_posts fp set
  like_count=(select count(*) from public.feed_post_likes l where l.post_id=fp.id),
  comment_count=(select count(*) from public.feed_post_comments c where c.post_id=fp.id);

update public.professional_profiles p set
  rating_average=coalesce((select avg(r.rating) from public.reviews r where r.professional_id=p.id),0),
  review_count=(select count(*) from public.reviews r where r.professional_id=p.id);

create or replace function public.adjust_feed_reaction_count()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    update public.feed_posts
      set like_count=like_count+case when tg_table_name='feed_post_likes' then 1 else 0 end,
          comment_count=comment_count+case when tg_table_name='feed_post_comments' then 1 else 0 end
      where id=new.post_id;
    return new;
  end if;
  update public.feed_posts
    set like_count=greatest(0,like_count-case when tg_table_name='feed_post_likes' then 1 else 0 end),
        comment_count=greatest(0,comment_count-case when tg_table_name='feed_post_comments' then 1 else 0 end)
    where id=old.post_id;
  return old;
end $$;

drop trigger if exists maintain_feed_like_count on public.feed_post_likes;
create trigger maintain_feed_like_count after insert or delete on public.feed_post_likes
for each row execute function public.adjust_feed_reaction_count();
drop trigger if exists maintain_feed_comment_count on public.feed_post_comments;
create trigger maintain_feed_comment_count after insert or delete on public.feed_post_comments
for each row execute function public.adjust_feed_reaction_count();

create or replace function public.refresh_professional_rating()
returns trigger language plpgsql security definer set search_path='' as $$
declare target_id uuid:=coalesce(new.professional_id,old.professional_id);
begin
  update public.professional_profiles p set
    rating_average=coalesce((select avg(r.rating) from public.reviews r where r.professional_id=target_id),0),
    review_count=(select count(*) from public.reviews r where r.professional_id=target_id)
  where p.id=target_id;
  if tg_op='UPDATE' and old.professional_id is distinct from new.professional_id then
    update public.professional_profiles p set
      rating_average=coalesce((select avg(r.rating) from public.reviews r where r.professional_id=old.professional_id),0),
      review_count=(select count(*) from public.reviews r where r.professional_id=old.professional_id)
    where p.id=old.professional_id;
  end if;
  return coalesce(new,old);
end $$;

drop trigger if exists maintain_professional_rating on public.reviews;
create trigger maintain_professional_rating after insert or update of rating,professional_id or delete on public.reviews
for each row execute function public.refresh_professional_rating();

create index if not exists feed_posts_public_cursor_idx
  on public.feed_posts(created_at desc,id desc) where is_published;
create index if not exists feed_post_saves_user_cursor_idx
  on public.feed_post_saves(user_id,created_at desc,post_id);
create index if not exists notifications_user_cursor_idx
  on public.notifications(user_id,created_at desc,id desc);
create index if not exists bookings_customer_cursor_idx
  on public.bookings(customer_id,starts_at desc,id desc);
create index if not exists saved_collections_user_cursor_idx
  on public.saved_collections(user_id,created_at desc,id desc);
create index if not exists professional_profiles_rating_idx
  on public.professional_profiles(rating_average desc,review_count desc);
create index if not exists professional_profiles_coordinates_idx
  on public.professional_profiles(latitude,longitude)
  where latitude is not null and longitude is not null;

create or replace function public.get_explore_professionals(result_limit integer default 20)
returns table(id uuid,name text,category text,location text,rating numeric,reviews integer,price numeric,available boolean,verified boolean,image text,is_new boolean)
language sql stable security invoker set search_path='' as $$
with service_summary as (
  select distinct on (s.professional_id)
    s.professional_id,
    min(s.price) over(partition by s.professional_id) price,
    i.name category
  from public.professional_services s
  left join public.interests i on i.id=s.interest_id
  where s.is_active
  order by s.professional_id,s.sort_order,s.created_at
), post_summary as (
  select distinct on (fp.professional_id) fp.professional_id,fp.image_url
  from public.feed_posts fp where fp.is_published
  order by fp.professional_id,fp.created_at desc,fp.id desc
)
select p.id,coalesce(p.display_name,p.business_name),coalesce(ss.category,'Beauty'),
  coalesce(p.location,p.business_address,'Accra'),p.rating_average,p.review_count,ss.price,
  exists(select 1 from public.professional_working_hours h where h.professional_id=p.id and h.day_of_week=extract(dow from now())::smallint and not h.is_closed)
    and not exists(select 1 from public.professional_schedule_blocks b where b.professional_id=p.id and now() between b.starts_at and b.ends_at),
  p.is_verified,coalesce(ps.image_url,p.cover_image_url,p.profile_photo_url),p.created_at>now()-interval '30 days'
from public.professional_profiles p
join service_summary ss on ss.professional_id=p.id
left join post_summary ps on ps.professional_id=p.id
where coalesce(ps.image_url,p.cover_image_url,p.profile_photo_url) is not null
order by p.rating_average desc,p.review_count desc,p.created_at desc
limit least(greatest(result_limit,1),50)
$$;

create or replace function public.get_feed_page(
  cursor_created_at timestamptz default null,cursor_id uuid default null,page_size integer default 10
) returns table(id uuid,professional_id uuid,professional_name text,avatar_url text,image_url text,caption text,category text,location text,price_from numeric,rating numeric,rating_count integer,is_verified boolean,like_count bigint,comment_count bigint,is_liked boolean,is_saved boolean,aspect_ratio numeric,created_at timestamptz)
language sql stable security invoker set search_path='' as $$
select fp.id,p.id,coalesce(p.display_name,p.business_name),p.profile_photo_url,fp.image_url,fp.caption,i.name,
  coalesce(p.location,p.business_address),fp.price_from,p.rating_average,p.review_count,p.is_verified,
  fp.like_count::bigint,fp.comment_count::bigint,
  exists(select 1 from public.feed_post_likes l where l.post_id=fp.id and l.user_id=(select auth.uid())),
  exists(select 1 from public.feed_post_saves s where s.post_id=fp.id and s.user_id=(select auth.uid())),
  fp.aspect_ratio,fp.created_at
from public.feed_posts fp
join public.professional_profiles p on p.id=fp.professional_id
join public.interests i on i.id=fp.interest_id
where fp.is_published and (
  cursor_created_at is null or (fp.created_at,fp.id)<(cursor_created_at,cursor_id)
)
order by fp.created_at desc,fp.id desc
limit least(greatest(page_size,1),30)
$$;
grant execute on function public.get_feed_page(timestamptz,uuid,integer) to anon,authenticated;

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
  where p.latitude between user_latitude-(least(greatest(radius_metres,1),50000)/111320.0)
      and user_latitude+(least(greatest(radius_metres,1),50000)/111320.0)
    and p.longitude between user_longitude-(least(greatest(radius_metres,1),50000)/(111320.0*greatest(cos(radians(user_latitude)),0.1)))
      and user_longitude+(least(greatest(radius_metres,1),50000)/(111320.0*greatest(cos(radians(user_latitude)),0.1)))
)
select p.id,coalesce(p.display_name,p.business_name),coalesce(p.category,'Beauty'),
  coalesce(p.location,p.business_address,'Nearby'),p.rating_average,p.review_count,p.price,
  exists(select 1 from public.professional_working_hours h where h.professional_id=p.id and h.day_of_week=extract(dow from now())::smallint and not h.is_closed)
    and not exists(select 1 from public.professional_schedule_blocks b where b.professional_id=p.id and now() between b.starts_at and b.ends_at),
  p.is_verified,coalesce(p.image_url,p.cover_image_url,p.profile_photo_url),p.created_at>now()-interval '30 days',
  p.latitude,p.longitude,round(p.distance)::integer
from candidates p
where p.distance<=least(greatest(radius_metres,1),50000)
  and coalesce(p.image_url,p.cover_image_url,p.profile_photo_url) is not null
order by p.distance,p.rating_average desc
limit least(greatest(result_limit,1),50)
$$;
grant execute on function public.get_nearby_professionals(double precision,double precision,integer,integer) to anon,authenticated;

create or replace function public.get_saved_feed_page(
  cursor_created_at timestamptz default null,cursor_post_id uuid default null,page_size integer default 20
) returns table(id uuid,professional_id uuid,professional_name text,avatar_url text,image_url text,caption text,category text,location text,price_from numeric,rating numeric,rating_count integer,is_verified boolean,like_count bigint,comment_count bigint,is_liked boolean,is_saved boolean,aspect_ratio numeric,created_at timestamptz,saved_at timestamptz)
language sql stable security invoker set search_path='' as $$
select fp.id,p.id,coalesce(p.display_name,p.business_name),p.profile_photo_url,fp.image_url,fp.caption,i.name,
  coalesce(p.location,p.business_address),fp.price_from,p.rating_average,p.review_count,p.is_verified,
  fp.like_count::bigint,fp.comment_count::bigint,
  exists(select 1 from public.feed_post_likes l where l.post_id=fp.id and l.user_id=(select auth.uid())),
  true,fp.aspect_ratio,fp.created_at,saved.created_at
from public.feed_post_saves saved
join public.feed_posts fp on fp.id=saved.post_id
join public.professional_profiles p on p.id=fp.professional_id
join public.interests i on i.id=fp.interest_id
where saved.user_id=(select auth.uid()) and fp.is_published and (
  cursor_created_at is null or (saved.created_at,saved.post_id)<(cursor_created_at,cursor_post_id)
)
order by saved.created_at desc,saved.post_id desc
limit least(greatest(page_size,1),50)
$$;
revoke all on function public.get_saved_feed_page(timestamptz,uuid,integer) from public;
grant execute on function public.get_saved_feed_page(timestamptz,uuid,integer) to authenticated;

create or replace function public.get_post_comments_page(
  post_id_value uuid,cursor_created_at timestamptz default null,cursor_id uuid default null,page_size integer default 30
) returns table(id uuid,post_id uuid,user_id uuid,body text,created_at timestamptz,author_name text,avatar_url text)
language sql stable security definer set search_path='' as $$
select c.id,c.post_id,c.user_id,c.body,c.created_at,coalesce(nullif(u.full_name,''),'Sheree member'),u.avatar_url
from public.feed_post_comments c join public.users u on u.id=c.user_id
where c.post_id=post_id_value and (
  cursor_created_at is null or (c.created_at,c.id)<(cursor_created_at,cursor_id)
)
order by c.created_at desc,c.id desc
limit least(greatest(page_size,1),50)
$$;
revoke all on function public.get_post_comments_page(uuid,timestamptz,uuid,integer) from public;
grant execute on function public.get_post_comments_page(uuid,timestamptz,uuid,integer) to anon,authenticated;

-- Search only scores a bounded indexed candidate set; expensive joins happen afterwards.
drop function if exists public.search_marketplace(text,integer,numeric,numeric,numeric,text,boolean);
create function public.search_marketplace(
  query_text text,result_limit integer default 80,minimum_price numeric default null,
  maximum_price numeric default null,minimum_rating numeric default 0,
  price_sort text default 'relevance',include_unpriced boolean default true
) returns table(kind text,id uuid,professional_id uuid,title text,subtitle text,category text,location text,image text,price numeric,rating numeric,review_count bigint,verified boolean,available boolean,aspect_ratio numeric,created_at timestamptz,rank real)
language sql stable security invoker set search_path='' as $$
with q as (
  select trim(coalesce(query_text,'')) term,websearch_to_tsquery('simple',trim(coalesce(query_text,''))) tsq
), pro_candidates as materialized (
  select p.* from public.professional_profiles p,q
  where q.term<>'' and (
    (coalesce(p.display_name,'')||' '||p.business_name||' '||coalesce(p.bio,'')||' '||coalesce(p.location,'')||' '||coalesce(p.business_address,'')) OPERATOR(extensions.%) q.term
    or to_tsvector('simple',coalesce(p.display_name,'')||' '||p.business_name||' '||coalesce(p.bio,'')||' '||coalesce(p.location,'')) @@ q.tsq
  ) limit 200
), service_candidates as materialized (
  select s.* from public.professional_services s,q where s.is_active and q.term<>'' and (
    (s.name||' '||s.description) OPERATOR(extensions.%) q.term or to_tsvector('simple',s.name||' '||s.description) @@ q.tsq
  ) limit 300
), post_candidates as materialized (
  select fp.* from public.feed_posts fp,q where fp.is_published and q.term<>'' and (
    fp.caption OPERATOR(extensions.%) q.term or to_tsvector('simple',fp.caption) @@ q.tsq
  ) limit 300
), combined as (
  select 'professional'::text,p.id,p.id professional_id,coalesce(p.display_name,p.business_name) title,
    coalesce(p.bio,'') subtitle,'Professional'::text category,coalesce(p.location,p.business_address,'Accra') location,
    coalesce(p.profile_photo_url,p.cover_image_url) image,
    (select min(s.price) from public.professional_services s where s.professional_id=p.id and s.is_active) price,
    p.rating_average rating,p.review_count::bigint review_count,p.is_verified verified,
    exists(select 1 from public.professional_working_hours h where h.professional_id=p.id and h.day_of_week=extract(dow from now())::smallint and not h.is_closed) available,
    null::numeric aspect_ratio,p.created_at,
    (extensions.word_similarity(q.term,coalesce(p.display_name,p.business_name))+case when lower(coalesce(p.display_name,p.business_name))=lower(q.term) then 2 else 0 end)::real rank
  from pro_candidates p cross join q
  union all
  select 'service',s.id,s.professional_id,s.name,coalesce(p.display_name,p.business_name)||' · '||s.description,
    coalesce(i.name,'Service'),coalesce(p.location,p.business_address,'Accra'),
    coalesce((select sp.storage_path from public.service_photos sp where sp.service_id=s.id order by sp.sort_order,sp.created_at limit 1),p.profile_photo_url,p.cover_image_url),
    s.price,p.rating_average,p.review_count::bigint,p.is_verified,
    exists(select 1 from public.professional_working_hours h where h.professional_id=p.id and h.day_of_week=extract(dow from now())::smallint and not h.is_closed),
    null::numeric,s.created_at,(extensions.word_similarity(q.term,s.name)+case when lower(s.name)=lower(q.term) then 2 else 0 end)::real
  from service_candidates s join public.professional_profiles p on p.id=s.professional_id left join public.interests i on i.id=s.interest_id cross join q
  union all
  select 'post',fp.id,fp.professional_id,fp.caption,coalesce(p.display_name,p.business_name),i.name,
    coalesce(p.location,p.business_address,'Accra'),fp.image_url,fp.price_from,p.rating_average,p.review_count::bigint,
    p.is_verified,false,fp.aspect_ratio,fp.created_at,extensions.word_similarity(q.term,fp.caption)::real
  from post_candidates fp join public.professional_profiles p on p.id=fp.professional_id join public.interests i on i.id=fp.interest_id cross join q
  union all
  select 'category',i.id,null::uuid,i.name,'Browse every '||lower(i.name)||' result',i.name,''::text,i.image_url,
    null::numeric,0::numeric,0::bigint,false,false,null::numeric,i.created_at,
    (extensions.word_similarity(q.term,i.name)+case when lower(i.name)=lower(q.term) then 3 else 0 end)::real
  from public.interests i cross join q where i.is_active and i.name OPERATOR(extensions.%) q.term
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
