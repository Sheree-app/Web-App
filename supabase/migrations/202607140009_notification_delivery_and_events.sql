-- Deliver every notification through Expo Push and cover all event tables currently in the app.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.notify_user(target_user uuid, notification_kind public.notification_kind, notification_title text, notification_body text, notification_url text default null, notification_data jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid; token record;
begin
  insert into public.notifications(user_id,kind,title,body,url,data)
  values(target_user,notification_kind,notification_title,notification_body,notification_url,notification_data)
  returning id into new_id;
  for token in select expo_push_token from public.push_tokens where user_id=target_user and enabled loop
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type":"application/json","Accept":"application/json"}'::jsonb,
      body := jsonb_build_object('to',token.expo_push_token,'sound','default','channelId','sheree-updates','title',notification_title,'body',notification_body,'data',notification_data||jsonb_build_object('url',notification_url,'notificationId',new_id))
    );
  end loop;
  update public.notifications set push_sent_at=case when exists(select 1 from public.push_tokens where user_id=target_user and enabled) then now() else null end where id=new_id;
  return new_id;
end $$;

revoke all on function public.notify_user(uuid,public.notification_kind,text,text,text,jsonb) from public,anon,authenticated;

create or replace function public.week11_social_notification() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid; actor_name text; post_image text; action_text text;
begin
  select p.user_id,fp.image_url into owner_id,post_image from public.feed_posts fp join public.professional_profiles p on p.id=fp.professional_id where fp.id=new.post_id;
  if owner_id is null or owner_id=new.user_id then return new; end if;
  select coalesce(nullif(full_name,''),'Someone') into actor_name from public.users where id=new.user_id;
  action_text:=case tg_table_name when 'feed_post_likes' then 'liked your look' when 'feed_post_comments' then 'left a sweet comment' else 'saved your look' end;
  perform public.notify_user(owner_id,'social',
    case tg_table_name when 'feed_post_likes' then actor_name||' loved your look 💕' when 'feed_post_comments' then 'New comment, lovely 💬' else 'Your look was saved ✨' end,
    actor_name||' '||action_text||'.','/post/'||new.post_id,
    jsonb_build_object('postId',new.post_id,'actorId',new.user_id,'event',tg_table_name,'imageUrl',post_image));
  return new;
end $$;

create trigger notify_feed_like after insert on public.feed_post_likes for each row execute function public.week11_social_notification();
create trigger notify_feed_comment after insert on public.feed_post_comments for each row execute function public.week11_social_notification();
create trigger notify_feed_save after insert on public.feed_post_saves for each row execute function public.week11_social_notification();

drop trigger if exists week11_booking_notification on public.bookings;
drop function if exists public.week11_booking_notification();
create or replace function public.week11_booking_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare professional_user uuid; customer_name text;
begin
  select user_id into professional_user from public.professional_profiles where id=new.professional_id;
  select coalesce(nullif(full_name,''),'A new client') into customer_name from public.users where id=new.customer_id;
  if tg_op='INSERT' then
    perform public.notify_user(professional_user,'booking','New booking, lovely! ✨',customer_name||' booked '||new.service_name||'.','/calendar',jsonb_build_object('bookingId',new.id));
    perform public.notify_user(new.customer_id,'booking',case new.status when 'confirmed' then 'You''re booked, lovely! ✨' else 'Your request is on its way 💕' end,case new.status when 'confirmed' then 'Your beauty appointment is officially in the diary.' else 'The professional will confirm your appointment soon.' end,'/bookings',jsonb_build_object('bookingId',new.id));
  elsif new.status is distinct from old.status then
    perform public.notify_user(new.customer_id,'booking',case new.status when 'confirmed' then 'You''re booked, lovely! ✨' when 'cancelled' then 'A little booking update' when 'completed' then 'Looking gorgeous? Tell us everything ✨' else 'Your booking has an update' end,case new.status when 'cancelled' then 'This appointment was cancelled. Let''s find another perfect time.' when 'completed' then 'Your appointment is complete. Leave a review when you''re ready.' else 'Tap to see the latest details.' end,'/bookings',jsonb_build_object('bookingId',new.id,'status',new.status));
    perform public.notify_user(professional_user,'booking','Booking updated',customer_name||'''s booking is now '||new.status||'.','/calendar',jsonb_build_object('bookingId',new.id,'status',new.status));
  end if; return new;
end $$;
create trigger week11_booking_notifications after insert or update of status on public.bookings for each row execute function public.week11_booking_notifications();

create or replace function public.week11_payment_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare professional_user uuid; service text;
begin
  if tg_op='INSERT' or new.status is distinct from old.status then
    select p.user_id,b.service_name into professional_user,service from public.bookings b join public.professional_profiles p on p.id=b.professional_id where b.id=new.booking_id;
    perform public.notify_user(new.customer_id,'payment',case new.status when 'paid' then 'Payment received, gorgeous ✨' when 'failed' then 'Your payment needs another try' when 'refunded' then 'Your refund is on its way' else 'Payment update' end,'Your '||service||' payment is now '||new.status||'.','/bookings',jsonb_build_object('bookingId',new.booking_id,'paymentId',new.id,'status',new.status));
    if new.status='paid' then perform public.notify_user(professional_user,'payment','Deposit secured 💕','Payment for '||service||' has been received.','/calendar',jsonb_build_object('bookingId',new.booking_id,'paymentId',new.id)); end if;
  end if; return new;
end $$;
create trigger week11_payment_notifications after insert or update of status on public.payments for each row execute function public.week11_payment_notifications();

create or replace function public.send_appointment_reminders() returns void language plpgsql security definer set search_path='' as $$
declare booking record; recipient uuid;
begin
  for booking in select b.*,p.user_id professional_user from public.bookings b join public.professional_profiles p on p.id=b.professional_id where b.status='confirmed' and b.starts_at between now()+interval '23 hours 55 minutes' and now()+interval '24 hours 5 minutes' loop
    if not exists(select 1 from public.notifications n where n.user_id=booking.customer_id and n.data->>'bookingId'=booking.id::text and n.data->>'reminder'='24h') then perform public.notify_user(booking.customer_id,'appointment_reminder','Tomorrow''s your beauty day 💕','Your '||booking.service_name||' appointment is in 24 hours.','/bookings',jsonb_build_object('bookingId',booking.id,'reminder','24h')); end if;
    if not exists(select 1 from public.notifications n where n.user_id=booking.professional_user and n.data->>'bookingId'=booking.id::text and n.data->>'reminder'='24h') then perform public.notify_user(booking.professional_user,'appointment_reminder','Tomorrow''s appointment ✨',booking.service_name||' is coming up in 24 hours.','/calendar',jsonb_build_object('bookingId',booking.id,'reminder','24h')); end if;
  end loop;
end $$;

select cron.schedule('sheree-appointment-reminders','*/5 * * * *',$schedule$select public.send_appointment_reminders()$schedule$)
where not exists(select 1 from cron.job where jobname='sheree-appointment-reminders');
