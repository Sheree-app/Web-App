-- Sheree no longer uses "full name". The users table stores a public
-- username, so the column is renamed to keep the schema honest with the app.
alter table public.users rename column full_name to username;

-- Column-level grant follows the column by attribute number, but restate it
-- under the new name so the schema reads clearly.
grant update(username,avatar_url,phone) on public.users to authenticated;

-- Auth trigger: create the profile row using the username from sign-up
-- metadata (with a legacy full_name fallback for earlier clients).
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare requested_role public.user_role;
declare needs_onboarding boolean;
begin
  requested_role := case when new.raw_user_meta_data->>'role'='professional' then 'professional'::public.user_role else 'customer'::public.user_role end;
  needs_onboarding := coalesce((new.raw_user_meta_data->>'requires_onboarding')::boolean,false);
  insert into public.users(id,role,username,onboarding_step,onboarding_completed_at)
  values(
    new.id,
    requested_role,
    coalesce(nullif(trim(new.raw_user_meta_data->>'username'),''),nullif(trim(new.raw_user_meta_data->>'full_name'),''),split_part(coalesce(new.email,'Sheree member'),'@',1)),
    case when needs_onboarding then 'role_selection' else 'complete' end,
    case when needs_onboarding then null else now() end
  ) on conflict(id) do nothing;
  return new;
end;
$$;

-- Feed social notifications.
create or replace function public.week11_social_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;actor_name text;post_image text;action_text text;
begin
  select p.user_id,fp.image_url into owner_id,post_image from public.feed_posts fp join public.professional_profiles p on p.id=fp.professional_id where fp.id=new.post_id;
  if owner_id is null or owner_id=new.user_id then return new;end if;
  select coalesce(nullif(username,''),'Someone') into actor_name from public.users where id=new.user_id;
  action_text:=case tg_table_name when 'feed_post_likes' then 'liked your work' when 'feed_post_comments' then 'commented on your work' else 'saved your work' end;
  perform public.notify_user(owner_id,'social',case tg_table_name when 'feed_post_likes' then actor_name||' liked your work' when 'feed_post_comments' then 'New comment on your work' else 'Your work was saved' end,actor_name||' '||action_text||'.','/post/'||new.post_id,jsonb_build_object('postId',new.post_id,'actorId',new.user_id,'event',tg_table_name,'imageUrl',post_image),'professional');
  return new;
end $$;

create or replace function public.notify_professional_follow()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;actor_name text;
begin
  select p.user_id into owner_id from public.professional_profiles p where p.id=new.professional_id;
  if owner_id is null or owner_id=new.user_id then return new;end if;
  select coalesce(nullif(username,''),'Someone') into actor_name from public.users where id=new.user_id;
  perform public.notify_user(owner_id,'social','New follower',actor_name||' followed your studio.','/follower/'||new.user_id,jsonb_build_object('actorId',new.user_id,'event','professional_follow'),'professional');
  return new;
end $$;

create or replace function public.notify_professional_review() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;actor_name text;
begin select p.user_id into owner_id from public.professional_profiles p where p.id=new.professional_id;select coalesce(nullif(username,''),'A client') into actor_name from public.users where id=new.customer_id;if owner_id is not null then perform public.notify_user(owner_id,'review','New client review',actor_name||' left you a '||new.rating||'-star review.','/notifications',jsonb_build_object('reviewId',new.id,'bookingId',new.booking_id,'event','review_created'),'professional');end if;return new;end $$;

-- Booking lifecycle notifications. The retained week11 function is recreated
-- (it has no live trigger after the notification_booking_events migration)
-- so no stored body references the old column.
create or replace function public.week11_booking_notifications()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  professional_user uuid;
  customer_name text;
  became_paid boolean := false;
begin
  select user_id into professional_user
  from public.professional_profiles
  where id=new.professional_id;

  select coalesce(nullif(username,''),'A new client') into customer_name
  from public.users
  where id=new.customer_id;

  became_paid := new.payment_status='paid'
    and (tg_op='INSERT' or old.payment_status is distinct from new.payment_status);

  if became_paid then
    perform public.notify_user(
      professional_user,
      'booking',
      'New booking, lovely! ✨',
      customer_name||' booked '||new.service_name||'.',
      '/calendar',
      jsonb_build_object('bookingId',new.id)
    );
    perform public.notify_user(
      new.customer_id,
      'booking',
      case new.status when 'confirmed' then 'You''re booked, lovely! ✨' else 'Your request is on its way 💕' end,
      case new.status when 'confirmed' then 'Your beauty appointment is officially in the diary.' else 'The professional will confirm your appointment soon.' end,
      '/bookings',
      jsonb_build_object('bookingId',new.id)
    );
  elsif tg_op='UPDATE'
    and new.status is distinct from old.status
    and (new.status<>'confirmed' or new.payment_status='paid') then
    perform public.notify_user(
      new.customer_id,
      'booking',
      case new.status when 'confirmed' then 'You''re booked, lovely! ✨' when 'cancelled' then 'A little booking update' when 'completed' then 'Looking gorgeous? Tell us everything ✨' else 'Your booking has an update' end,
      case new.status when 'cancelled' then 'This appointment was cancelled. Let''s find another perfect time.' when 'completed' then 'Your appointment is complete. Leave a review when you''re ready.' else 'Tap to see the latest details.' end,
      '/bookings',
      jsonb_build_object('bookingId',new.id,'status',new.status)
    );
    perform public.notify_user(
      professional_user,
      'booking',
      'Booking updated',
      customer_name||'''s booking is now '||new.status||'.',
      '/calendar',
      jsonb_build_object('bookingId',new.id,'status',new.status)
    );
  end if;

  return new;
end
$$;

create or replace function public.notification_booking_events() returns trigger language plpgsql security definer set search_path='' as $$
declare pro public.professional_profiles; customer_name text; t public.notification_templates; typ text; begin
 select * into pro from public.professional_profiles where id=new.professional_id;
 select username into customer_name from public.users where id=new.customer_id;
 if (tg_op='INSERT' and new.payment_status='paid') or (tg_op='UPDATE' and new.payment_status='paid' and old.payment_status is distinct from new.payment_status) then
   typ:=case when new.status='confirmed' then 'BOOKING_CONFIRMED' else null end;
   select * into t from public.notification_templates where notification_type='PROFESSIONAL_NEW_BOOKING';
   insert into public.notifications(user_id,kind,title,body,url,data,audience,notification_type,category,reason,reference_id,idempotency_key,user_type)
   values(pro.user_id,'booking',t.title_template,replace(t.body_template,'{{name}}',customer_name),'/calendar',jsonb_build_object('type','PROFESSIONAL_NEW_BOOKING','route','/calendar','bookingId',new.id),'professional','PROFESSIONAL_NEW_BOOKING','transactional','New booking created',new.id::text,'PROFESSIONAL_NEW_BOOKING:'||new.id,'professional') on conflict(idempotency_key) where idempotency_key is not null do nothing;
 elsif new.status is distinct from old.status and new.status='confirmed' then typ:='BOOKING_CONFIRMED';
 elsif new.status is distinct from old.status and new.status='cancelled' then
   select * into t from public.notification_templates where notification_type='PROFESSIONAL_BOOKING_CANCELLED';
   insert into public.notifications(user_id,kind,title,body,url,data,audience,notification_type,category,reason,reference_id,idempotency_key,user_type)
   values(pro.user_id,'booking',t.title_template,replace(t.body_template,'{{name}}',customer_name),'/calendar',jsonb_build_object('type','PROFESSIONAL_BOOKING_CANCELLED','route','/calendar','bookingId',new.id),'professional','PROFESSIONAL_BOOKING_CANCELLED','transactional','Booking cancelled',new.id::text,'PROFESSIONAL_BOOKING_CANCELLED:'||new.id,'professional') on conflict(idempotency_key) where idempotency_key is not null do nothing;
   typ:='BOOKING_CANCELLED';
 end if;
 if typ is not null then
   select * into t from public.notification_templates where notification_type=typ;
   insert into public.notifications(user_id,kind,title,body,url,data,audience,notification_type,category,reason,reference_id,idempotency_key,user_type)
   values(new.customer_id,'booking',t.title_template,replace(replace(t.body_template,'{{name}}',coalesce(pro.display_name,pro.business_name)),'{{time}}',to_char(new.starts_at at time zone 'Africa/Accra','FMDay at FMHH12:MI AM')),'/bookings',jsonb_build_object('type',typ,'route','/bookings','bookingId',new.id),'customer',typ,'transactional','Booking confirmed',new.id::text,typ||':'||new.id,'customer') on conflict(idempotency_key) where idempotency_key is not null do nothing;
 end if; return new;
end $$;

-- Notification scheduler (professional reminders embed the customer username).
create or replace function public.run_notification_scheduler() returns integer
language plpgsql security definer set search_path='' as $$
declare inserted_count integer:=0; affected integer:=0; begin
 -- Customer 24h and 2h reminders.
 insert into public.notifications(user_id,kind,title,body,url,data,audience,notification_type,category,reason,reference_id,idempotency_key,user_type)
 select b.customer_id,'appointment_reminder',t.title_template,
   replace(replace(t.body_template,'{{name}}',coalesce(p.display_name,p.business_name)),'{{time}}',to_char(b.starts_at at time zone 'Africa/Accra','FMHH12:MI AM')),
   '/bookings',jsonb_build_object('type',x.typ,'route','/bookings','bookingId',b.id),'customer',x.typ,'transactional','Upcoming confirmed appointment',b.id::text,x.typ||':'||b.id,'customer'
 from public.bookings b join public.professional_profiles p on p.id=b.professional_id
 cross join lateral (values(case when b.starts_at between now()+interval '23 hours 45 minutes' and now()+interval '24 hours 15 minutes' then 'BOOKING_REMINDER' else 'APPOINTMENT_SOON' end)) x(typ)
 join public.notification_templates t on t.notification_type=x.typ
 where b.status='confirmed' and (b.starts_at between now()+interval '23 hours 45 minutes' and now()+interval '24 hours 15 minutes' or b.starts_at between now()+interval '1 hour 45 minutes' and now()+interval '2 hours 15 minutes')
 on conflict(idempotency_key) where idempotency_key is not null do nothing;
 get diagnostics inserted_count=row_count;

 -- Professional 24h reminder.
 insert into public.notifications(user_id,kind,title,body,url,data,audience,notification_type,category,reason,reference_id,idempotency_key,user_type)
 select p.user_id,'appointment_reminder',t.title_template,replace(replace(t.body_template,'{{name}}',u.username),'{{time}}',to_char(b.starts_at at time zone 'Africa/Accra','FMHH12:MI AM')),
 '/calendar',jsonb_build_object('type','PROFESSIONAL_BOOKING_REMINDER','route','/calendar','bookingId',b.id),'professional','PROFESSIONAL_BOOKING_REMINDER','transactional','Upcoming confirmed appointment',b.id::text,'PROFESSIONAL_BOOKING_REMINDER:'||b.id,'professional'
 from public.bookings b join public.professional_profiles p on p.id=b.professional_id join public.users u on u.id=b.customer_id join public.notification_templates t on t.notification_type='PROFESSIONAL_BOOKING_REMINDER'
 where b.status='confirmed' and b.starts_at between now()+interval '23 hours 45 minutes' and now()+interval '24 hours 15 minutes'
 on conflict(idempotency_key) where idempotency_key is not null do nothing;
 get diagnostics affected=row_count; inserted_count:=inserted_count+affected;

 -- Highest-priority customer marketing candidate.
 with candidates as (
  select b.customer_id user_id,'REBOOKING_REMINDER' typ,'Service interval reached after completed appointment' reason,b.id::text ref,null::text display_name
  from public.bookings b join public.service_reminder_intervals sri on lower(b.service_name) like '%'||sri.service_key||'%'
  where b.status='completed' and b.ends_at+sri.interval_days*interval '1 day'<=now()
    and not exists(select 1 from public.bookings next_booking where next_booking.customer_id=b.customer_id and next_booking.created_at>b.ends_at and lower(next_booking.service_name) like '%'||sri.service_key||'%' and next_booking.status in('requested','confirmed'))
    and public.notification_marketing_allowed(b.customer_id,'beauty_reminders')
  union all
  select f.user_id,'PROFESSIONAL_POST','Followed professional posted new work',fp.professional_id::text||':'||to_char(date_trunc('day',now()),'YYYY-MM-DD'),coalesce(p.display_name,p.business_name)
  from public.professional_follows f join public.professional_profiles p on p.id=f.professional_id join public.user_notification_activity a on a.user_id=f.user_id
  join lateral(select newest.professional_id from public.feed_posts newest where newest.professional_id=f.professional_id and newest.is_published and newest.created_at>coalesce(a.last_customer_feed_viewed_at,a.last_opened_at) order by newest.created_at desc limit 1) fp on true
  where public.notification_marketing_allowed(f.user_id,'professional_updates')
  union all
  select u.id user_id,'CUSTOMER_REENGAGEMENT' typ,'Five days since last app open' reason,to_char(date_trunc('day',now()),'YYYY-MM-DD') ref,null::text
  from public.users u join public.user_notification_activity a on a.user_id=u.id
  where u.role='customer' and a.last_opened_at<=now()-interval '5 days' and a.customer_reengagement_sent_at is null and public.notification_marketing_allowed(u.id,'reengagement')
  union all
  select f.user_id,'NEW_FEED_CONTENT','New posts from followed professionals',to_char(date_trunc('day',now()),'YYYY-MM-DD'),null::text
  from public.professional_follows f join public.user_notification_activity a on a.user_id=f.user_id
  where exists(select 1 from public.feed_posts fp where fp.professional_id=f.professional_id and fp.is_published and fp.created_at>coalesce(a.last_customer_feed_viewed_at,a.last_opened_at)) and public.notification_marketing_allowed(f.user_id,'feed_updates')
 ), chosen as (select distinct on(user_id) c.*,t.* from candidates c join public.notification_templates t on t.notification_type=c.typ order by user_id,t.priority desc)
 insert into public.notifications(user_id,kind,title,body,url,data,audience,notification_type,category,reason,reference_id,idempotency_key,user_type,queued_for)
 select user_id,'promotion',replace(title_template,'{{name}}',coalesce(display_name,'Sheree')),body_template,case when typ='REBOOKING_REMINDER' then '/explore' else '/' end,jsonb_build_object('type',typ,'route',case when typ='REBOOKING_REMINDER' then '/explore' else '/' end),'customer',typ,'marketing',reason,ref,typ||':'||user_id||':'||ref,'customer',case when localtime>=time '22:00' then date_trunc('day',now())+interval '1 day 8 hours' when localtime<time '08:00' then date_trunc('day',now())+interval '8 hours' else now() end from chosen
 on conflict(idempotency_key) where idempotency_key is not null do nothing;
 get diagnostics affected=row_count; inserted_count:=inserted_count+affected;
 update public.user_notification_activity a set customer_reengagement_sent_at=now(),updated_at=now()
 where customer_reengagement_sent_at is null and exists(select 1 from public.notifications n where n.user_id=a.user_id and n.notification_type='CUSTOMER_REENGAGEMENT');

 -- Professional reminders (one highest-priority candidate).
 with candidates as (
  select p.user_id,'PROFESSIONAL_AVAILABILITY_REMINDER' typ,'No usable working hours configured' reason,to_char(date_trunc('week',now()),'IYYY-IW') ref
  from public.professional_profiles p join public.users u on u.id=p.user_id where p.onboarding_completed_at is not null and not exists(select 1 from public.professional_working_hours h where h.professional_id=p.id and not h.is_closed) and public.notification_marketing_allowed(p.user_id,'business_reminders')
  union all
  select p.user_id,'PROFESSIONAL_PORTFOLIO_REMINDER','No portfolio post for seven days',to_char(floor(extract(epoch from now())/604800),'FM999999999')
  from public.professional_profiles p where p.onboarding_completed_at is not null and coalesce((select max(created_at) from public.feed_posts fp where fp.professional_id=p.id),p.created_at)<=now()-interval '7 days' and public.notification_marketing_allowed(p.user_id,'portfolio_reminders')
  union all
  select p.user_id,'PROFESSIONAL_PROFILE_REMINDER','Professional profile has required fields missing',to_char(date_trunc('week',now()),'IYYY-IW')
  from public.professional_profiles p where p.onboarding_completed_at is not null and (nullif(trim(p.bio),'') is null or p.profile_photo_url is null or nullif(trim(p.location),'') is null) and public.notification_marketing_allowed(p.user_id,'business_reminders')
  union all
  select p.user_id,'PROFESSIONAL_REENGAGEMENT','Five days since last app open',to_char(date_trunc('day',now()),'YYYY-MM-DD')
  from public.professional_profiles p join public.user_notification_activity a on a.user_id=p.user_id where a.last_opened_at<=now()-interval '5 days' and a.professional_reengagement_sent_at is null and public.notification_marketing_allowed(p.user_id,'reengagement')
 ), chosen as (select distinct on(user_id) c.*,t.* from candidates c join public.notification_templates t on t.notification_type=c.typ order by user_id,t.priority desc)
 insert into public.notifications(user_id,kind,title,body,url,data,audience,notification_type,category,reason,reference_id,idempotency_key,user_type,queued_for)
 select user_id,'promotion',title_template,body_template,case typ when 'PROFESSIONAL_AVAILABILITY_REMINDER' then '/calendar' when 'PROFESSIONAL_PORTFOLIO_REMINDER' then '/upload' when 'PROFESSIONAL_PROFILE_REMINDER' then '/profile' else '/' end,
 jsonb_build_object('type',typ,'route',case typ when 'PROFESSIONAL_AVAILABILITY_REMINDER' then '/calendar' when 'PROFESSIONAL_PORTFOLIO_REMINDER' then '/upload' when 'PROFESSIONAL_PROFILE_REMINDER' then '/profile' else '/' end),'professional',typ,'marketing',reason,ref,typ||':'||user_id||':'||ref,'professional',case when localtime>=time '22:00' then date_trunc('day',now())+interval '1 day 8 hours' when localtime<time '08:00' then date_trunc('day',now())+interval '8 hours' else now() end from chosen
 on conflict(idempotency_key) where idempotency_key is not null do nothing;
 get diagnostics affected=row_count; inserted_count:=inserted_count+affected;
 update public.user_notification_activity a set professional_reengagement_sent_at=now(),updated_at=now()
 where professional_reengagement_sent_at is null and exists(select 1 from public.notifications n where n.user_id=a.user_id and n.notification_type='PROFESSIONAL_REENGAGEMENT');
 return inserted_count;
end $$;
revoke all on function public.run_notification_scheduler() from public,anon,authenticated;

-- Professional dashboard and booking requests.
create or replace function public.get_professional_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pid uuid;
  result jsonb;
begin
  select id into pid
  from public.professional_profiles
  where user_id = auth.uid();

  if pid is null then
    raise exception 'Professional profile required';
  end if;

  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'name', coalesce(p.display_name, p.business_name),
        'business_name', p.business_name,
        'avatar_url', p.profile_photo_url
      )
      from public.professional_profiles p
      where p.id = pid
    ),
    'today_count', (
      select count(*)
      from public.bookings b
      where b.professional_id = pid
        and b.customer_id <> auth.uid()
        and b.starts_at::date = current_date
        and b.status in ('requested', 'confirmed')
    ),
    'upcoming_count', (
      select count(*)
      from public.bookings b
      where b.professional_id = pid
        and b.customer_id <> auth.uid()
        and b.starts_at >= now()
        and b.status in ('requested', 'confirmed')
    ),
    'pending_count', (
      select count(*)
      from public.bookings b
      where b.professional_id = pid
        and b.customer_id <> auth.uid()
        and b.starts_at >= now()
        and b.status = 'requested'
    ),
    'month_revenue', (
      select coalesce(sum(b.price), 0)
      from public.bookings b
      where b.professional_id = pid
        and b.customer_id <> auth.uid()
        and b.status = 'completed'
        and date_trunc('month', b.ends_at) = date_trunc('month', now())
    ),
    'today', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'booking_reference', b.booking_reference,
        'customer_name', u.username,
        'customer_avatar', u.avatar_url,
        'service_name', b.service_name,
        'starts_at', b.starts_at,
        'ends_at', b.ends_at,
        'status', b.status,
        'payment_status', b.payment_status,
        'price', b.price,
        'deposit_amount', b.deposit_amount
      ) order by b.starts_at)
      from public.bookings b
      join public.users u on u.id = b.customer_id
      where b.professional_id = pid
        and b.customer_id <> auth.uid()
        and b.starts_at::date = current_date
        and b.status in ('requested', 'confirmed')
    ), '[]'::jsonb),
    'next_booking', (
      select jsonb_build_object(
        'id', b.id,
        'booking_reference', b.booking_reference,
        'customer_name', u.username,
        'customer_avatar', u.avatar_url,
        'service_name', b.service_name,
        'starts_at', b.starts_at,
        'ends_at', b.ends_at,
        'status', b.status,
        'payment_status', b.payment_status,
        'price', b.price,
        'deposit_amount', b.deposit_amount
      )
      from public.bookings b
      join public.users u on u.id = b.customer_id
      where b.professional_id = pid
        and b.customer_id <> auth.uid()
        and b.starts_at >= now()
        and b.status in ('requested', 'confirmed')
      order by b.starts_at
      limit 1
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_professional_dashboard() from public;
grant execute on function public.get_professional_dashboard() to authenticated;

create or replace function public.get_professional_booking_requests() returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'booking_reference',b.booking_reference,'customer_name',u.username,'service_name',b.service_name,'starts_at',b.starts_at,'deposit_amount',b.deposit_amount,'payment_status',b.payment_status) order by b.starts_at),'[]'::jsonb)
from public.bookings b join public.users u on u.id=b.customer_id join public.professional_profiles p on p.id=b.professional_id
where p.user_id=auth.uid() and b.customer_id<>auth.uid() and b.status='requested' and b.starts_at>=now();
$$;
revoke all on function public.get_professional_booking_requests() from public;
grant execute on function public.get_professional_booking_requests() to authenticated;

-- Feed comment authors.
create or replace function public.get_post_comments(post_id_value uuid)
returns table(
  id uuid,
  post_id uuid,
  user_id uuid,
  body text,
  created_at timestamptz,
  author_name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    comment.id,
    comment.post_id,
    comment.user_id,
    comment.body,
    comment.created_at,
    member.username,
    member.avatar_url
  from public.feed_post_comments comment
  join public.feed_posts post on post.id = comment.post_id
  join public.users member on member.id = comment.user_id
  where comment.post_id = post_id_value
    and post.is_published
  order by comment.created_at;
$$;

revoke all on function public.get_post_comments(uuid) from public;
grant execute on function public.get_post_comments(uuid) to anon, authenticated;

create or replace function public.get_post_comments_page(
  post_id_value uuid,cursor_created_at timestamptz default null,cursor_id uuid default null,page_size integer default 30
) returns table(id uuid,post_id uuid,user_id uuid,body text,created_at timestamptz,author_name text,avatar_url text)
language sql stable security definer set search_path='' as $$
select c.id,c.post_id,c.user_id,c.body,c.created_at,coalesce(nullif(u.username,''),'Sheree member'),u.avatar_url
from public.feed_post_comments c join public.users u on u.id=c.user_id
where c.post_id=post_id_value and (
  cursor_created_at is null or (c.created_at,c.id)<(cursor_created_at,cursor_id)
)
order by c.created_at desc,c.id desc
limit least(greatest(page_size,1),50)
$$;
revoke all on function public.get_post_comments_page(uuid,timestamptz,uuid,integer) from public;
grant execute on function public.get_post_comments_page(uuid,timestamptz,uuid,integer) to anon,authenticated;

-- Public creator profile (review authors use the customer username).
create or replace function public.get_creator_profile(profile_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object(
  'id',p.id,'name',coalesce(p.display_name,p.business_name),'business_name',p.business_name,
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
) from public.professional_profiles p where p.id=profile_id;
$$;
revoke all on function public.get_creator_profile(uuid) from public;
grant execute on function public.get_creator_profile(uuid) to anon,authenticated;

-- Notification deep link follower identity.
create or replace function public.get_notification_follower(follower_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'id', u.id,
    'name', coalesce(nullif(u.username,''),'Sheree member'),
    'avatar_url', u.avatar_url,
    'professional_profile_id', pp.id
  )
  from public.users u
  left join public.professional_profiles pp on pp.user_id=u.id
  where u.id=follower_user_id
    and exists(
      select 1
      from public.professional_follows f
      join public.professional_profiles followed on followed.id=f.professional_id
      where f.user_id=u.id and followed.user_id=(select auth.uid())
    );
$$;
revoke all on function public.get_notification_follower(uuid) from public,anon;
grant execute on function public.get_notification_follower(uuid) to authenticated;

-- Admin: customers.
create or replace function public.get_admin_customers(
  search_query text default '', status_filter text default 'all',
  activity_filter text default 'all', page_number integer default 1, page_size integer default 20
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  query text:=trim(coalesce(search_query,'')); requested_status text:=lower(coalesce(status_filter,'all'));
  requested_activity text:=lower(coalesce(activity_filter,'all')); page integer:=greatest(coalesce(page_number,1),1);
  size integer:=least(greatest(coalesce(page_size,20),1),5000);
begin
  if not public.admin_has_permission('users.read') then raise exception 'User directory access required' using errcode='42501'; end if;
  return (
    with directory as (
      select u.id,u.username name,u.avatar_url,u.phone,u.account_status::text status,u.created_at,
        u.onboarding_completed_at,coalesce(b.booking_count,0) booking_count,coalesce(b.completed_count,0) completed_count,
        coalesce(p.total_spend,0) total_spend,coalesce(p.refunded,0) refunded,
        coalesce(r.report_count,0) report_count,coalesce(w.warning_count,0) warning_count,
        greatest(coalesce(b.last_booking_at,u.created_at),coalesce(p.last_payment_at,u.created_at)) last_active_at
      from public.users u
      left join lateral (select count(*) booking_count,count(*) filter(where status='completed') completed_count,max(created_at) last_booking_at from public.bookings where customer_id=u.id) b on true
      left join lateral (select coalesce(sum(amount) filter(where status='paid'),0) total_spend,coalesce(sum(amount) filter(where status='refunded'),0) refunded,max(created_at) last_payment_at from public.payments where customer_id=u.id) p on true
      left join lateral (select count(*) report_count from public.customer_reports where customer_id=u.id) r on true
      left join lateral (select count(*) warning_count from public.customer_warnings where customer_id=u.id) w on true
      where u.role='customer'
    ), filtered as (
      select * from directory d where
        (query='' or d.name ilike '%'||query||'%' or coalesce(d.phone,'') ilike '%'||query||'%' or d.id::text ilike query||'%')
        and (requested_status='all' or d.status=requested_status)
        and (requested_activity='all' or (requested_activity='booked' and d.booking_count>0)
          or (requested_activity='never_booked' and d.booking_count=0) or (requested_activity='reported' and d.report_count>0))
    )
    select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from
      (select * from filtered order by created_at desc limit size offset (page-1)*size)x),'[]'::jsonb),
      'total',(select count(*) from filtered),'page',page,'page_size',size)
  );
end $$;
create or replace function public.get_admin_customer(customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.admin_has_permission('users.read') then raise exception 'User directory access required' using errcode='42501'; end if;

  return (select jsonb_build_object(
    'id',u.id,'name',u.username,'avatar_url',u.avatar_url,'phone',u.phone,'status',u.account_status,
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
      select r.id,r.reason,r.status,r.created_at,reporter.username reporter_name
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
create or replace function public.admin_customer_action(customer_id uuid, action_name text, reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target record; clean_reason text:=trim(coalesce(reason,'')); action text:=lower(trim(action_name));
begin
  if not public.admin_has_permission('users.manage') then raise exception 'User management access required' using errcode='42501'; end if;
  if char_length(clean_reason)<5 then raise exception 'A reason of at least 5 characters is required'; end if;
  if action not in ('block','unblock','warn') then raise exception 'Unsupported customer action'; end if;
  select id,username,account_status::text old_status into target from public.users where id=customer_id and role='customer' for update;
  if not found then raise exception 'Customer not found' using errcode='P0002'; end if;
  if action='block' then
    if target.old_status='blocked' then raise exception 'Customer is already blocked'; end if;
    update public.users set account_status='blocked'::public.account_status,blocked_at=now(),block_reason=clean_reason where id=customer_id;
  elsif action='unblock' then
    if target.old_status<>'blocked' then raise exception 'Customer is not blocked'; end if;
    update public.users set account_status='active'::public.account_status,blocked_at=null,block_reason=null where id=customer_id;
  else
    insert into public.customer_warnings(customer_id,issued_by,reason) values(customer_id,(select auth.uid()),clean_reason);
    perform public.notify_user(customer_id,'message','A message from Sheree','Your account has received a warning: '||clean_reason,'/notifications',jsonb_build_object('event','admin_warning'),'customer');
  end if;
  insert into public.admin_audit_logs(actor_id,action,resource_type,resource_id,summary,metadata)
  values((select auth.uid()),'customer.'||action,'customer',customer_id,initcap(action)||' customer '||target.username,
    jsonb_build_object('reason',clean_reason,'previous_status',target.old_status));
  return jsonb_build_object('id',customer_id,'action',action);
end $$;
revoke all on function public.get_admin_customers(text,text,text,integer,integer),
  public.get_admin_customer(uuid),public.admin_customer_action(uuid,text,text) from public,anon;
grant execute on function public.get_admin_customers(text,text,text,integer,integer),
  public.get_admin_customer(uuid),public.admin_customer_action(uuid,text,text) to authenticated;

-- Admin: bookings.
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
        customer.id customer_id,customer.username customer_name,customer.avatar_url customer_avatar,
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
    'customer',jsonb_build_object('id',cu.id,'name',cu.username,'avatar_url',cu.avatar_url,'phone',cu.phone,'status',cu.account_status),
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

-- Admin: disputes.
create or replace function public.get_admin_disputes(search_query text default'',status_filter text default'all',page_number integer default 1,page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare query text:=trim(coalesce(search_query,''));requested text:=lower(coalesce(status_filter,'all'));page integer:=greatest(page_number,1);size integer:=least(greatest(page_size,1),100);
begin
 if not public.admin_has_permission('support.manage') then raise exception 'Support access required' using errcode='42501';end if;
 return(with directory as(select d.id,d.subject,d.category,d.status,d.created_at,d.updated_at,b.id booking_id,b.booking_reference,b.service_name,b.starts_at,
 cu.username customer_name,coalesce(pp.display_name,pp.business_name) professional_name,
 coalesce((select sum(dr.amount) from public.dispute_refunds dr where dr.dispute_id=d.id and dr.status not in('denied','failed')),0) refund_amount,
 (select count(*) from public.dispute_notes n where n.dispute_id=d.id) note_count
 from public.disputes d join public.bookings b on b.id=d.booking_id join public.users cu on cu.id=b.customer_id join public.professional_profiles pp on pp.id=b.professional_id),
 filtered as(select*from directory x where(requested='all'or x.status=requested)and(query=''or x.subject ilike'%'||query||'%'or coalesce(x.booking_reference,'')ilike'%'||query||'%'or x.customer_name ilike'%'||query||'%'or x.professional_name ilike'%'||query||'%'))
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at desc)from(select*from filtered order by created_at desc limit size offset(page-1)*size)x),'[]'::jsonb),'total',(select count(*)from filtered),'page',page,'page_size',size,
 'counts',jsonb_build_object('open',(select count(*)from directory where status='open'),'investigating',(select count(*)from directory where status='investigating'),'resolved',(select count(*)from directory where status='resolved'))) );
end $$;
create or replace function public.get_admin_dispute(dispute_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.admin_has_permission('support.manage') then raise exception 'Support access required' using errcode='42501';end if;
 return(select jsonb_build_object('id',d.id,'subject',d.subject,'description',d.description,'category',d.category,'status',d.status,'resolution',d.resolution,'created_at',d.created_at,'updated_at',d.updated_at,
 'booking',jsonb_build_object('id',b.id,'reference',b.booking_reference,'service_name',b.service_name,'starts_at',b.starts_at,'ends_at',b.ends_at,'status',b.status,'payment_status',b.payment_status,'price',b.price,'deposit_amount',b.deposit_amount),
 'customer',jsonb_build_object('id',cu.id,'name',cu.username,'phone',cu.phone,'avatar_url',cu.avatar_url),
 'professional',jsonb_build_object('id',pp.id,'name',coalesce(pp.display_name,pp.business_name),'phone',pu.phone,'avatar_url',pp.profile_photo_url),
 'payments',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at desc)from(select p.id,p.provider_reference,p.amount,p.currency,p.status,p.channel,p.created_at from public.payments p where p.booking_id=b.id order by p.created_at desc)x),'[]'::jsonb),
 'notes',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at)from(select n.id,n.body,n.created_at,au.display_name author_name from public.dispute_notes n join public.admin_users au on au.user_id=n.author_id where n.dispute_id=d.id order by n.created_at)x),'[]'::jsonb),
 'refunds',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at desc)from(select r.id,r.payment_id,r.amount,r.currency,r.status,r.reason,r.provider_refund_id,r.created_at,r.decided_at,au.display_name decided_by_name from public.dispute_refunds r left join public.admin_users au on au.user_id=r.decided_by where r.dispute_id=d.id order by r.created_at desc)x),'[]'::jsonb)
 )from public.disputes d join public.bookings b on b.id=d.booking_id join public.users cu on cu.id=b.customer_id join public.professional_profiles pp on pp.id=b.professional_id join public.users pu on pu.id=pp.user_id where d.id=dispute_id);
end $$;
revoke all on function public.get_admin_disputes(text,text,integer,integer),public.get_admin_dispute(uuid),public.admin_update_dispute(uuid,text,text),public.admin_add_dispute_note(uuid,text),public.admin_deny_dispute_refund(uuid,text),public.submit_booking_dispute(uuid,text,text,text,numeric)from public,anon;
grant execute on function public.get_admin_disputes(text,text,integer,integer),public.get_admin_dispute(uuid),public.admin_update_dispute(uuid,text,text),public.admin_add_dispute_note(uuid,text),public.admin_deny_dispute_refund(uuid,text)to authenticated;
grant execute on function public.submit_booking_dispute(uuid,text,text,text,numeric)to authenticated;

-- Admin: finance.
create or replace function public.get_admin_transactions(search_query text default'',status_filter text default'all',date_from timestamptz default null,date_to timestamptz default null,page_number integer default 1,page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare query text:=trim(coalesce(search_query,''));requested text:=lower(coalesce(status_filter,'all'));page integer:=greatest(page_number,1);size integer:=least(greatest(page_size,1),5000);
begin
 if not public.admin_has_permission('payments.read')then raise exception'Payment access required'using errcode='42501';end if;
 return(with ledger as(select p.id,p.provider_reference,p.amount,p.currency,p.status::text status,p.channel,p.gateway_response,p.created_at,p.paid_at,
  coalesce(nullif(p.provider_payload->'data'->>'fees','')::numeric,0)/100 processing_fee,b.id booking_id,b.booking_reference,b.service_name,
  cu.username customer_name,coalesce(pp.display_name,pp.business_name)professional_name
  from public.payments p join public.bookings b on b.id=p.booking_id join public.users cu on cu.id=p.customer_id join public.professional_profiles pp on pp.id=b.professional_id),
 filtered as(select*from ledger x where(requested='all'or x.status=requested)and(date_from is null or x.created_at>=date_from)and(date_to is null or x.created_at<date_to)and(query=''or x.provider_reference ilike'%'||query||'%'or coalesce(x.booking_reference,'')ilike'%'||query||'%'or x.customer_name ilike'%'||query||'%'or x.professional_name ilike'%'||query||'%'))
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at desc)from(select*from filtered order by created_at desc limit size offset(page-1)*size)x),'[]'::jsonb),'total',(select count(*)from filtered),'page',page,'page_size',size));
end $$;
create or replace function public.get_admin_refunds(search_query text default'',status_filter text default'all',page_number integer default 1,page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare query text:=trim(coalesce(search_query,''));requested text:=lower(coalesce(status_filter,'all'));page integer:=greatest(page_number,1);size integer:=least(greatest(page_size,1),5000);
begin
 if not public.admin_has_permission('payments.read')then raise exception'Payment access required'using errcode='42501';end if;
 return(with ledger as(
  select dr.id,'dispute'::text source,dr.amount,dr.currency,dr.status,dr.reason,dr.provider_refund_id,dr.created_at,dr.updated_at,
   p.provider_reference transaction_reference,b.id booking_id,b.booking_reference,b.service_name,cu.username customer_name,d.id dispute_id
  from public.dispute_refunds dr join public.payments p on p.id=dr.payment_id join public.bookings b on b.id=p.booking_id join public.users cu on cu.id=b.customer_id join public.disputes d on d.id=dr.dispute_id
  union all
  select s.booking_id,'cancellation',s.refund_amount,'GHS',s.refund_status,coalesce(b.cancellation_reason,'Booking cancellation'),s.provider_refund_id,s.created_at,s.updated_at,
   p.provider_reference,b.id,b.booking_reference,b.service_name,cu.username,null::uuid
  from public.booking_cancellation_settlements s join public.bookings b on b.id=s.booking_id join public.users cu on cu.id=b.customer_id left join lateral(select provider_reference from public.payments where booking_id=b.id order by created_at desc limit 1)p on true),
 filtered as(select*from ledger x where(requested='all'or x.status=requested)and(query=''or coalesce(x.provider_refund_id,'')ilike'%'||query||'%'or coalesce(x.transaction_reference,'')ilike'%'||query||'%'or coalesce(x.booking_reference,'')ilike'%'||query||'%'or x.customer_name ilike'%'||query||'%'))
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at desc)from(select*from filtered order by created_at desc limit size offset(page-1)*size)x),'[]'::jsonb),'total',(select count(*)from filtered),'page',page,'page_size',size));
end $$;
revoke all on function public.get_admin_finance_overview(integer),public.get_admin_transactions(text,text,timestamptz,timestamptz,integer,integer),public.get_admin_payouts(text,text,integer,integer),public.get_admin_refunds(text,text,integer,integer),public.get_admin_professional_balances(text,integer,integer)from public,anon;
grant execute on function public.get_admin_finance_overview(integer),public.get_admin_transactions(text,text,timestamptz,timestamptz,integer,integer),public.get_admin_payouts(text,text,integer,integer),public.get_admin_refunds(text,text,integer,integer),public.get_admin_professional_balances(text,integer,integer)to authenticated;

-- Admin: beautician detail (recent bookings/reviews carry the customer username).
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
    where p.id=beautician_id
  );
end;
$$;

-- Admin: reviews + support.
create or replace function public.get_admin_reviews(queue_filter text default 'flagged')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.admin_has_permission('reviews.manage') then
    raise exception 'Reviews access required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,'rating',r.rating,'body',r.body,'status',r.moderation_status,
        'flag_reason',r.flag_reason,'response',r.professional_response,'created_at',r.created_at,
        'customer',u.username,'professional',coalesce(p.display_name,p.business_name),
        'professional_id',p.id,'flags',(select count(*) from public.review_flags f where f.review_id=r.id and f.status='open')
      ) order by r.created_at desc)
      from public.reviews r
      join public.users u on u.id=r.customer_id
      join public.professional_profiles p on p.id=r.professional_id
      where queue_filter='all'
         or (queue_filter='flagged' and (r.moderation_status='flagged' or exists(select 1 from public.review_flags f where f.review_id=r.id and f.status='open')))
         or (queue_filter='removed' and r.moderation_status='removed')
         or (queue_filter='responses' and r.professional_response is not null)
    ),'[]'::jsonb),
    'low_rated', coalesce((
      select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'rating',x.rating,'reviews',x.reviews))
      from (
        select p.id,coalesce(p.display_name,p.business_name) name,round(avg(r.rating),2) rating,count(*) reviews
        from public.reviews r join public.professional_profiles p on p.id=r.professional_id
        where r.moderation_status='published'
        group by p.id,p.display_name,p.business_name having count(*) >= 2 and avg(r.rating) < 3.5
        order by avg(r.rating),count(*) desc limit 20
      ) x
    ),'[]'::jsonb),
    'average_rating',(select coalesce(round(avg(rating),2),0) from public.reviews where moderation_status='published'),
    'flagged_count',(select count(*) from public.reviews r where r.moderation_status='flagged' or exists(select 1 from public.review_flags f where f.review_id=r.id and f.status='open'))
  ) into result;
  return result;
end;
$$;

create or replace function public.get_admin_support()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.admin_has_permission('support.manage') then raise exception 'Support access required' using errcode='42501'; end if;
  select jsonb_build_object(
    'tickets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.id,'number',t.ticket_number,'subject',t.subject,'description',t.description,'kind',t.kind,
      'status',t.status,'priority',t.priority,'requester',u.username,'escalated_at',t.escalated_at,
      'updated_at',t.updated_at,'message_count',(select count(*) from public.support_messages m where m.ticket_id=t.id)
    ) order by t.updated_at desc) from public.support_tickets t join public.users u on u.id=t.requester_id),'[]'::jsonb),
    'open',(select count(*) from public.support_tickets where status in ('open','in_progress','waiting')),
    'urgent',(select count(*) from public.support_tickets where priority='urgent' and status not in ('resolved','closed')),
    'escalated',(select count(*) from public.support_tickets where escalated_at is not null and status not in ('resolved','closed'))
  ) into result;
  return result;
end;
$$;
create or replace function public.get_admin_support_ticket(target_ticket_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.admin_has_permission('support.manage') then raise exception 'Support access required' using errcode='42501'; end if;
  select jsonb_build_object(
    'ticket',to_jsonb(t),
    'requester',jsonb_build_object('id',u.id,'name',u.username,'phone',u.phone),
    'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'body',m.body,'internal',m.internal,'created_at',m.created_at,'author_id',m.author_id) order by m.created_at) from public.support_messages m where m.ticket_id=t.id),'[]'::jsonb)
  ) into result from public.support_tickets t join public.users u on u.id=t.requester_id where t.id=target_ticket_id;
  return result;
end;
$$;

-- Admin: global search + analytics.
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
          u.id::text id, u.username title,
          coalesce(u.phone, u.role::text) subtitle,
          case when u.onboarding_completed_at is null then 'onboarding' else 'active' end status,
          case when u.role='professional' then '/beauticians' else '/customers' end href,
          1 rank_order
        from public.users u
        where u.username ilike '%' || query || '%'
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
revoke all on function public.track_analytics_event(text,uuid,uuid,uuid,jsonb),public.get_admin_analytics(integer) from public,anon;
grant execute on function public.track_analytics_event(text,uuid,uuid,uuid,jsonb) to authenticated;
grant execute on function public.get_admin_analytics(integer) to authenticated;
