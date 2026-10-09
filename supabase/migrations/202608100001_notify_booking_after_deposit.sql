-- A reservation with a required deposit is only a completed booking after the
-- deposit has been confirmed. Delay booking notifications until that point.
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

  select coalesce(nullif(full_name,''),'A new client') into customer_name
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

drop trigger if exists week11_booking_notifications on public.bookings;
create trigger week11_booking_notifications
after insert or update of status,payment_status on public.bookings
for each row execute function public.week11_booking_notifications();
