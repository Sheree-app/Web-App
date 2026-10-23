-- Surfaces an all-time booking status breakdown (completed / cancelled / pending)
-- on the administrator overview so the "Total bookings" metric can show how the
-- marketplace's bookings are split. "Pending" mirrors bookings that are yet to
-- be confirmed, i.e. rows still in the 'requested' status.
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
    'booking_breakdown',jsonb_build_object(
      'total',(select count(*) from public.bookings),
      'completed',(select count(*) from public.bookings b where b.status='completed'),
      'cancelled',(select count(*) from public.bookings b where b.status='cancelled'),
      'pending',(select count(*) from public.bookings b where b.status='requested'),
      'confirmed',(select count(*) from public.bookings b where b.status='confirmed'),
      'no_show',(select count(*) from public.bookings b where b.status='no_show')
    ),
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
