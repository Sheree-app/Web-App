-- Exclude former professionals from the admin console's beautician listings,
-- beautician counts, and user totals.
--
-- A "former professional" is an account whose owner deleted it. account-delete
-- soft-deletes the auth user, so the public.users and professional_profiles rows
-- survive (bookings/payouts/disputes reference them with "on delete restrict").
-- The profile is anonymised and tombstoned via professional_profiles.deleted_at
-- (see 202609180003_hide_deleted_professionals_from_discovery.sql), and the
-- customer-facing discovery surfaces already ignore it.
--
-- The admin console did not: the beautician directory, the dashboard KPI
-- (active_beauticians), the overview leaderboard (top_beauticians), the analytics
-- new_professionals/leaderboard, the founding-badge report, and the all-time
-- "Total users" metric all still counted "Former professional" rows. This
-- migration re-defines each of those read models to ignore tombstoned profiles.
--
-- Note: every function below is redefined verbatim from its latest definition,
-- with only the former-professional predicates added.

-- ---------------------------------------------------------------------------
-- Signup / user totals: drop former professionals from the all-time user count
-- and from every role-scoped count they would otherwise inflate.
-- ---------------------------------------------------------------------------
create or replace function public.get_admin_signup_metrics(period_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  days integer := least(greatest(period_days,7),90);
  period_start timestamptz := date_trunc('day',now())-make_interval(days=>least(greatest(period_days,7),90)-1);
  previous_start timestamptz := date_trunc('day',now())-make_interval(days=>least(greatest(period_days,7),90)*2-1);
  previous_end timestamptz := date_trunc('day',now())-make_interval(days=>least(greatest(period_days,7),90));
begin
  if not public.admin_has_permission('dashboard.view') then
    raise exception 'Administrator dashboard access required' using errcode='42501';
  end if;
  return jsonb_build_object(
    'total_users',(select count(*) from public.users u where not exists(select 1 from public.professional_profiles p where p.user_id=u.id and p.deleted_at is not null)),
    'total_signups',(select count(*) from public.users u where not exists(select 1 from public.professional_profiles p where p.user_id=u.id and p.deleted_at is not null)),
    'period_signups',(select count(*) from public.users u where u.created_at>=period_start and not exists(select 1 from public.professional_profiles p where p.user_id=u.id and p.deleted_at is not null)),
    'previous_period_signups',(select count(*) from public.users u where u.created_at>=previous_start and u.created_at<previous_end and not exists(select 1 from public.professional_profiles p where p.user_id=u.id and p.deleted_at is not null)),
    'customer_signups',(select count(*) from public.users where role='customer' and created_at>=period_start),
    'beautician_signups',(select count(*) from public.users u where u.role='professional' and u.created_at>=period_start and not exists(select 1 from public.professional_profiles p where p.user_id=u.id and p.deleted_at is not null))
  );
end;
$$;

revoke all on function public.get_admin_signup_metrics(integer) from public,anon;

grant execute on function public.get_admin_signup_metrics(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Beautician directory: tombstoned profiles must not appear in the list, its
-- total, or the city/category facets derived from it.
-- ---------------------------------------------------------------------------
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
      where p.deleted_at is null
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

-- Beautician detail: return the anonymised "Former professional" row as
-- not-found instead of exposing tombstoned data.
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
    where p.id=beautician_id and p.deleted_at is null
  );
end;
$$;

revoke all on function public.get_admin_beauticians(text,text,text,text,numeric,integer,integer),
  public.get_admin_beautician(uuid)
  from public, anon;

grant execute on function public.get_admin_beauticians(text,text,text,text,numeric,integer,integer),
  public.get_admin_beautician(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard KPI: the active beautician counter must not count tombstoned
-- profiles.
-- ---------------------------------------------------------------------------
create or replace function public.get_admin_dashboard(period_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  days integer := least(greatest(period_days, 7), 90);
  period_start timestamptz := date_trunc('day', now()) - make_interval(days => least(greatest(period_days, 7), 90) - 1);
  previous_start timestamptz := date_trunc('day', now()) - make_interval(days => least(greatest(period_days, 7), 90) * 2 - 1);
  previous_end timestamptz := date_trunc('day', now()) - make_interval(days => least(greatest(period_days, 7), 90));
begin
  if not public.admin_has_permission('dashboard.view') then
    raise exception 'Administrator dashboard access required' using errcode='42501';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'currency', 'GHS',
    'period_days', days,
    'kpis', jsonb_build_object(
      'today_revenue', coalesce((
        select sum(p.amount) from public.payments p
        where p.status='paid' and p.paid_at >= date_trunc('day', now())
      ), 0),
      'today_revenue_previous', coalesce((
        select sum(p.amount) from public.payments p
        where p.status='paid'
          and p.paid_at >= date_trunc('day', now()) - interval '1 day'
          and p.paid_at < date_trunc('day', now())
      ), 0),
      'period_revenue', coalesce((
        select sum(p.amount) from public.payments p
        where p.status='paid' and p.paid_at >= period_start
      ), 0),
      'previous_period_revenue', coalesce((
        select sum(p.amount) from public.payments p
        where p.status='paid' and p.paid_at >= previous_start and p.paid_at < previous_end
      ), 0),
      'total_bookings', (select count(*) from public.bookings),
      'period_bookings', (select count(*) from public.bookings b where b.created_at >= period_start),
      'previous_period_bookings', (
        select count(*) from public.bookings b
        where b.created_at >= previous_start and b.created_at < previous_end
      ),
      'active_bookings', (
        select count(*) from public.bookings b
        where b.status in ('requested','confirmed') and b.ends_at >= now()
      ),
      'active_beauticians', (
        select count(*) from public.professional_profiles p
        where p.onboarding_completed_at is not null
          and p.deleted_at is null
      ),
      'active_customers', (
        select count(*) from public.users u
        where u.role='customer' and u.onboarding_completed_at is not null
      ),
      'pending_payout_amount', coalesce((
        select sum(po.amount) from public.payouts po where po.status in ('pending','processing')
      ), 0),
      'pending_payout_count', (
        select count(*) from public.payouts po where po.status in ('pending','processing')
      ),
      'verification_requests', (
        select count(*) from public.professional_verification_documents d
        where d.status in ('pending','under_review')
      )
    ),
    'health', jsonb_build_object(
      'failed_payments_24h', (
        select count(*) from public.payments p
        where p.status='failed' and p.created_at >= now() - interval '24 hours'
      ),
      'verification_backlog', (
        select count(*) from public.professional_verification_documents d
        where d.status in ('pending','under_review')
      ),
      'oldest_verification_hours', coalesce((
        select floor(extract(epoch from (now() - min(d.submitted_at))) / 3600)
        from public.professional_verification_documents d
        where d.status in ('pending','under_review')
      ), 0),
      'failed_payouts_24h', (
        select count(*) from public.payouts po
        where po.status='failed' and po.created_at >= now() - interval '24 hours'
      ),
      'stale_requested_bookings', (
        select count(*) from public.bookings b
        where b.status='requested' and b.created_at < now() - interval '24 hours'
      ),
      'support_queue_available', false,
      'moderation_queue_available', false
    ),
    'revenue_series', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', day::date,
        'revenue', coalesce(x.revenue, 0),
        'transactions', coalesce(x.transactions, 0)
      ) order by day)
      from generate_series(period_start, date_trunc('day', now()), interval '1 day') day
      left join lateral (
        select sum(p.amount) revenue, count(*) transactions
        from public.payments p
        where p.status='paid'
          and p.paid_at >= day
          and p.paid_at < day + interval '1 day'
      ) x on true
    ), '[]'::jsonb),
    'booking_status', coalesce((
      select jsonb_agg(jsonb_build_object('status', x.status, 'count', x.total) order by x.total desc)
      from (
        select b.status::text status, count(*) total
        from public.bookings b
        where b.created_at >= period_start
        group by b.status
      ) x
    ), '[]'::jsonb),
    'popular_services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', x.service_name,
        'bookings', x.total,
        'revenue', x.revenue
      ) order by x.total desc)
      from (
        select b.service_name, count(*) total,
          coalesce(sum(b.price) filter (where b.status='completed'), 0) revenue
        from public.bookings b
        where b.created_at >= period_start
        group by b.service_name
        order by total desc
        limit 5
      ) x
    ), '[]'::jsonb),
    'recent_activity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', x.activity_type,
        'title', x.title,
        'detail', x.detail,
        'occurred_at', x.occurred_at,
        'href', x.href
      ) order by x.occurred_at desc)
      from (
        (
          select 'payment' activity_type, 'Payment received' title,
            p.currency || ' ' || to_char(p.amount, 'FM999999990.00') || ' · ' || b.service_name detail,
            coalesce(p.paid_at, p.created_at) occurred_at, '/payments' href
          from public.payments p join public.bookings b on b.id=p.booking_id
          where p.status='paid'
          order by coalesce(p.paid_at, p.created_at) desc limit 4
        )
        union all
        (
          select 'booking', 'New booking',
            b.service_name || ' · ' || coalesce(pp.display_name, pp.business_name),
            b.created_at, '/bookings'
          from public.bookings b join public.professional_profiles pp on pp.id=b.professional_id
          order by b.created_at desc limit 4
        )
        union all
        (
          select 'verification', 'Verification submitted',
            coalesce(pp.display_name, pp.business_name) || ' · ' || d.document_type::text,
            d.submitted_at, '/verification'
          from public.professional_verification_documents d
          join public.professional_profiles pp on pp.id=d.professional_id
          order by d.submitted_at desc limit 4
        )
        order by occurred_at desc
        limit 8
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_admin_dashboard(integer) from public, anon;

grant execute on function public.get_admin_dashboard(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard overview: the top-beauticians leaderboard must not surface
-- tombstoned profiles.
-- ---------------------------------------------------------------------------
create or replace function public.get_admin_dashboard_overview(period_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  days integer:=least(greatest(period_days,7),90);
  period_start timestamptz:=date_trunc('day',now())-make_interval(days=>least(greatest(period_days,7),90)-1);
begin
  if not public.admin_has_permission('dashboard.view') then
    raise exception 'Administrator dashboard access required' using errcode='42501';
  end if;
  return jsonb_build_object(
    'booking_demand',coalesce((
      select jsonb_agg(jsonb_build_object('day',x.day_number,'hour',x.hour_bucket,'status',x.status,'bookings',x.bookings) order by x.day_number,x.hour_bucket,x.status)
      from (
        select extract(isodow from b.starts_at)::integer-1 day_number,
          greatest(8,least(20,(floor((extract(hour from b.starts_at)-8)/3)*3+8)::integer)) hour_bucket,
          b.status::text status,count(*) bookings
        from public.bookings b where b.created_at>=period_start and extract(hour from b.starts_at) between 8 and 22
        group by 1,2,3
      ) x
    ),'[]'::jsonb),
    'retention',jsonb_build_object(
      'rate',coalesce((select round(100.0*count(*) filter(where x.bookings>1)/nullif(count(*),0),1) from (
        select b.customer_id,count(*) bookings from public.bookings b where b.created_at>=now()-interval '6 months' group by b.customer_id
      ) x),0),
      'retained_customers',(select count(*) from (
        select b.customer_id from public.bookings b where b.created_at>=now()-interval '6 months' group by b.customer_id having count(*)>1
      ) x),
      'series',coalesce((
        select jsonb_agg(jsonb_build_object('month',to_char(month_start,'Mon'),'rate',coalesce(x.rate,0)) order by month_start)
        from generate_series(date_trunc('month',now())-interval '5 months',date_trunc('month',now()),interval '1 month') month_start
        left join lateral (
          select round(100.0*count(*) filter(where customer_bookings>1)/nullif(count(*),0),1) rate from (
            select b.customer_id,count(*) customer_bookings from public.bookings b
            where b.created_at>=month_start and b.created_at<month_start+interval '1 month' group by b.customer_id
          ) customers
        ) x on true
      ),'[]'::jsonb)
    ),
    'top_beauticians',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.revenue desc,x.bookings desc) from (
        select pp.id,coalesce(pp.display_name,pp.business_name) name,pp.profile_photo_url avatar_url,
          pp.is_verified verified,coalesce(pp.location,pp.business_address,'Location unavailable') location,
          coalesce(category.name,'Beauty') category,count(distinct b.id) bookings,
          coalesce(sum(p.amount) filter(where p.status='paid'),0) revenue
        from public.professional_profiles pp
        join public.bookings b on b.professional_id=pp.id and b.created_at>=date_trunc('month',now())
        left join public.payments p on p.booking_id=b.id
        left join lateral (
          select i.name from public.professional_services s join public.interests i on i.id=s.interest_id
          where s.professional_id=pp.id and s.is_active order by s.sort_order,s.created_at limit 1
        ) category on true
        where pp.deleted_at is null
        group by pp.id,pp.display_name,pp.business_name,pp.profile_photo_url,pp.is_verified,pp.location,pp.business_address,category.name
        order by revenue desc,bookings desc limit 4
      ) x
    ),'[]'::jsonb),
    'attention',jsonb_build_array(
      jsonb_build_object('count',(select count(*) from public.professional_verification_documents d where d.status in('pending','under_review')),
        'label','Verifications waiting','detail','Oldest request is '||coalesce((select floor(extract(epoch from(now()-min(d.submitted_at)))/3600)::text from public.professional_verification_documents d where d.status in('pending','under_review')),'0')||' hours old','action','Review','tone','gold','href','/verification'),
      jsonb_build_object('count',(select count(*) from public.payouts p where p.status='failed'),
        'label','Failed payouts','detail','Provider payouts need review','action','Resolve','tone','blush','href','/payments'),
      jsonb_build_object('count',(select count(*) from public.support_tickets t where t.escalated_at is not null and t.status not in('resolved','closed')),
        'label','Support escalations','detail','Escalated tickets awaiting resolution','action','Open','tone','sage','href','/support'),
      jsonb_build_object('count',(select count(*) from (
          select r.post_id from public.content_reports r where r.status='open'
          union select f.post_id from public.moderation_flags f where f.status='open'
        ) flagged),'label','Flagged content','detail','Open reports and moderation flags','action','Moderate','tone','charcoal','href','/moderation')
    )
  );
end $$;

revoke all on function public.get_admin_dashboard_overview(integer) from public,anon;

grant execute on function public.get_admin_dashboard_overview(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Analytics: new-professional counts, the acquisition series, and the
-- professional leaderboard must ignore tombstoned profiles.
-- ---------------------------------------------------------------------------
create or replace function public.get_admin_analytics(period_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare
  days integer:=least(greatest(period_days,7),365);
  period_start timestamptz:=date_trunc('day',now())-make_interval(days=>least(greatest(period_days,7),365)-1);
  previous_start timestamptz:=date_trunc('day',now())-make_interval(days=>least(greatest(period_days,7),365)*2-1);
  previous_end timestamptz:=date_trunc('day',now())-make_interval(days=>least(greatest(period_days,7),365));
  current_gmv numeric; previous_gmv numeric; result jsonb;
begin
  if not public.admin_has_permission('analytics.view') then
    raise exception 'Analytics access required' using errcode='42501';
  end if;
  select coalesce(sum(amount),0) into current_gmv from public.payments where status='paid' and paid_at>=period_start;
  select coalesce(sum(amount),0) into previous_gmv from public.payments where status='paid' and paid_at>=previous_start and paid_at<previous_end;

  select jsonb_build_object(
    'generated_at',now(),'currency','GHS','period_days',days,
    'marketplace',jsonb_build_object(
      'gmv',current_gmv,
      'revenue',coalesce((select sum(platform_fee) from public.payouts where created_at>=period_start),0),
      'bookings',(select count(*) from public.bookings where created_at>=period_start),
      'completed',(select count(*) from public.bookings where status='completed' and created_at>=period_start),
      'growth_rate',case when previous_gmv=0 then case when current_gmv>0 then 100 else 0 end else round((current_gmv-previous_gmv)*100/previous_gmv,2) end,
      'completion_rate',coalesce(round(100.0*(select count(*) from public.bookings where status='completed' and created_at>=period_start)/nullif((select count(*) from public.bookings where created_at>=period_start),0),2),0),
      'series',coalesce((select jsonb_agg(jsonb_build_object('date',d::date,'gmv',coalesce(x.gmv,0),'bookings',coalesce(x.bookings,0),'revenue',coalesce(x.revenue,0)) order by d)
        from generate_series(period_start,date_trunc('day',now()),interval '1 day') d
        left join lateral(select sum(p.amount) gmv,count(distinct p.booking_id) bookings,coalesce(sum(po.platform_fee),0) revenue
          from public.payments p left join public.payouts po on po.booking_id=p.booking_id
          where p.status='paid' and p.paid_at>=d and p.paid_at<d+interval '1 day')x on true),'[]'::jsonb)
    ),
    'users',jsonb_build_object(
      'dau',(select count(distinct user_id) from public.analytics_events where occurred_at>=now()-interval '1 day'),
      'mau',(select count(distinct user_id) from public.analytics_events where occurred_at>=now()-interval '30 days'),
      'new_customers',(select count(*) from public.users where role='customer' and created_at>=period_start),
      'new_professionals',(select count(*) from public.users u where u.role='professional' and u.created_at>=period_start and not exists(select 1 from public.professional_profiles p where p.user_id=u.id and p.deleted_at is not null)),
      'churned',(select count(*) from public.users u where u.created_at<now()-interval '30 days' and not exists(select 1 from public.analytics_events e where e.user_id=u.id and e.occurred_at>=now()-interval '30 days') and not exists(select 1 from public.bookings b where b.customer_id=u.id and b.created_at>=now()-interval '30 days')),
      'series',coalesce((select jsonb_agg(jsonb_build_object('date',d::date,'customers',coalesce(x.customers,0),'professionals',coalesce(x.professionals,0)) order by d)
        from generate_series(period_start,date_trunc('day',now()),interval '1 day')d
        left join lateral(select count(*)filter(where role='customer')customers,count(*)filter(where role='professional')professionals from public.users u where u.created_at>=d and u.created_at<d+interval '1 day' and not exists(select 1 from public.professional_profiles p where p.user_id=u.id and p.deleted_at is not null))x on true),'[]'::jsonb)
    ),
    'bookings',jsonb_build_object(
      'peak_hours',coalesce((
        select jsonb_agg(
          jsonb_build_object('hour',x.hour_bucket,'bookings',x.total)
          order by x.hour_bucket
        )
        from (
          select extract(hour from starts_at)::integer as hour_bucket,count(*) as total
          from public.bookings
          where created_at>=period_start
          group by extract(hour from starts_at)::integer
        ) x
      ),'[]'::jsonb),
      'popular_services',coalesce((select jsonb_agg(to_jsonb(x)order by x.bookings desc)from(select service_name name,count(*)bookings,coalesce(sum(price)filter(where status='completed'),0)revenue from public.bookings where created_at>=period_start group by service_name order by bookings desc limit 10)x),'[]'::jsonb),
      'top_cities',coalesce((select jsonb_agg(to_jsonb(x)order by x.bookings desc)from(select coalesce(p.location,p.business_address,'Unknown')city,count(*)bookings from public.bookings b join public.professional_profiles p on p.id=b.professional_id where b.created_at>=period_start group by 1 order by bookings desc limit 10)x),'[]'::jsonb),
      'repeat_customers',(select count(*)from(select customer_id from public.bookings where created_at>=period_start group by customer_id having count(*)>1)x),
      'cancellations',coalesce((select jsonb_agg(jsonb_build_object('date',d::date,'cancelled',coalesce(x.cancelled,0),'rate',coalesce(x.rate,0))order by d)from generate_series(period_start,date_trunc('day',now()),interval '1 day')d left join lateral(select count(*)filter(where status='cancelled')cancelled,round(100.0*count(*)filter(where status='cancelled')/nullif(count(*),0),2)rate from public.bookings where created_at>=d and created_at<d+interval '1 day')x on true),'[]'::jsonb)
    ),
    'financial',jsonb_build_object(
      'average_booking_value',coalesce((select round(avg(amount),2)from public.payments where status='paid' and paid_at>=period_start),0),
      'commission',coalesce((select sum(platform_fee)from public.payouts where created_at>=period_start),0),
      'monthly',coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'month',x.month_bucket,
            'revenue',x.revenue,
            'transactions',x.transactions
          )
          order by x.month_bucket
        )
        from (
          select date_trunc('month',p.paid_at)::date as month_bucket,
            sum(p.amount) as revenue,count(*) as transactions
          from public.payments p
          where p.status='paid' and p.paid_at>=period_start
          group by date_trunc('month',p.paid_at)::date
        ) x
      ),'[]'::jsonb),
      'by_service',coalesce((select jsonb_agg(to_jsonb(x)order by x.revenue desc)from(select b.service_name name,sum(p.amount)revenue,count(*)transactions from public.payments p join public.bookings b on b.id=p.booking_id where p.status='paid'and p.paid_at>=period_start group by b.service_name order by revenue desc limit 10)x),'[]'::jsonb),
      'by_city',coalesce((select jsonb_agg(to_jsonb(x)order by x.revenue desc)from(select coalesce(pp.location,pp.business_address,'Unknown')city,sum(p.amount)revenue from public.payments p join public.bookings b on b.id=p.booking_id join public.professional_profiles pp on pp.id=b.professional_id where p.status='paid'and p.paid_at>=period_start group by 1 order by revenue desc limit 10)x),'[]'::jsonb)
    ),
    'professionals',jsonb_build_object(
      'leaders',coalesce((select jsonb_agg(to_jsonb(x)order by x.bookings desc)from(
        select p.id,coalesce(p.display_name,p.business_name)name,
          coalesce(bs.bookings,0)bookings,coalesce(bs.earnings,0)earnings,
          coalesce(rs.rating,0)rating,
          (select count(*)from public.feed_post_saves s join public.feed_posts fp on fp.id=s.post_id where fp.professional_id=p.id)saves,
          (select count(*)from public.professional_follows f where f.professional_id=p.id and f.created_at>=period_start)growth
        from public.professional_profiles p
        left join lateral(select count(*)bookings,coalesce(sum(b.price)filter(where b.status='completed'),0)earnings from public.bookings b where b.professional_id=p.id and b.created_at>=period_start)bs on true
        left join lateral(select round(avg(r.rating),2)rating from public.reviews r where r.professional_id=p.id)rs on true
        where p.deleted_at is null
        order by bookings desc limit 20
      )x),'[]'::jsonb)
    ),
    'customers',jsonb_build_object(
      'returning',(select count(*)from(select customer_id from public.bookings group by customer_id having count(*)>1)x),
      'average_spend',coalesce((select round(avg(x.spend),2)from(select customer_id,sum(amount)spend from public.payments where status='paid'group by customer_id)x),0),
      'top',coalesce((select jsonb_agg(to_jsonb(x)order by x.ltv desc)from(select u.id,u.username name,sum(p.amount)ltv,count(distinct p.booking_id)bookings,(select b2.service_name from public.bookings b2 where b2.customer_id=u.id group by b2.service_name order by count(*)desc limit 1)favorite_service from public.users u join public.payments p on p.customer_id=u.id and p.status='paid' group by u.id,u.username order by ltv desc limit 20)x),'[]'::jsonb),
      'top_locations',coalesce((select jsonb_agg(to_jsonb(x)order by x.customers desc)from(select coalesce(pp.location,pp.business_address,'Unknown')location,count(distinct b.customer_id)customers from public.bookings b join public.professional_profiles pp on pp.id=b.professional_id group by 1 order by customers desc limit 10)x),'[]'::jsonb)
    ),
    'feed',jsonb_build_object(
      'posts',(select count(*)from public.feed_posts where created_at>=period_start),
      'likes',(select count(*)from public.feed_post_likes where created_at>=period_start),
      'comments',(select count(*)from public.feed_post_comments where created_at>=period_start),
      'saves',(select count(*)from public.feed_post_saves where created_at>=period_start),
      'shares',(select count(*)from public.analytics_events where event_name='post_share'and occurred_at>=period_start),
      'profile_visits',(select count(*)from public.analytics_events where event_name='profile_view'and occurred_at>=period_start),
      'booking_conversion',coalesce(round(100.0*(select count(*)from public.analytics_events where event_name='booking_created'and occurred_at>=period_start)/nullif((select count(*)from public.analytics_events where event_name='profile_view'and occurred_at>=period_start),0),2),0),
      'top_posts',coalesce((select jsonb_agg(to_jsonb(x)order by x.engagement desc)from(select fp.id,fp.caption,fp.image_url,coalesce(p.display_name,p.business_name)professional,(select count(*)from public.feed_post_likes l where l.post_id=fp.id)+(select count(*)from public.feed_post_comments c where c.post_id=fp.id)+(select count(*)from public.feed_post_saves s where s.post_id=fp.id)engagement from public.feed_posts fp join public.professional_profiles p on p.id=fp.professional_id where fp.created_at>=period_start order by engagement desc limit 10)x),'[]'::jsonb)
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_admin_analytics(integer) from public,anon;

grant execute on function public.get_admin_analytics(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Founding-badge report: badges are permanent, but a former professional no
-- longer belongs in the admin directory of active beauticians.
-- ---------------------------------------------------------------------------
create or replace function public.get_admin_founding_badges(
  search_query text default '',
  category_filter text default '',
  page_number integer default 1,
  page_size integer default 25
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  query text := trim(coalesce(search_query, ''));
  requested_category text := trim(coalesce(category_filter, ''));
  page integer := greatest(coalesce(page_number, 1), 1);
  size integer := least(greatest(coalesce(page_size, 25), 1), 500);
begin
  if not public.admin_has_permission('users.read') then
    raise exception 'User directory access required' using errcode='42501';
  end if;

  return (
    with directory as (
      select
        b.id, b.founding_position, b.awarded_at, b.qualifying_at,
        p.id as professional_id, p.is_founding_beautician,
        coalesce(nullif(p.display_name, ''), p.business_name) name,
        p.business_name, i.name as category, i.slug as category_slug,
        u.account_status::text status, p.is_verified
      from public.professional_founding_badges b
      join public.professional_profiles p on p.id=b.professional_id
      join public.users u on u.id=p.user_id
      join public.interests i on i.id=b.category_id
      where p.deleted_at is null
    ),
    filtered as (
      select * from directory d
      where (query='' or d.name ilike '%'||query||'%' or d.business_name ilike '%'||query||'%')
        and (requested_category='' or d.category ilike '%'||requested_category||'%')
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.category, x.founding_position)
        from (
          select * from filtered
          order by category, founding_position
          limit size offset (page - 1) * size
        ) x
      ), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'page', page,
      'page_size', size,
      'limit_per_category', public.founding_limit_per_category(),
      'facets', jsonb_build_object(
        'categories', coalesce((
          select jsonb_agg(jsonb_build_object('name', c.category, 'slug', c.category_slug, 'claimed', c.claimed)
            order by c.category)
          from (
            select category, category_slug, count(*) claimed from directory group by category, category_slug
          ) c
        ), '[]'::jsonb)
      )
    )
  );
end;
$$;

revoke all on function public.get_admin_founding_badges(text,text,integer,integer) from public, anon;

grant execute on function public.get_admin_founding_badges(text,text,integer,integer) to authenticated;
