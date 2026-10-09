-- Week 2: admin marketplace pulse and permission-gated global search.
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
create or replace function public.admin_global_search(search_query text, result_limit integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  query text := trim(search_query);
  limited integer := least(greatest(result_limit, 1), 20);
begin
  if not public.is_active_admin() then
    raise exception 'Active administrator access required' using errcode='42501';
  end if;
  if char_length(query) < 2 then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'type', x.result_type,
      'id', x.id,
      'title', x.title,
      'subtitle', x.subtitle,
      'status', x.status,
      'href', x.href
    ) order by x.rank_order, x.title)
    from (
      (
        select case when u.role='professional' then 'beautician' else 'customer' end result_type,
          u.id::text id, u.full_name title,
          coalesce(u.phone, u.role::text) subtitle,
          case when u.onboarding_completed_at is null then 'onboarding' else 'active' end status,
          case when u.role='professional' then '/beauticians' else '/customers' end href,
          1 rank_order
        from public.users u
        where u.full_name ilike '%' || query || '%'
          or coalesce(u.phone, '') ilike '%' || query || '%'
        limit limited
      )
      union all
      (
        select 'beautician', pp.id::text, coalesce(pp.display_name, pp.business_name),
          coalesce(pp.location, pp.business_address, 'Professional'),
          case when pp.is_verified then 'verified' else 'unverified' end,
          '/beauticians', 2
        from public.professional_profiles pp
        where pp.business_name ilike '%' || query || '%'
          or coalesce(pp.display_name, '') ilike '%' || query || '%'
          or coalesce(pp.location, '') ilike '%' || query || '%'
        limit limited
      )
      union all
      (
        select 'booking', b.id::text, coalesce(b.booking_reference, left(b.id::text, 8)),
          b.service_name || ' · ' || to_char(b.starts_at, 'DD Mon YYYY'),
          b.status::text, '/bookings', 3
        from public.bookings b
        where b.id::text ilike query || '%'
          or coalesce(b.booking_reference, '') ilike '%' || query || '%'
          or b.service_name ilike '%' || query || '%'
        limit limited
      )
      union all
      (
        select 'payment', p.id::text, p.provider_reference,
          p.currency || ' ' || to_char(p.amount, 'FM999999990.00'),
          p.status::text, '/payments', 4
        from public.payments p
        where p.id::text ilike query || '%'
          or p.provider_reference ilike '%' || query || '%'
        limit limited
      )
      order by rank_order
      limit limited
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_admin_dashboard(integer),
  public.admin_global_search(text, integer) from public, anon;
grant execute on function public.get_admin_dashboard(integer),
  public.admin_global_search(text, integer) to authenticated;
