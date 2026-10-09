-- Week 5: operational booking directory, calendar, and booking drill-down.
create index if not exists bookings_admin_created_idx on public.bookings(created_at desc);
create index if not exists bookings_admin_status_starts_idx on public.bookings(status,starts_at desc);
create or replace function public.get_admin_bookings(
  search_query text default '', view_filter text default 'upcoming',
  range_start timestamptz default null, range_end timestamptz default null,
  page_number integer default 1, page_size integer default 25
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  query text:=trim(coalesce(search_query,'')); requested_view text:=lower(coalesce(view_filter,'upcoming'));
  page integer:=greatest(coalesce(page_number,1),1); size integer:=least(greatest(coalesce(page_size,25),1),5000);
begin
  if not public.admin_has_permission('bookings.read') then raise exception 'Booking access required' using errcode='42501'; end if;
  return (
    with directory as (
      select b.id,b.booking_reference,b.service_name,b.starts_at,b.ends_at,b.status::text status,
        case when b.status in ('requested','confirmed') and b.starts_at<=now() and b.ends_at>=now() then 'ongoing'
          when b.status in ('requested','confirmed') and b.starts_at>now() then 'upcoming'
          else b.status::text end operational_status,
        b.payment_status::text payment_status,b.price,b.deposit_amount,b.balance_amount,b.is_mobile_service,
        customer.id customer_id,customer.full_name customer_name,customer.avatar_url customer_avatar,
        pp.id professional_id,coalesce(nullif(pp.display_name,''),pp.business_name) professional_name,
        pp.profile_photo_url professional_avatar,b.created_at
      from public.bookings b join public.users customer on customer.id=b.customer_id
      join public.professional_profiles pp on pp.id=b.professional_id
    ), filtered as (
      select * from directory d where
        (query='' or coalesce(d.booking_reference,'') ilike '%'||query||'%' or d.id::text ilike query||'%'
          or d.customer_name ilike '%'||query||'%' or d.professional_name ilike '%'||query||'%'
          or d.service_name ilike '%'||query||'%')
        and (requested_view='all' or d.operational_status=requested_view)
        and (range_start is null or d.starts_at>=range_start)
        and (range_end is null or d.starts_at<range_end)
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at asc) from
        (select * from filtered order by starts_at asc limit size offset (page-1)*size)x),'[]'::jsonb),
      'total',(select count(*) from filtered),'page',page,'page_size',size,
      'counts',jsonb_build_object(
        'upcoming',(select count(*) from directory where operational_status='upcoming'),
        'ongoing',(select count(*) from directory where operational_status='ongoing'),
        'completed',(select count(*) from directory where operational_status='completed'),
        'cancelled',(select count(*) from directory where operational_status='cancelled'),
        'no_show',(select count(*) from directory where operational_status='no_show')
      )
    )
  );
end $$;
create or replace function public.get_admin_booking(booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.admin_has_permission('bookings.read') then raise exception 'Booking access required' using errcode='42501'; end if;
  return (select jsonb_build_object(
    'id',b.id,'booking_reference',b.booking_reference,'service_name',b.service_name,'starts_at',b.starts_at,'ends_at',b.ends_at,
    'status',b.status,'operational_status',case when b.status in ('requested','confirmed') and b.starts_at<=now() and b.ends_at>=now() then 'ongoing' when b.status in ('requested','confirmed') and b.starts_at>now() then 'upcoming' else b.status::text end,
    'payment_status',b.payment_status,'price',b.price,'deposit_amount',b.deposit_amount,'balance_amount',b.balance_amount,
    'notes',b.notes,'cancellation_policy',b.cancellation_policy,'is_mobile_service',b.is_mobile_service,'travel_fee',b.travel_fee,
    'created_at',b.created_at,'updated_at',b.updated_at,'cancelled_at',b.cancelled_at,'cancellation_reason',b.cancellation_reason,
    'customer',jsonb_build_object('id',cu.id,'name',cu.full_name,'avatar_url',cu.avatar_url,'phone',cu.phone,'status',cu.account_status),
    'professional',jsonb_build_object('id',pp.id,'name',coalesce(nullif(pp.display_name,''),pp.business_name),'business_name',pp.business_name,'avatar_url',pp.profile_photo_url,'phone',pu.phone,'verified',pp.is_verified),
    'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select p.id,p.provider_reference,p.amount,p.currency,p.status,p.channel,p.gateway_response,p.created_at,p.paid_at
      from public.payments p where p.booking_id=b.id order by p.created_at desc)x),'[]'::jsonb),
    'settlement',(select to_jsonb(s) from public.booking_cancellation_settlements s where s.booking_id=b.id),
    'timeline',jsonb_build_array(
      jsonb_build_object('event','Booking created','detail','Request entered the marketplace','occurred_at',b.created_at),
      jsonb_build_object('event','Appointment starts','detail',b.service_name,'occurred_at',b.starts_at),
      jsonb_build_object('event','Appointment ends','detail','Scheduled completion','occurred_at',b.ends_at)
    ) || coalesce((select jsonb_agg(jsonb_build_object('event',
      case p.status when 'paid' then 'Payment received' when 'failed' then 'Payment failed' when 'refunded' then 'Payment refunded' else 'Payment initiated' end,
      'detail',p.currency||' '||to_char(p.amount,'FM999999990.00')||' · '||p.provider_reference,
      'occurred_at',coalesce(p.paid_at,p.created_at)) order by coalesce(p.paid_at,p.created_at))
      from public.payments p where p.booking_id=b.id),'[]'::jsonb)
      || case when b.cancelled_at is not null then jsonb_build_array(jsonb_build_object('event','Booking cancelled','detail',coalesce(b.cancellation_reason,'No reason recorded'),'occurred_at',b.cancelled_at)) else '[]'::jsonb end
  ) from public.bookings b join public.users cu on cu.id=b.customer_id
    join public.professional_profiles pp on pp.id=b.professional_id join public.users pu on pu.id=pp.user_id
    where b.id=booking_id);
end $$;
revoke all on function public.get_admin_bookings(text,text,timestamptz,timestamptz,integer,integer),
  public.get_admin_booking(uuid) from public,anon;
grant execute on function public.get_admin_bookings(text,text,timestamptz,timestamptz,integer,integer),
  public.get_admin_booking(uuid) to authenticated;
