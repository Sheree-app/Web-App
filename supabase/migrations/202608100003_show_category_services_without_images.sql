-- Active services should be discoverable even before a professional uploads imagery.
create or replace function public.get_explore_professionals_by_category(category_slug text,result_limit integer default 30)
returns table(id uuid,name text,category text,location text,rating numeric,reviews integer,price numeric,available boolean,verified boolean,image text,is_new boolean)
language sql stable security invoker set search_path='' as $$
  select p.id,coalesce(p.display_name,p.business_name),i.name,coalesce(p.location,p.business_address,'Accra'),
    coalesce(stats.rating,0),coalesce(stats.reviews,0),min(s.price),
    exists(select 1 from public.professional_working_hours h where h.professional_id=p.id and h.day_of_week=extract(dow from now())::smallint and not h.is_closed)
      and not exists(select 1 from public.professional_schedule_blocks b where b.professional_id=p.id and now() between b.starts_at and b.ends_at),
    p.is_verified,coalesce(stats.image,p.cover_image_url,p.profile_photo_url),(p.created_at>now()-interval '30 days')
  from public.professional_profiles p
  join public.professional_services s on s.professional_id=p.id and s.is_active
  join public.interests i on i.id=s.interest_id and i.slug=category_slug and i.is_active
  left join lateral (select max(fp.rating) rating,max(fp.rating_count) reviews,(array_agg(fp.image_url order by fp.created_at desc) filter(where fp.image_url is not null))[1] image from public.feed_posts fp where fp.professional_id=p.id and fp.is_published) stats on true
  group by p.id,i.name,stats.rating,stats.reviews,stats.image
  order by coalesce(stats.rating,0) desc,coalesce(stats.reviews,0) desc,p.created_at desc
  limit least(greatest(result_limit,1),50);
$$;
grant execute on function public.get_explore_professionals_by_category(text,integer) to anon,authenticated;
