-- Route customers straight from a completed appointment to its verified review.
-- Existing review RLS already ensures only the booking's customer can submit once.
create or replace function public.week11_booking_notifications()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  professional_user uuid;
  customer_name text;
begin
  select user_id into professional_user
  from public.professional_profiles
  where id=new.professional_id;

  select coalesce(nullif(full_name,''),'A new client') into customer_name
  from public.users
  where id=new.customer_id;

  if tg_op='UPDATE' and new.payment_status='paid' and old.payment_status is distinct from 'paid' then
    perform public.notify_user(
      professional_user,
      'booking',
      case new.status when 'requested' then 'New booking request' else 'New confirmed booking' end,
      customer_name||' booked '||new.service_name||'.',
      '/calendar',
      jsonb_build_object('bookingId',new.id,'status',new.status),
      'professional'
    );
    perform public.notify_user(
      new.customer_id,
      'booking',
      case new.status when 'requested' then 'Your request is on its way' else 'You are booked' end,
      case new.status when 'requested' then 'Your payment is secure. The professional will confirm your appointment soon.' else 'Payment complete—your appointment is in the diary.' end,
      '/bookings',
      jsonb_build_object('bookingId',new.id,'status',new.status),
      'customer'
    );
  elsif tg_op='UPDATE' and new.status is distinct from old.status and new.payment_status='paid' then
    if new.status='completed' then
      perform public.notify_user(
        new.customer_id,
        'review',
        'How was your appointment?',
        'Share your experience with '||new.service_name||'.',
        '/review/'||new.id,
        jsonb_build_object('bookingId',new.id,'status',new.status,'event','review_requested'),
        'customer'
      );
    else
      perform public.notify_user(
        new.customer_id,
        'booking',
        case new.status when 'confirmed' then 'Your booking is confirmed' when 'cancelled' then 'Booking cancelled' else 'Booking updated' end,
        'Tap to see the latest details.',
        '/bookings',
        jsonb_build_object('bookingId',new.id,'status',new.status),
        'customer'
      );
    end if;
    perform public.notify_user(
      professional_user,
      'booking',
      'Booking updated',
      customer_name||'''s booking is now '||new.status||'.',
      '/calendar',
      jsonb_build_object('bookingId',new.id,'status',new.status),
      'professional'
    );
  end if;
  return new;
end
$$;
