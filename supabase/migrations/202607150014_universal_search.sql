-- Ranked, typo-tolerant discovery across every public marketplace entity.
create extension if not exists pg_trgm with schema extensions;

create index if not exists professional_profiles_search_trgm_idx on public.professional_profiles
  using gin ((coalesce(display_name,'')||' '||business_name||' '||coalesce(bio,'')||' '||coalesce(location,'')||' '||coalesce(business_address,'')) extensions.gin_trgm_ops);
create index if not exists professional_services_search_trgm_idx on public.professional_services
  using gin ((name||' '||description) extensions.gin_trgm_ops) where is_active;
create index if not exists feed_posts_search_trgm_idx on public.feed_posts
  using gin (caption extensions.gin_trgm_ops) where is_published;

create or replace function public.search_marketplace(
  query_text text,
  result_limit integer default 40,
  maximum_price numeric default null,
  minimum_rating numeric default 0
) returns table(
  kind text,id uuid,professional_id uuid,title text,subtitle text,category text,location text,
  image text,price numeric,rating numeric,review_count bigint,verified boolean,available boolean,
  aspect_ratio numeric,created_at timestamptz,rank real
) language sql stable security invoker set search_path='' as $$
with q as (
  select trim(coalesce(query_text,'')) term,
    websearch_to_tsquery('simple',trim(coalesce(query_text,''))) tsq
), pros as (
  select 'professional'::text kind,p.id,p.id professional_id,
    coalesce(p.display_name,p.business_name) title,coalesce(p.bio,'') subtitle,
    coalesce((select i.name from public.professional_services s join public.interests i on i.id=s.interest_id where s.professional_id=p.id and s.is_active order by s.sort_order,s.created_at limit 1),'Professional') category,
    coalesce(p.location,p.business_address,'Accra') location,
    coalesce(p.profile_photo_url,p.cover_image_url,(select fp.image_url from public.feed_posts fp where fp.professional_id=p.id and fp.is_published order by fp.created_at desc limit 1)) image,
    (select min(s.price) from public.professional_services s where s.professional_id=p.id and s.is_active) price,
    coalesce((select avg(r.rating) from public.reviews r where r.professional_id=p.id),0) rating,
    (select count(*) from public.reviews r where r.professional_id=p.id) review_count,p.is_verified verified,
    exists(select 1 from public.professional_working_hours h where h.professional_id=p.id and h.day_of_week=extract(dow from now())::smallint and not h.is_closed) available,
    null::numeric aspect_ratio,p.created_at,
    (1.25*ts_rank_cd(to_tsvector('simple',coalesce(p.display_name,'')||' '||p.business_name||' '||coalesce(p.bio,'')||' '||coalesce(p.location,'')||' '||coalesce(p.business_address,'')),q.tsq)
      + greatest(extensions.word_similarity(q.term,coalesce(p.display_name,p.business_name)),extensions.word_similarity(q.term,p.business_name))
      + case when lower(coalesce(p.display_name,p.business_name))=lower(q.term) then 2 else 0 end)::real rank
  from public.professional_profiles p cross join q where q.term<>''
), services as (
  select 'service'::text,s.id,s.professional_id,s.name,coalesce(p.display_name,p.business_name)||' · '||s.description,
    coalesce(i.name,'Service'),coalesce(p.location,p.business_address,'Accra'),
    coalesce((select sp.storage_path from public.service_photos sp where sp.service_id=s.id order by sp.sort_order,sp.created_at limit 1),p.profile_photo_url,p.cover_image_url),
    s.price,coalesce((select avg(r.rating) from public.reviews r where r.professional_id=p.id),0),
    (select count(*) from public.reviews r where r.professional_id=p.id),p.is_verified,
    exists(select 1 from public.professional_working_hours h where h.professional_id=p.id and h.day_of_week=extract(dow from now())::smallint and not h.is_closed),
    null::numeric,s.created_at,
    (1.5*ts_rank_cd(to_tsvector('simple',s.name||' '||s.description||' '||coalesce(i.name,'')||' '||coalesce(p.display_name,p.business_name)),q.tsq)
      + extensions.word_similarity(q.term,s.name)+case when lower(s.name)=lower(q.term) then 2 else 0 end)::real
  from public.professional_services s join public.professional_profiles p on p.id=s.professional_id
  left join public.interests i on i.id=s.interest_id cross join q where s.is_active and q.term<>''
), posts as (
  select 'post'::text,fp.id,fp.professional_id,fp.caption,coalesce(p.display_name,p.business_name),i.name,
    coalesce(p.location,p.business_address,'Accra'),fp.image_url,fp.price_from,
    coalesce((select avg(r.rating) from public.reviews r where r.professional_id=p.id),fp.rating,0),
    (select count(*) from public.reviews r where r.professional_id=p.id),p.is_verified,false,fp.aspect_ratio,fp.created_at,
    (1.35*ts_rank_cd(to_tsvector('simple',fp.caption||' '||i.name||' '||coalesce(p.display_name,p.business_name)),q.tsq)
      + extensions.word_similarity(q.term,fp.caption))::real
  from public.feed_posts fp join public.professional_profiles p on p.id=fp.professional_id
  join public.interests i on i.id=fp.interest_id cross join q where fp.is_published and q.term<>''
), categories as (
  select 'category'::text,i.id,null::uuid,i.name,'Browse every '||lower(i.name)||' result',i.name,''::text,i.image_url,
    null::numeric,0::numeric,0::bigint,false,false,null::numeric,i.created_at,
    (extensions.word_similarity(q.term,i.name)+case when lower(i.name)=lower(q.term) then 3 else 0 end)::real
  from public.interests i cross join q where i.is_active and q.term<>''
), combined as (select * from pros union all select * from services union all select * from posts union all select * from categories)
select * from combined
where rank>.05 and (maximum_price is null or price is null or price<=maximum_price) and rating>=minimum_rating
order by rank desc,verified desc,rating desc,created_at desc
limit least(greatest(result_limit,1),80);
$$;

grant execute on function public.search_marketplace(text,integer,numeric,numeric) to anon,authenticated;
