-- Fix deposits that were stored under the old 50% policy.
--
-- paystack-initialize charges exactly bookings.deposit_amount, and reserve_booking
-- computes that value from professional_services.deposit_percentage. Bookings
-- created before the rate moved to 40% therefore kept a 50% deposit_amount, so a
-- customer who was quoted 40% in the app (₵2.00 on a ₵5.00 service) could still be
-- charged the stale ₵2.50. reserve_booking also reuses a pending booking created in
-- the last 15 minutes instead of inserting a new one, which kept the old amount in
-- play for retries.
--
-- Recompute every unpaid booking from its service's (now fixed 40%) rate so the
-- stored amount always agrees with what the app quotes.

update public.bookings b
   set deposit_amount = round(s.price * s.deposit_percentage / 100, 2) + coalesce(b.travel_fee, 0),
       balance_amount = round(s.price - (s.price * s.deposit_percentage / 100), 2)
  from public.professional_services s
 where s.id = b.service_id
   -- Only untouched reservations: a booking whose payment already started (or was
   -- settled) must keep the amount it was charged, or verify/replay would mismatch.
   and b.payment_status = 'pending'
   and b.paystack_reference is null
   and b.deposit_paid_at is null
   and b.deposit_amount is distinct from round(s.price * s.deposit_percentage / 100, 2) + coalesce(b.travel_fee, 0);

-- Keep the recorded payment attempts in step with the corrected bookings; they are
-- still pending, so no money has moved against the old amount.
update public.payments p
   set amount = b.deposit_amount
  from public.bookings b
 where b.id = p.booking_id
   and p.status = 'pending'
   and b.payment_status = 'pending'
   and p.amount is distinct from b.deposit_amount;
