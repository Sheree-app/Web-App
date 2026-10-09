-- Switch marketplace search matching from full-text / pg_trgm word matching to
-- case-insensitive substring matching (ILIKE).
--
-- The previous search_marketplace implementation matched candidates with
-- websearch_to_tsquery / to_tsvector full-text search and the pg_trgm
-- word_similarity operator, which only matches whole or prefix words. This
-- replaces that matching with a plain case-insensitive ILIKE '%term%' match so
-- that any substring of the searchable text matches (e.g. "hair" also finds
-- "hairstyling", "lashes" also finds "eyelash").
--
-- The ILIKE predicates target the exact same concatenated expressions the
-- existing pg_trgm GIN indexes were built on (see
-- 202607150014_universal_search.sql), so the indexes remain usable. User input
-- wildcards (% _ \) are escaped so they are matched literally.

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
  where q.term<>'' and (
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
  from service_candidates s join public.professional_profiles p on p.id=s.professional_id left join public.interests i on i.id=s.interest_id cross join q
  union all
  select 'post',fp.id,fp.professional_id,fp.caption,coalesce(p.display_name,p.business_name),i.name,
    coalesce(p.location,p.business_address,'Accra'),fp.image_url,fp.price_from,p.rating_average,p.review_count::bigint,
    p.is_verified,false,fp.aspect_ratio,fp.created_at,
    (case when position(lower(q.term) in lower(fp.caption))>0
          then 1.0/position(lower(q.term) in lower(fp.caption)) else 0 end)::real
  from post_candidates fp join public.professional_profiles p on p.id=fp.professional_id join public.interests i on i.id=fp.interest_id cross join q
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
