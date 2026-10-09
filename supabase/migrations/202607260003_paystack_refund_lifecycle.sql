-- Paystack may require customer bank details before a refund can continue.
alter table public.booking_cancellation_settlements
  drop constraint if exists booking_cancellation_settlements_refund_status_check;

alter table public.booking_cancellation_settlements
  add constraint booking_cancellation_settlements_refund_status_check
  check (refund_status in ('pending','processing','needs_attention','refunded','failed'));

create or replace function public.notify_refund_status() returns trigger language plpgsql security definer set search_path='' as $$
declare uid uuid; service text; title text; body text;
begin
 if tg_op='UPDATE' and new.refund_status is not distinct from old.refund_status then return new; end if;
 select customer_id,service_name into uid,service from public.bookings where id=new.booking_id;
 if uid is null then return new; end if;
 title:=case new.refund_status
   when 'processing' then 'Refund is processing'
   when 'refunded' then 'Refund sent'
   when 'needs_attention' then 'Refund details needed'
   when 'failed' then 'Refund needs attention'
   else 'Refund update' end;
 body:='Your GH₵'||to_char(new.refund_amount,'FM999999990.00')||case new.refund_status
   when 'refunded' then ' refund was sent for '
   when 'processing' then ' refund is processing for '
   when 'needs_attention' then ' refund needs additional account details for '
   when 'failed' then ' refund could not be processed for '
   else ' refund changed for ' end||service||'.';
 perform public.notify_user(uid,'payment',title,body,'/bookings',jsonb_build_object('bookingId',new.booking_id,'status',new.refund_status,'amount',new.refund_amount,'event','refund_status'),'customer');
 return new;
end $$;
