-- Fix the grammar of payment outcome notifications.
-- Previously the body was built as "Your <service> payment is now <status>."
-- which read awkwardly for a failed payment, e.g.
--   "Your Lashes payment is now failed."
-- Now each status gets its own natural sentence.
create or replace function public.week11_payment_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare service text;
begin
  if tg_op='INSERT' or new.status is distinct from old.status then
    select b.service_name into service from public.bookings b where b.id=new.booking_id;
    if new.status in ('paid','failed','refunded') then
      perform public.notify_user(new.customer_id,'payment',
        case new.status when 'paid' then 'Payment received' when 'failed' then 'Payment needs another try' else 'Your refund is on its way' end,
        case new.status
          when 'paid' then 'Your '||service||' payment was successful.'
          when 'failed' then 'Your '||service||' payment could not be processed.'
          else 'Your '||service||' payment has been refunded.' end,
        '/bookings',jsonb_build_object('bookingId',new.booking_id,'paymentId',new.id,'status',new.status),'customer');
    end if;
  end if;
  return new;
end $$;
