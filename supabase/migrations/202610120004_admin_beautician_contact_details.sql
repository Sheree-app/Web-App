-- Administrator beautician directory: contact details.
--
-- Operations could not actually reach a professional from the panel. Both directory
-- RPCs already selected `u.phone` but the UI never rendered it, and everything else
-- needed to contact someone — account email, WhatsApp, Instagram, and the business
-- address — was not returned at all, so an admin had to leave the panel and look the
-- person up in the mobile app.
--
-- `public.users` has no email column (the identity email lives on `auth.users`), so
-- email is read through `admin_user_email()`, a security definer helper. It is
-- revoked from `authenticated` deliberately: only the two admin RPCs below, which
-- already require `users.read`, can reach it.

create or replace function public.admin_user_email(target_user uuid)
returns text
language plpgsql stable security definer set search_path='' as $$
declare found_email text;
begin
  select au.email::text into found_email from auth.users au where au.id=target_user;
  return found_email;
exception when others then
  -- Never let the identity table break the directory: a missing email degrades to
  -- "not on file" instead of a 500 on the whole beautician page.
  return null;
end;
$$;

revoke all on function public.admin_user_email(uuid) from public, anon, authenticated;

create or replace function public.get_admin_beauticians(
  search_query text default '',
  status_filter text default 'all',
  city_filter text default '',
  category_filter text default '',
  minimum_rating numeric default 0,
  page_number integer default 1,
  page_size integer default 20
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  query text := trim(coalesce(search_query, ''));
  requested_status text := lower(coalesce(status_filter, 'all'));
  requested_city text := trim(coalesce(city_filter, ''));
  requested_category text := trim(coalesce(category_filter, ''));
  rating_floor numeric := least(greatest(coalesce(minimum_rating, 0), 0), 5);
  page integer := greatest(coalesce(page_number, 1), 1);
  size integer := least(greatest(coalesce(page_size, 20), 1), 5000);
begin
  if not public.admin_has_permission('users.read') then
    raise exception 'User directory access required' using errcode='42501';
  end if;

  return (
    with directory as (
      select
        p.id, p.user_id, coalesce(nullif(p.display_name, ''), p.business_name) name,
        p.business_name, coalesce(p.profile_photo_url, u.avatar_url) avatar_url,
        coalesce(p.location, p.business_address, 'Not provided') city,
        p.business_address address,
        public.admin_user_email(p.user_id) email,
        u.phone, u.account_status::text status, p.is_verified,
        (select sl.url from public.professional_social_links sl
          where sl.professional_id=p.id and sl.platform='whatsapp') whatsapp,
        coalesce(round(r.rating, 1), 0) rating, coalesce(r.review_count, 0) review_count,
        coalesce(b.booking_count, 0) booking_count, coalesce(b.earnings, 0) earnings,
        coalesce(b.completed_bookings, 0) completed_bookings,
        coalesce(b.cancelled_bookings, 0) cancelled_bookings,
        coalesce(b.pending_bookings, 0) pending_bookings,
        coalesce(c.categories, array[]::text[]) categories,
        u.created_at, u.suspended_at
      from public.professional_profiles p
      join public.users u on u.id=p.user_id and u.role='professional'
      left join lateral (
        select avg(rv.rating)::numeric rating, count(*) review_count
        from public.reviews rv where rv.professional_id=p.id
      ) r on true
      left join lateral (
        select count(*) booking_count,
          count(*) filter (where bk.status='completed') completed_bookings,
          count(*) filter (where bk.status='cancelled') cancelled_bookings,
          count(*) filter (where bk.status='requested') pending_bookings,
          coalesce(sum(bk.price) filter (where bk.status='completed'), 0) earnings
        from public.bookings bk where bk.professional_id=p.id
      ) b on true
      left join lateral (
        select array_agg(i.name order by pc.is_primary desc, i.name) categories
        from public.professional_categories pc
        join public.interests i on i.id=pc.interest_id
        where pc.professional_id=p.id
      ) c on true
    ),
    filtered as (
      select * from directory d
      where (query='' or d.name ilike '%'||query||'%' or d.business_name ilike '%'||query||'%'
        or coalesce(d.phone, '') ilike '%'||query||'%' or coalesce(d.email, '') ilike '%'||query||'%'
        or d.id::text ilike query||'%')
        and (requested_status='all' or d.status=requested_status)
        and (requested_city='' or d.city ilike '%'||requested_city||'%')
        and (requested_category='' or exists (
          select 1 from unnest(d.categories) category where category ilike '%'||requested_category||'%'
        ))
        and d.rating >= rating_floor
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.created_at desc)
        from (
          select * from filtered
          order by created_at desc
          limit size offset (page - 1) * size
        ) x
      ), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'page', page,
      'page_size', size,
      'facets', jsonb_build_object(
        'cities', coalesce((select jsonb_agg(x.city order by x.city) from (select distinct city from directory) x), '[]'::jsonb),
        'categories', coalesce((select jsonb_agg(x.category order by x.category) from (
          select distinct unnest(categories) category from directory
        ) x), '[]'::jsonb)
      )
    )
  );
end;
$$;

create or replace function public.get_admin_beautician(beautician_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
begin
  if not public.admin_has_permission('users.read') then
    raise exception 'User directory access required' using errcode='42501';
  end if;

  return (
    select jsonb_build_object(
      'id', p.id, 'user_id', p.user_id,
      'name', coalesce(nullif(p.display_name, ''), p.business_name),
      'business_name', p.business_name, 'bio', p.bio,
      'avatar_url', coalesce(p.profile_photo_url, u.avatar_url),
      'cover_image_url', p.cover_image_url, 'city', coalesce(p.location, p.business_address),
      'phone', u.phone, 'status', u.account_status, 'is_verified', p.is_verified,
      -- Contact block: everything an admin needs to reach this professional without
      -- leaving the panel.
      'email', public.admin_user_email(p.user_id),
      'business_address', p.business_address,
      'location', p.location,
      'socials', coalesce((select jsonb_object_agg(sl.platform::text, sl.url)
        from public.professional_social_links sl where sl.professional_id=p.id), '{}'::jsonb),
      'years_experience', p.years_experience, 'joined_at', u.created_at,
      'suspended_at', u.suspended_at, 'suspension_reason', u.suspension_reason,
      'rating', coalesce((select round(avg(r.rating), 1) from public.reviews r where r.professional_id=p.id), 0),
      'review_count', (select count(*) from public.reviews r where r.professional_id=p.id),
      'booking_count', (select count(*) from public.bookings b where b.professional_id=p.id),
      'completed_bookings', (select count(*) from public.bookings b where b.professional_id=p.id and b.status='completed'),
      'cancelled_bookings', (select count(*) from public.bookings b where b.professional_id=p.id and b.status='cancelled'),
      'pending_bookings', (select count(*) from public.bookings b where b.professional_id=p.id and b.status='requested'),
      'confirmed_bookings', (select count(*) from public.bookings b where b.professional_id=p.id and b.status='confirmed'),
      'cancellation_rate', coalesce((select round(100.0 * count(*) filter (where b.status='cancelled') / nullif(count(*), 0), 1)
        from public.bookings b where b.professional_id=p.id), 0),
      'earnings', coalesce((select sum(b.price) from public.bookings b where b.professional_id=p.id and b.status='completed'), 0),
      'categories', coalesce((select jsonb_agg(i.name order by pc.is_primary desc, i.name)
        from public.professional_categories pc join public.interests i on i.id=pc.interest_id
        where pc.professional_id=p.id), '[]'::jsonb),
      'portfolio', coalesce((select jsonb_agg(jsonb_build_object('id', pi.id, 'path', pi.storage_path, 'caption', pi.caption)
        order by pi.sort_order, pi.created_at desc) from public.professional_portfolio_items pi
        where pi.professional_id=p.id), '[]'::jsonb),
      'recent_bookings', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc) from (
        select b.id, b.booking_reference, b.service_name, b.starts_at, b.status, b.price, cu.username customer_name
        from public.bookings b join public.users cu on cu.id=b.customer_id
        where b.professional_id=p.id order by b.starts_at desc limit 8
      ) x), '[]'::jsonb),
      'recent_reviews', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select r.id, r.rating, r.body, r.created_at, cu.username customer_name
        from public.reviews r join public.users cu on cu.id=r.customer_id
        where r.professional_id=p.id order by r.created_at desc limit 5
      ) x), '[]'::jsonb)
    )
    from public.professional_profiles p join public.users u on u.id=p.user_id
    where p.id=beautician_id
  );
end;
$$;

revoke all on function public.get_admin_beauticians(text,text,text,text,numeric,integer,integer),
  public.get_admin_beautician(uuid) from public, anon;

grant execute on function public.get_admin_beauticians(text,text,text,text,numeric,integer,integer),
  public.get_admin_beautician(uuid) to authenticated;
