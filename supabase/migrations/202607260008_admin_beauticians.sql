-- Week 3: beautician directory, operational detail, and audited account controls.
create type public.account_status as enum ('active', 'suspended');
alter table public.users
  add column account_status public.account_status not null default 'active',
  add column suspended_at timestamptz,
  add column suspension_reason text;
create index users_professional_account_status_idx
  on public.users(account_status, created_at desc) where role='professional';
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
        u.phone, u.account_status::text status, p.is_verified,
        coalesce(round(r.rating, 1), 0) rating, coalesce(r.review_count, 0) review_count,
        coalesce(b.booking_count, 0) booking_count, coalesce(b.earnings, 0) earnings,
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
        or coalesce(d.phone, '') ilike '%'||query||'%' or d.id::text ilike query||'%')
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
      'years_experience', p.years_experience, 'joined_at', u.created_at,
      'suspended_at', u.suspended_at, 'suspension_reason', u.suspension_reason,
      'rating', coalesce((select round(avg(r.rating), 1) from public.reviews r where r.professional_id=p.id), 0),
      'review_count', (select count(*) from public.reviews r where r.professional_id=p.id),
      'booking_count', (select count(*) from public.bookings b where b.professional_id=p.id),
      'completed_bookings', (select count(*) from public.bookings b where b.professional_id=p.id and b.status='completed'),
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
        select b.id, b.booking_reference, b.service_name, b.starts_at, b.status, b.price, cu.full_name customer_name
        from public.bookings b join public.users cu on cu.id=b.customer_id
        where b.professional_id=p.id order by b.starts_at desc limit 8
      ) x), '[]'::jsonb),
      'recent_reviews', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select r.id, r.rating, r.body, r.created_at, cu.full_name customer_name
        from public.reviews r join public.users cu on cu.id=r.customer_id
        where r.professional_id=p.id order by r.created_at desc limit 5
      ) x), '[]'::jsonb)
    )
    from public.professional_profiles p join public.users u on u.id=p.user_id
    where p.id=beautician_id
  );
end;
$$;
create or replace function public.set_admin_beautician_status(
  beautician_id uuid,
  new_status public.account_status,
  reason text
)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  target record;
  clean_reason text := trim(coalesce(reason, ''));
begin
  if not public.admin_has_permission('users.manage') then
    raise exception 'User management access required' using errcode='42501';
  end if;
  if char_length(clean_reason) < 5 then
    raise exception 'A reason of at least 5 characters is required';
  end if;

  select p.id, p.user_id, coalesce(nullif(p.display_name, ''), p.business_name) name,
    u.account_status old_status into target
  from public.professional_profiles p join public.users u on u.id=p.user_id
  where p.id=beautician_id for update of u;
  if not found then raise exception 'Beautician not found' using errcode='P0002'; end if;
  if target.old_status=new_status then raise exception 'Account is already %', new_status; end if;

  update public.users set account_status=new_status,
    suspended_at=case when new_status='suspended' then now() else null end,
    suspension_reason=case when new_status='suspended' then clean_reason else null end
  where id=target.user_id;

  insert into public.admin_audit_logs(actor_id, action, resource_type, resource_id, summary, metadata)
  values ((select auth.uid()), 'beautician.'||new_status::text, 'beautician', beautician_id,
    case when new_status='suspended' then 'Suspended ' else 'Reinstated ' end||target.name,
    jsonb_build_object('reason', clean_reason, 'previous_status', target.old_status, 'new_status', new_status));

  return jsonb_build_object('id', beautician_id, 'status', new_status);
end;
$$;
revoke all on function public.get_admin_beauticians(text,text,text,text,numeric,integer,integer),
  public.get_admin_beautician(uuid), public.set_admin_beautician_status(uuid,public.account_status,text)
  from public, anon;
grant execute on function public.get_admin_beauticians(text,text,text,text,numeric,integer,integer),
  public.get_admin_beautician(uuid), public.set_admin_beautician_status(uuid,public.account_status,text)
  to authenticated;
