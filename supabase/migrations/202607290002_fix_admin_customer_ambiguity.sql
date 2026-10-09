-- Qualify customer_id references so they cannot be confused with the RPC
-- parameter of the same name.
create or replace function public.get_admin_customer(customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.admin_has_permission('users.read') then
    raise exception 'User directory access required' using errcode='42501';
  end if;

  return (select jsonb_build_object(
    'id',u.id,'name',u.full_name,'avatar_url',u.avatar_url,'phone',u.phone,'status',u.account_status,
    'joined_at',u.created_at,
    'last_active_at',greatest(
      coalesce((select max(b.created_at) from public.bookings b where b.customer_id=u.id),u.created_at),
      coalesce((select max(p.created_at) from public.payments p where p.customer_id=u.id),u.created_at)
    ),
    'blocked_at',u.blocked_at,'block_reason',u.block_reason,
    'booking_count',(select count(*) from public.bookings b where b.customer_id=u.id),
    'completed_bookings',(select count(*) from public.bookings b where b.customer_id=u.id and b.status='completed'),
    'cancelled_bookings',(select count(*) from public.bookings b where b.customer_id=u.id and b.status='cancelled'),
    'total_spend',coalesce((select sum(p.amount) from public.payments p where p.customer_id=u.id and p.status='paid'),0),
    'refunded',coalesce((select sum(p.amount) from public.payments p where p.customer_id=u.id and p.status='refunded'),0),
    'bookings',coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc) from (
      select b.id,b.booking_reference,b.service_name,b.starts_at,b.status,b.payment_status,b.price,
        coalesce(pp.display_name,pp.business_name) beautician_name
      from public.bookings b join public.professional_profiles pp on pp.id=b.professional_id
      where b.customer_id=u.id order by b.starts_at desc limit 20
    ) x),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select p.id,p.provider_reference,p.amount,p.currency,p.status,p.channel,p.created_at,b.service_name
      from public.payments p join public.bookings b on b.id=p.booking_id
      where p.customer_id=u.id order by p.created_at desc limit 20
    ) x),'[]'::jsonb),
    'reports',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select r.id,r.reason,r.status,r.created_at,reporter.full_name reporter_name
      from public.customer_reports r left join public.users reporter on reporter.id=r.reporter_id
      where r.customer_id=u.id order by r.created_at desc
    ) x),'[]'::jsonb),
    'warnings',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select w.id,w.reason,w.created_at,au.display_name issued_by_name
      from public.customer_warnings w join public.admin_users au on au.user_id=w.issued_by
      where w.customer_id=u.id order by w.created_at desc
    ) x),'[]'::jsonb)
  ) from public.users u where u.id=get_admin_customer.customer_id and u.role='customer');
end $$;
