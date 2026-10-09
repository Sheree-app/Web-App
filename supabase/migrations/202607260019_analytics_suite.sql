create table public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_name text not null check (event_name in ('app_open','feed_view','post_share','profile_view','booking_started','booking_created')),
  professional_id uuid references public.professional_profiles(id) on delete set null,
  post_id uuid references public.feed_posts(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index analytics_events_name_time_idx on public.analytics_events(event_name,occurred_at desc);
create index analytics_events_user_time_idx on public.analytics_events(user_id,occurred_at desc);
alter table public.analytics_events enable row level security;
create policy "users create analytics events" on public.analytics_events for insert to authenticated
  with check (user_id=(select auth.uid()));
create policy "analytics admins read events" on public.analytics_events for select to authenticated
  using (public.admin_has_permission('analytics.view'));
grant insert(user_id,event_name,professional_id,post_id,booking_id,properties) on public.analytics_events to authenticated;
grant usage,select on sequence public.analytics_events_id_seq to authenticated;
create or replace function public.track_analytics_event(
  tracked_event text,
  target_professional uuid default null,
  target_post uuid default null,
  target_booking uuid default null,
  event_properties jsonb default '{}'::jsonb
) returns bigint language plpgsql security definer set search_path=''
as $$
declare new_id bigint;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  insert into public.analytics_events(user_id,event_name,professional_id,post_id,booking_id,properties)
  values((select auth.uid()),tracked_event,target_professional,target_post,target_booking,coalesce(event_properties,'{}'::jsonb))
  returning id into new_id;
  return new_id;
end;
$$;
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
      'new_professionals',(select count(*) from public.users where role='professional' and created_at>=period_start),
      'churned',(select count(*) from public.users u where u.created_at<now()-interval '30 days' and not exists(select 1 from public.analytics_events e where e.user_id=u.id and e.occurred_at>=now()-interval '30 days') and not exists(select 1 from public.bookings b where b.customer_id=u.id and b.created_at>=now()-interval '30 days')),
      'series',coalesce((select jsonb_agg(jsonb_build_object('date',d::date,'customers',coalesce(x.customers,0),'professionals',coalesce(x.professionals,0)) order by d)
        from generate_series(period_start,date_trunc('day',now()),interval '1 day')d
        left join lateral(select count(*)filter(where role='customer')customers,count(*)filter(where role='professional')professionals from public.users where created_at>=d and created_at<d+interval '1 day')x on true),'[]'::jsonb)
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
        order by bookings desc limit 20
      )x),'[]'::jsonb)
    ),
    'customers',jsonb_build_object(
      'returning',(select count(*)from(select customer_id from public.bookings group by customer_id having count(*)>1)x),
      'average_spend',coalesce((select round(avg(x.spend),2)from(select customer_id,sum(amount)spend from public.payments where status='paid'group by customer_id)x),0),
      'top',coalesce((select jsonb_agg(to_jsonb(x)order by x.ltv desc)from(select u.id,u.full_name name,sum(p.amount)ltv,count(distinct p.booking_id)bookings,(select b2.service_name from public.bookings b2 where b2.customer_id=u.id group by b2.service_name order by count(*)desc limit 1)favorite_service from public.users u join public.payments p on p.customer_id=u.id and p.status='paid' group by u.id,u.full_name order by ltv desc limit 20)x),'[]'::jsonb),
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
revoke all on function public.track_analytics_event(text,uuid,uuid,uuid,jsonb),public.get_admin_analytics(integer) from public,anon;
grant execute on function public.track_analytics_event(text,uuid,uuid,uuid,jsonb) to authenticated;
grant execute on function public.get_admin_analytics(integer) to authenticated;
