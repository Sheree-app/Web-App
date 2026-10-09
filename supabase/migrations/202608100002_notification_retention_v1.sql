-- Sheree V1 notification and retention foundation.
-- Eligibility is deterministic; delivery is performed by the notification-worker edge function.

alter table public.push_tokens
  rename column last_seen_at to last_used_at;
alter table public.push_tokens add column if not exists device_id text;
alter table public.push_tokens add column if not exists updated_at timestamptz not null default now();
create unique index if not exists push_tokens_device_idx
  on public.push_tokens(user_id,device_id) where device_id is not null;

alter table public.notification_preferences
  add column if not exists booking_reminders boolean not null default true,
  add column if not exists beauty_reminders boolean not null default true,
  add column if not exists feed_updates boolean not null default true,
  add column if not exists professional_updates boolean not null default true,
  add column if not exists reengagement boolean not null default true,
  add column if not exists marketing boolean not null default true,
  add column if not exists booking_updates boolean not null default true,
  add column if not exists portfolio_reminders boolean not null default true,
  add column if not exists feed_engagement boolean not null default true,
  add column if not exists business_reminders boolean not null default true;

alter table public.notifications
  add column if not exists notification_type text,
  add column if not exists category text not null default 'transactional',
  add column if not exists reason text,
  add column if not exists reference_id text,
  add column if not exists idempotency_key text,
  add column if not exists queued_for timestamptz not null default now(),
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists user_type text check(user_type in ('customer','professional')),
  add column if not exists expo_ticket_ids jsonb not null default '[]'::jsonb,
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists last_delivery_attempt_at timestamptz;
create unique index if not exists notifications_idempotency_idx on public.notifications(idempotency_key) where idempotency_key is not null;
create index if not exists notifications_delivery_queue_idx on public.notifications(queued_for,created_at) where push_sent_at is null;

-- Compatibility: old installations use push_sent_at as sent_at.
alter table public.notifications add column if not exists sent_at timestamptz;
create index if not exists notifications_marketing_cap_idx on public.notifications(user_id,sent_at) where category='marketing';

create table if not exists public.user_notification_activity(
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_opened_at timestamptz not null default now(),
  last_customer_feed_viewed_at timestamptz,
  customer_reengagement_sent_at timestamptz,
  professional_reengagement_sent_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.user_notification_activity enable row level security;
create policy "users read own notification activity" on public.user_notification_activity for select to authenticated using(user_id=(select auth.uid()));

create table if not exists public.service_reminder_intervals(
  service_key text primary key,
  interval_days integer not null check(interval_days between 1 and 365)
);
insert into public.service_reminder_intervals(service_key,interval_days) values
 ('nails',21),('lashes',21),('brows',21),('braids',35),('hair',35),('locs',42)
on conflict(service_key) do update set interval_days=excluded.interval_days;

create table if not exists public.notification_templates(
  notification_type text primary key,
  title_template text not null,
  body_template text not null,
  category text not null check(category in ('transactional','marketing')),
  preference_key text,
  priority integer not null
);
insert into public.notification_templates values
 ('BOOKING_CONFIRMED','💗 You''re booked!','Your appointment with {{name}} is confirmed for {{time}}.','transactional','booking_reminders',100),
 ('BOOKING_REMINDER','✨ Tomorrow''s your beauty day','Your appointment with {{name}} is tomorrow at {{time}}.','transactional','booking_reminders',95),
 ('APPOINTMENT_SOON','Almost time 💅','Your appointment with {{name}} starts in 2 hours.','transactional','booking_reminders',94),
 ('BOOKING_CANCELLED','A little booking update','Your appointment with {{name}} has been cancelled.','transactional','booking_reminders',100),
 ('REBOOKING_REMINDER','Your next beauty day might be calling 💗','It''s been a little while since your last appointment. Find your next look on Sheree.','marketing','beauty_reminders',90),
 ('PROFESSIONAL_POST','{{name}} has been busy 👀','See the latest looks on Sheree.','marketing','professional_updates',80),
 ('NEW_FEED_CONTENT','Your Sheree feed has been busy 👀','New looks from the beauty professionals you follow.','marketing','feed_updates',70),
 ('CUSTOMER_REENGAGEMENT','It''s been a little minute 💗','Come see what''s new on Sheree.','marketing','reengagement',60),
 ('PROFESSIONAL_NEW_BOOKING','💗 New booking!','You have a new appointment from {{name}}.','transactional','booking_updates',100),
 ('PROFESSIONAL_BOOKING_CANCELLED','Booking cancelled','Your appointment with {{name}} has been cancelled.','transactional','booking_updates',100),
 ('PROFESSIONAL_BOOKING_REMINDER','Tomorrow''s appointment ✨','You have an appointment with {{name}} tomorrow at {{time}}.','transactional','booking_updates',95),
 ('PROFESSIONAL_AVAILABILITY_REMINDER','Your calendar is looking a little quiet 👀','Add your availability so clients know when they can book you.','marketing','business_reminders',90),
 ('PROFESSIONAL_PORTFOLIO_REMINDER','Your portfolio could use a little update ✨','Show your latest work and let your next client find you.','marketing','portfolio_reminders',80),
 ('PROFESSIONAL_PROFILE_REMINDER','You''re almost ready ✨','Complete your profile so clients can discover your work.','marketing','business_reminders',70),
 ('PROFESSIONAL_REENGAGEMENT','Your beauty space has been quiet 👀','Come see what''s happening on Sheree.','marketing','reengagement',60)
on conflict(notification_type) do update set title_template=excluded.title_template,body_template=excluded.body_template,category=excluded.category,preference_key=excluded.preference_key,priority=excluded.priority;

create or replace function public.record_app_open(active_mode text default 'customer') returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then return; end if;
  insert into public.user_notification_activity(user_id,last_opened_at,last_customer_feed_viewed_at,customer_reengagement_sent_at,professional_reengagement_sent_at)
  values(uid,now(),case when active_mode='customer' then now() end,null,null)
  on conflict(user_id) do update set
    last_opened_at=now(),
    last_customer_feed_viewed_at=case when active_mode='customer' then now() else public.user_notification_activity.last_customer_feed_viewed_at end,
    customer_reengagement_sent_at=case when active_mode='customer' then null else public.user_notification_activity.customer_reengagement_sent_at end,
    professional_reengagement_sent_at=case when active_mode='professional' then null else public.user_notification_activity.professional_reengagement_sent_at end,
    updated_at=now();
end $$;
grant execute on function public.record_app_open(text) to authenticated;

create or replace function public.mark_notification_opened(notification_id uuid) returns void
language sql security definer set search_path='' as $$
 update public.notifications set opened_at=coalesce(opened_at,now()),read_at=coalesce(read_at,now())
 where id=notification_id and user_id=(select auth.uid())
$$;
grant execute on function public.mark_notification_opened(uuid) to authenticated;

create or replace function public.notification_marketing_allowed(uid uuid, pref text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare p public.notification_preferences; begin
 select * into p from public.notification_preferences where user_id=uid;
 if found then
   if not p.push_enabled or not p.marketing then
     return false;
   end if;
   if (case pref
     when 'beauty_reminders' then not p.beauty_reminders
     when 'feed_updates' then not p.feed_updates
     when 'professional_updates' then not p.professional_updates
     when 'portfolio_reminders' then not p.portfolio_reminders
     when 'business_reminders' then not p.business_reminders
     when 'reengagement' then not p.reengagement
     else false
   end) then
     return false;
   end if;
 end if;
 return not exists(select 1 from public.notifications n where n.user_id=uid and n.category='marketing' and coalesce(n.sent_at,n.push_sent_at,n.created_at)>now()-interval '1 day')
   and (select count(*) from public.notifications n where n.user_id=uid and n.category='marketing' and coalesce(n.sent_at,n.push_sent_at,n.created_at)>now()-interval '7 days')<3;
end $$;

-- Inserts at most one marketing candidate per user/run, plus due transactional reminders.
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
 select p.user_id,'appointment_reminder',t.title_template,replace(replace(t.body_template,'{{name}}',u.full_name),'{{time}}',to_char(b.starts_at at time zone 'Africa/Accra','FMHH12:MI AM')),
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

-- Booking creation/status events remain transactional and bypass marketing caps.
create or replace function public.notification_booking_events() returns trigger language plpgsql security definer set search_path='' as $$
declare pro public.professional_profiles; customer_name text; t public.notification_templates; typ text; begin
 select * into pro from public.professional_profiles where id=new.professional_id;
 select full_name into customer_name from public.users where id=new.customer_id;
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
drop trigger if exists notification_booking_events on public.bookings;
drop trigger if exists week11_booking_notification on public.bookings;
drop trigger if exists week11_booking_notifications on public.bookings;
create trigger notification_booking_events after insert or update of status,payment_status on public.bookings for each row execute function public.notification_booking_events();

do $$ begin
  if exists(select 1 from cron.job where jobname='sheree-appointment-reminders') then
    perform cron.unschedule((select jobid from cron.job where jobname='sheree-appointment-reminders' limit 1));
  end if;
end $$;

grant select,insert,update on public.user_notification_activity to authenticated;
