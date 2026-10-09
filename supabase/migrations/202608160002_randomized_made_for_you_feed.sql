-- Randomize the "Made for you" feed so different people don't see the same
-- work in the same order at the same time.
--
-- The app passes a stable per-user `feed_seed` (persisted on-device). Posts
-- are ranked by md5(feed_seed || post_id), a deterministic pseudo-random key
-- that differs per seed, and paginated keyset-style on (rank, post_id). Only
-- the last 90 days of published posts are ranked so the sort stays bounded
-- and "fresh work" stays fresh.
--
-- If a client omits the seed we fall back to auth.uid() so authenticated
-- users still get a per-person ordering without extra work on their side.

create or replace function public.get_made_for_you_feed(
  cursor_id uuid default null,page_size integer default 10,feed_seed text default null
) returns table(id uuid,professional_id uuid,professional_name text,avatar_url text,image_url text,caption text,category text,location text,price_from numeric,rating numeric,rating_count integer,is_verified boolean,like_count bigint,comment_count bigint,is_liked boolean,is_saved boolean,aspect_ratio numeric,created_at timestamptz)
language sql stable security invoker set search_path='' as $$
with params as (
  select coalesce(nullif(feed_seed,''),(select auth.uid())::text,'anon') as seed
)
select fp.id,p.id,coalesce(p.display_name,p.business_name),p.profile_photo_url,fp.image_url,fp.caption,i.name,
  coalesce(p.location,p.business_address),fp.price_from,p.rating_average,p.review_count,p.is_verified,
  fp.like_count::bigint,fp.comment_count::bigint,
  exists(select 1 from public.feed_post_likes l where l.post_id=fp.id and l.user_id=(select auth.uid())),
  exists(select 1 from public.feed_post_saves s where s.post_id=fp.id and s.user_id=(select auth.uid())),
  fp.aspect_ratio,fp.created_at
from public.feed_posts fp
join public.professional_profiles p on p.id=fp.professional_id
join public.interests i on i.id=fp.interest_id
cross join params
where fp.is_published
  and fp.created_at > now() - interval '90 days'
  and (
    cursor_id is null
    or (md5(params.seed||fp.id::text),fp.id) < (md5(params.seed||cursor_id::text),cursor_id)
  )
order by md5(params.seed||fp.id::text) desc,fp.id desc
limit least(greatest(page_size,1),30)
$$;
grant execute on function public.get_made_for_you_feed(uuid,integer,text) to anon,authenticated;
