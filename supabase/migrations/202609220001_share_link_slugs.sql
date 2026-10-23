-- Human-readable slugs for every share link.
--
-- Share links used to embed raw UUIDs:
--   https://sheree.world/professional/4f1c9e2a-8b77-4a1e-9d3f-2c6b0f1a5e77
--   https://sheree.world/post/4f1c9e2a-8b77-4a1e-9d3f-2c6b0f1a5e77
-- They now read like the content they point at:
--   https://sheree.world/professional/ama-braids   -> /professional/[id]
--   https://sheree.world/services/ama-braids       -> /services/[id]
--   https://sheree.world/post/knotless-braids-4f1c9e2a -> /post/[id]
-- Collections already shared a slug (/collection/wedding), so they are unchanged.
--
-- The app routes keep their single `[id]` segment: the slug simply arrives as
-- that parameter and every resolver below accepts BOTH a slug and the legacy
-- UUID, so links shared before this migration never break.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Lowercase, drop punctuation and collapse runs into single dashes.
create or replace function public.slugify(value text)
returns text
language sql
immutable
set search_path=''
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(value,'')),'[^a-z0-9]+','-','g'))
$$;

-- Stable 8-character tag derived from a UUID. It keeps two posts that share a
-- caption from colliding without making the slug unreadable. The tag is a hash
-- so it stays well distributed whatever UUID version generated the id.
create or replace function public.uuid_tag(value uuid)
returns text
language sql
immutable
set search_path=''
as $$
  select substr(md5(value::text),1,8)
$$;

-- A unique profile handle derived from the business name ("Ama's Braids" ->
-- "ama-s-braids", with "-2", "-3", ... appended on collision).
create or replace function public.generate_profile_handle(p_id uuid, p_business_name text)
returns text
language plpgsql
set search_path=''
as $$
declare
  base text;
  candidate text;
  suffix integer := 1;
begin
  base := nullif(left(public.slugify(p_business_name),40),'');
  if base is null then base := 'studio'; end if;
  candidate := base;
  while exists (
    select 1 from public.professional_profiles p
    where p.handle = candidate and p.id <> p_id
  ) loop
    suffix := suffix + 1;
    candidate := left(base,36) || '-' || suffix;
  end loop;
  return candidate;
end $$;

-- Deterministic post slug: caption words + a short id tag.
create or replace function public.generate_post_slug(p_id uuid, p_caption text)
returns text
language sql
immutable
set search_path=''
as $$
  select left(coalesce(nullif(public.slugify(p_caption),''),'look'),48) || '-' || public.uuid_tag(p_id)
$$;

-- ---------------------------------------------------------------------------
-- Columns + backfill
-- ---------------------------------------------------------------------------

alter table public.professional_profiles add column if not exists handle text;
alter table public.feed_posts add column if not exists slug text;

-- Backfill one row at a time so each new handle can see the ones already
-- assigned by earlier iterations of this loop.
do $$
declare
  r record;
begin
  for r in
    select id, business_name
    from public.professional_profiles
    where handle is null or handle = ''
    order by created_at
  loop
    update public.professional_profiles p
    set handle = public.generate_profile_handle(p.id, p.business_name)
    where p.id = r.id;
  end loop;
end $$;

update public.feed_posts
set slug = public.generate_post_slug(id, caption)
where slug is null or slug = '';

alter table public.professional_profiles alter column handle set not null;
alter table public.feed_posts alter column slug set not null;

create unique index if not exists professional_profiles_handle_key
  on public.professional_profiles(handle);
create unique index if not exists feed_posts_slug_key
  on public.feed_posts(slug);

-- Handles are assigned once and then stay put, so a shared link keeps working
-- even after the professional renames their business.
create or replace function public.professional_profiles_assign_handle()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.handle is null or new.handle = '' then
    new.handle := public.generate_profile_handle(new.id, new.business_name);
  end if;
  return new;
end $$;

drop trigger if exists professional_profiles_assign_handle on public.professional_profiles;
create trigger professional_profiles_assign_handle
before insert on public.professional_profiles
for each row execute function public.professional_profiles_assign_handle();

create or replace function public.feed_posts_assign_slug()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.slug is null or new.slug = '' then
    new.slug := public.generate_post_slug(new.id, new.caption);
  end if;
  return new;
end $$;

drop trigger if exists feed_posts_assign_slug on public.feed_posts;
create trigger feed_posts_assign_slug
before insert on public.feed_posts
for each row execute function public.feed_posts_assign_slug();

-- ---------------------------------------------------------------------------
-- Resolvers (slug OR legacy UUID)
-- ---------------------------------------------------------------------------

create or replace function public.resolve_profile_id(profile_key text)
returns uuid
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  found uuid;
begin
  if profile_key is null or btrim(profile_key) = '' then return null; end if;
  select p.id into found
  from public.professional_profiles p
  where p.handle = lower(btrim(profile_key))
  limit 1;
  if found is not null then return found; end if;
  begin
    select p.id into found
    from public.professional_profiles p
    where p.id = btrim(profile_key)::uuid
    limit 1;
  exception when invalid_text_representation then
    return null;
  end;
  return found;
end $$;
revoke all on function public.resolve_profile_id(text) from public;
grant execute on function public.resolve_profile_id(text) to anon,authenticated;

create or replace function public.resolve_post_id(post_key text)
returns uuid
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  found uuid;
begin
  if post_key is null or btrim(post_key) = '' then return null; end if;
  select fp.id into found
  from public.feed_posts fp
  where fp.slug = btrim(post_key)
  limit 1;
  if found is not null then return found; end if;
  begin
    select fp.id into found
    from public.feed_posts fp
    where fp.id = btrim(post_key)::uuid
    limit 1;
  exception when invalid_text_representation then
    return null;
  end;
  return found;
end $$;
revoke all on function public.resolve_post_id(text) from public;
grant execute on function public.resolve_post_id(text) to anon,authenticated;

-- The slug a share link should embed for an entity ("post" -> post slug,
-- anything else -> professional handle). Falls back to the UUID when a slug is
-- somehow missing, so a link is always produced.
create or replace function public.get_share_slug(kind text, entity_id uuid)
returns text
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  slug text;
begin
  if entity_id is null then return null; end if;
  if kind = 'post' then
    select fp.slug into slug from public.feed_posts fp where fp.id = entity_id;
  else
    select p.handle into slug from public.professional_profiles p where p.id = entity_id;
  end if;
  return coalesce(slug, entity_id::text);
end $$;
revoke all on function public.get_share_slug(text,uuid) from public;
grant execute on function public.get_share_slug(text,uuid) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- Widen the profile/service readers to accept a handle as well as a UUID
-- ---------------------------------------------------------------------------

-- The uuid overload is dropped (rather than kept alongside) so PostgREST never
-- has to guess between two overloads for the same `profile_id` argument.
drop function if exists public.get_creator_profile(uuid);
create or replace function public.get_creator_profile(profile_id text)
returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object(
  'id',p.id,'handle',p.handle,'name',coalesce(p.display_name,p.business_name),'business_name',p.business_name,
  'bio',coalesce(p.bio,''),'location',coalesce(nullif(trim(p.business_address),''),nullif(trim(p.location),''),'Location not provided'),
  'verified',p.is_verified,'avatar',p.profile_photo_url,
  'followers',(select count(*) from public.professional_follows f where f.professional_id=p.id),
  'following',exists(select 1 from public.professional_follows f where f.professional_id=p.id and f.user_id=(select auth.uid())),
  'bookings',(select count(*) from public.bookings b where b.professional_id=p.id and b.status='completed'),
  'rating',coalesce((select avg(r.rating) from public.reviews r where r.professional_id=p.id and r.moderation_status='published'),0),
  'review_count',(select count(*) from public.reviews r where r.professional_id=p.id and r.moderation_status='published'),
  'category',coalesce((select i.name from public.professional_services s join public.interests i on i.id=s.interest_id where s.professional_id=p.id and s.is_active order by s.sort_order,s.created_at limit 1),'Beauty'),
  'socials',jsonb_build_object('instagram',(select sl.url from public.professional_social_links sl where sl.professional_id=p.id and sl.platform='instagram' limit 1),'snapchat',(select sl.url from public.professional_social_links sl where sl.professional_id=p.id and sl.platform='snapchat' limit 1),'whatsapp',(select sl.url from public.professional_social_links sl where sl.professional_id=p.id and sl.platform='whatsapp' limit 1),'telephone',(select u.phone from public.users u where u.id=p.user_id)),
  'portfolio',coalesce((select jsonb_agg(jsonb_build_object('id',fp.id,'image',fp.image_url,'caption',fp.caption,'aspect_ratio',fp.aspect_ratio) order by fp.created_at desc) from public.feed_posts fp where fp.professional_id=p.id and fp.is_published),'[]'::jsonb),
  'studio',coalesce((select jsonb_agg(jsonb_build_object('id',sp.id,'image',sp.image_url,'aspect_ratio',sp.aspect_ratio) order by sp.sort_order,sp.created_at) from public.professional_studio_photos sp where sp.professional_id=p.id),'[]'::jsonb),
  'reviews',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'author',x.author,'avatar',x.avatar,'rating',x.rating,'body',x.body,'service',x.service,'created_at',x.created_at) order by x.created_at desc) from (select r.id,u.username author,u.avatar_url avatar,r.rating,r.body,b.service_name service,r.created_at from public.reviews r join public.users u on u.id=r.customer_id join public.bookings b on b.id=r.booking_id where r.professional_id=p.id and r.moderation_status='published' order by r.created_at desc limit 3)x),'[]'::jsonb)
) from public.professional_profiles p where p.id=public.resolve_profile_id(profile_id);
$$;
revoke all on function public.get_creator_profile(text) from public;
grant execute on function public.get_creator_profile(text) to anon,authenticated;

drop function if exists public.get_professional_services(uuid);
create or replace function public.get_professional_services(profile_id text)
returns table(id uuid,name text,description text,price numeric,duration_minutes integer,deposit_percentage numeric,category text,photos jsonb)
language sql stable security invoker set search_path='' as $$
  select s.id,s.name,s.description,s.price,s.duration_minutes,s.deposit_percentage,i.name,
    coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'storage_path',p.storage_path,'alt_text',p.alt_text) order by p.sort_order,p.created_at) from public.service_photos p where p.service_id=s.id),'[]'::jsonb)
  from public.professional_services s left join public.interests i on i.id=s.interest_id
  where s.professional_id=public.resolve_profile_id(profile_id) and s.is_active
  order by s.sort_order,s.created_at;
$$;
revoke all on function public.get_professional_services(text) from public;
grant execute on function public.get_professional_services(text) to anon,authenticated;

-- PostgREST caches the schema; make the new signatures visible immediately.
notify pgrst, 'reload schema';
