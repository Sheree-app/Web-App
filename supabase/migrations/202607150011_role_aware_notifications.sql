create type public.notification_audience as enum ('customer','professional','all');
alter table public.notifications add column audience public.notification_audience not null default 'customer';
update public.notifications set audience='professional' where url='/calendar' or data->>'event' in ('feed_post_likes','feed_post_comments','feed_post_saves');
create index notifications_user_audience_created_idx on public.notifications(user_id,audience,created_at desc);

create function public.notify_user(target_user uuid,notification_kind public.notification_kind,notification_title text,notification_body text,notification_url text,notification_data jsonb,notification_audience public.notification_audience) returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;token record;push_data jsonb:=notification_data||jsonb_build_object('url',notification_url,'audience',notification_audience);
begin
  insert into public.notifications(user_id,kind,title,body,url,data,audience) values(target_user,notification_kind,notification_title,notification_body,notification_url,push_data,notification_audience) returning id into new_id;
  for token in select expo_push_token from public.push_tokens where user_id=target_user and enabled loop
    perform net.http_post(url:='https://exp.host/--/api/v2/push/send',headers:='{"Content-Type":"application/json","Accept":"application/json"}'::jsonb,body:=jsonb_build_object('to',token.expo_push_token,'sound','default','channelId','sheree-updates','title',notification_title,'body',notification_body,'data',push_data||jsonb_build_object('notificationId',new_id)));
  end loop;
  update public.notifications set push_sent_at=case when exists(select 1 from public.push_tokens where user_id=target_user and enabled) then now() else null end where id=new_id;
  return new_id;
end $$;
revoke all on function public.notify_user(uuid,public.notification_kind,text,text,text,jsonb,public.notification_audience) from public,anon,authenticated;

create or replace function public.notify_user(target_user uuid,notification_kind public.notification_kind,notification_title text,notification_body text,notification_url text default null,notification_data jsonb default '{}'::jsonb) returns uuid language sql security definer set search_path='' as $$select public.notify_user(target_user,notification_kind,notification_title,notification_body,notification_url,notification_data,'customer'::public.notification_audience)$$;
revoke all on function public.notify_user(uuid,public.notification_kind,text,text,text,jsonb) from public,anon,authenticated;

create or replace function public.week11_social_notification() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;actor_name text;post_image text;action_text text;
begin
  select p.user_id,fp.image_url into owner_id,post_image from public.feed_posts fp join public.professional_profiles p on p.id=fp.professional_id where fp.id=new.post_id;
  if owner_id is null or owner_id=new.user_id then return new;end if;
  select coalesce(nullif(full_name,''),'Someone') into actor_name from public.users where id=new.user_id;
  action_text:=case tg_table_name when 'feed_post_likes' then 'liked your work' when 'feed_post_comments' then 'commented on your work' else 'saved your work' end;
  perform public.notify_user(owner_id,'social',case tg_table_name when 'feed_post_likes' then actor_name||' liked your work' when 'feed_post_comments' then 'New comment on your work' else 'Your work was saved' end,actor_name||' '||action_text||'.','/notifications',jsonb_build_object('postId',new.post_id,'actorId',new.user_id,'event',tg_table_name,'imageUrl',post_image),'professional');
  return new;
end $$;

create or replace function public.week11_booking_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare professional_user uuid;customer_name text;
begin
  select user_id into professional_user from public.professional_profiles where id=new.professional_id;select coalesce(nullif(full_name,''),'A new client') into customer_name from public.users where id=new.customer_id;
  if tg_op='UPDATE' and new.payment_status='paid' and old.payment_status is distinct from 'paid' then
    perform public.notify_user(professional_user,'booking',case new.status when 'requested' then 'New booking request' else 'New confirmed booking' end,customer_name||' booked '||new.service_name||'.','/calendar',jsonb_build_object('bookingId',new.id,'status',new.status),'professional');
    perform public.notify_user(new.customer_id,'booking',case new.status when 'requested' then 'Your request is on its way' else 'You are booked' end,case new.status when 'requested' then 'Your payment is secure. The professional will confirm your appointment soon.' else 'Payment complete—your appointment is in the diary.' end,'/bookings',jsonb_build_object('bookingId',new.id,'status',new.status),'customer');
  elsif tg_op='UPDATE' and new.status is distinct from old.status and new.payment_status='paid' then
    perform public.notify_user(new.customer_id,'booking',case new.status when 'confirmed' then 'Your booking is confirmed' when 'cancelled' then 'Booking cancelled' when 'completed' then 'Appointment complete' else 'Booking updated' end,case new.status when 'completed' then 'Leave a review when you are ready.' else 'Tap to see the latest details.' end,'/bookings',jsonb_build_object('bookingId',new.id,'status',new.status),'customer');
    perform public.notify_user(professional_user,'booking','Booking updated',customer_name||'''s booking is now '||new.status||'.','/calendar',jsonb_build_object('bookingId',new.id,'status',new.status),'professional');
  end if;return new;
end $$;

create or replace function public.week11_payment_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare service text;
begin
  if tg_op='INSERT' or new.status is distinct from old.status then select b.service_name into service from public.bookings b where b.id=new.booking_id;if new.status in ('paid','failed','refunded') then perform public.notify_user(new.customer_id,'payment',case new.status when 'paid' then 'Payment received' when 'failed' then 'Payment needs another try' else 'Your refund is on its way' end,'Your '||service||' payment is now '||new.status||'.','/bookings',jsonb_build_object('bookingId',new.booking_id,'paymentId',new.id,'status',new.status),'customer');end if;end if;return new;
end $$;

create or replace function public.send_appointment_reminders() returns void language plpgsql security definer set search_path='' as $$
declare booking record;
begin
  for booking in select b.*,p.user_id professional_user from public.bookings b join public.professional_profiles p on p.id=b.professional_id where b.status='confirmed' and b.starts_at between now()+interval '23 hours 55 minutes' and now()+interval '24 hours 5 minutes' loop
    if not exists(select 1 from public.notifications n where n.user_id=booking.customer_id and n.data->>'bookingId'=booking.id::text and n.data->>'reminder'='24h') then perform public.notify_user(booking.customer_id,'appointment_reminder','Appointment tomorrow','Your '||booking.service_name||' appointment is in 24 hours.','/bookings',jsonb_build_object('bookingId',booking.id,'reminder','24h'),'customer');end if;
    if not exists(select 1 from public.notifications n where n.user_id=booking.professional_user and n.data->>'bookingId'=booking.id::text and n.data->>'reminder'='24h') then perform public.notify_user(booking.professional_user,'appointment_reminder','Appointment tomorrow',booking.service_name||' is coming up in 24 hours.','/calendar',jsonb_build_object('bookingId',booking.id,'reminder','24h'),'professional');end if;
  end loop;
end $$;

create or replace function public.notify_professional_review() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;actor_name text;
begin select p.user_id into owner_id from public.professional_profiles p where p.id=new.professional_id;select coalesce(nullif(full_name,''),'A client') into actor_name from public.users where id=new.customer_id;if owner_id is not null then perform public.notify_user(owner_id,'review','New client review',actor_name||' left you a '||new.rating||'-star review.','/notifications',jsonb_build_object('reviewId',new.id,'bookingId',new.booking_id,'event','review_created'),'professional');end if;return new;end $$;
drop trigger if exists notify_professional_review on public.reviews;
create trigger notify_professional_review after insert on public.reviews for each row execute function public.notify_professional_review();

create or replace function public.notify_professional_follow() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;actor_name text;
begin select p.user_id into owner_id from public.professional_profiles p where p.id=new.professional_id;if owner_id is null or owner_id=new.user_id then return new;end if;select coalesce(nullif(full_name,''),'Someone') into actor_name from public.users where id=new.user_id;perform public.notify_user(owner_id,'social','New follower',actor_name||' followed your studio.','/notifications',jsonb_build_object('actorId',new.user_id,'event','professional_follow'),'professional');return new;end $$;
drop trigger if exists notify_professional_follow on public.professional_follows;
create trigger notify_professional_follow after insert on public.professional_follows for each row execute function public.notify_professional_follow();
