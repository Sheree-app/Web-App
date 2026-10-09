-- A reserved slot is not a completed booking until its deposit boundary succeeds.
create or replace function public.week11_booking_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare professional_user uuid; customer_name text;
begin
  select user_id into professional_user from public.professional_profiles where id=new.professional_id;
  select coalesce(nullif(full_name,''),'A new client') into customer_name from public.users where id=new.customer_id;

  -- Paystack and zero-deposit bookings both converge on payment_status = paid.
  if tg_op='UPDATE' and new.payment_status='paid' and old.payment_status is distinct from 'paid' then
    perform public.notify_user(
      professional_user,'booking',
      case new.status when 'requested' then 'New booking request, lovely! ✨' else 'You''ve been booked, lovely! ✨' end,
      customer_name||' booked '||new.service_name||'.',
      '/calendar',jsonb_build_object('bookingId',new.id,'status',new.status)
    );
    perform public.notify_user(
      new.customer_id,'booking',
      case new.status when 'requested' then 'Your request is on its way 💕' else 'You''re booked, lovely! ✨' end,
      case new.status when 'requested' then 'Your payment is secure. The professional will confirm your appointment soon.' else 'Payment complete—your beauty appointment is officially in the diary.' end,
      '/bookings',jsonb_build_object('bookingId',new.id,'status',new.status)
    );
  elsif tg_op='UPDATE' and new.status is distinct from old.status and new.payment_status='paid' then
    perform public.notify_user(new.customer_id,'booking',
      case new.status when 'confirmed' then 'You''re officially confirmed ✨' when 'cancelled' then 'A little booking update' when 'completed' then 'Looking gorgeous? Tell us everything ✨' else 'Your booking has an update' end,
      case new.status when 'cancelled' then 'This appointment was cancelled. Let''s find another perfect time.' when 'completed' then 'Your appointment is complete. Leave a review when you''re ready.' else 'Tap to see the latest details.' end,
      '/bookings',jsonb_build_object('bookingId',new.id,'status',new.status)
    );
    perform public.notify_user(professional_user,'booking','Booking updated',customer_name||'''s booking is now '||new.status||'.','/calendar',jsonb_build_object('bookingId',new.id,'status',new.status));
  end if;
  return new;
end $$;

drop trigger if exists week11_booking_notifications on public.bookings;
create trigger week11_booking_notifications
after update of status,payment_status on public.bookings
for each row execute function public.week11_booking_notifications();

-- Payment receipts remain a separate customer event. The professional's booking alert
-- comes from the paid booking transition above, preventing an early or duplicate alert.
create or replace function public.week11_payment_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare service text;
begin
  if tg_op='INSERT' or new.status is distinct from old.status then
    select b.service_name into service from public.bookings b where b.id=new.booking_id;
    if new.status in ('paid','failed','refunded') then
      perform public.notify_user(new.customer_id,'payment',
        case new.status when 'paid' then 'Payment received, gorgeous ✨' when 'failed' then 'Your payment needs another try' else 'Your refund is on its way' end,
        'Your '||service||' payment is now '||new.status||'.','/bookings',
        jsonb_build_object('bookingId',new.booking_id,'paymentId',new.id,'status',new.status));
    end if;
  end if;
  return new;
end $$;
