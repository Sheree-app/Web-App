-- Public professional cards used by Explore.
create or replace function public.get_explore_professionals(result_limit integer default 20)
returns table(id uuid,name text,category text,location text,rating numeric,reviews integer,price numeric,available boolean,verified boolean,image text,is_new boolean)
language sql stable security invoker set search_path='' as $$
  select p.id,coalesce(p.display_name,p.business_name),coalesce(x.category,'Beauty'),coalesce(p.location,p.business_address,'Accra'),
    coalesce(x.rating,0),coalesce(x.reviews,0),x.price,
    exists(select 1 from public.professional_working_hours h where h.professional_id=p.id and h.day_of_week=extract(dow from now())::smallint and not h.is_closed)
      and not exists(select 1 from public.professional_schedule_blocks b where b.professional_id=p.id and now() between b.starts_at and b.ends_at),
    p.is_verified,coalesce(x.image,p.cover_image_url,p.profile_photo_url),(p.created_at>now()-interval '30 days')
  from public.professional_profiles p
  cross join lateral (
    select min(s.price) price,max(fp.rating) rating,max(fp.rating_count) reviews,
      (array_agg(i.name order by s.sort_order,s.created_at))[1] category,
      (array_agg(fp.image_url order by fp.created_at desc) filter(where fp.image_url is not null))[1] image
    from public.professional_services s left join public.interests i on i.id=s.interest_id
    left join public.feed_posts fp on fp.professional_id=p.id and fp.is_published
    where s.professional_id=p.id and s.is_active
  ) x
  where x.price is not null and coalesce(x.image,p.cover_image_url,p.profile_photo_url) is not null
  order by coalesce(x.rating,0) desc,coalesce(x.reviews,0) desc,p.created_at desc
  limit least(greatest(result_limit,1),50);
$$;
grant execute on function public.get_explore_professionals(integer) to anon,authenticated;
