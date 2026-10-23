-- Abandoning Paystack checkout is not a cancellation.
--
-- Closing the payment sheet used to run `release_unpaid_booking`, which set the
-- reservation to status='cancelled'. Every abandoned checkout therefore showed
-- up in the customer's history as a cancelled appointment, appeared in the
-- professional's list, and counted towards cancellation rates — even though
-- nothing was ever charged and an unpaid slot is never held (see
-- 202608150001_paid_slots_only.sql).
--
-- An unpaid reservation was never a booking, so releasing one now deletes it.
-- Abandoning checkout leaves no trace, exactly like it never happened.
--
-- The guards are unchanged: only the caller's own reservation, only while it is
-- still pending, and never once a Paystack charge has been recorded as paid. The
-- app verifies with Paystack before it releases, so a completed payment can
-- never reach this function. If a charge did land (for example a mobile-money
-- prompt the customer approved after closing the sheet) the guard below keeps
-- the reservation intact so the webhook can still settle it.
create or replace function public.release_unpaid_booking(booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  released boolean;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;

  -- A payment that actually went through is never discarded, even when the app
  -- could not confirm it in time: the webhook needs the booking row to settle.
  if exists (
    select 1
    from public.payments p
    where p.booking_id = release_unpaid_booking.booking_id
      and p.status in ('paid','refund_pending','refunded')
  ) then
    return false;
  end if;

  -- Attempts that never completed are not ledger history for anything: the
  -- reservation they belong to is about to disappear. Deleting them also clears
  -- the `on delete restrict` reference to the booking.
  delete from public.payments p
  where p.booking_id = release_unpaid_booking.booking_id
    and p.status in ('pending','failed');

  delete from public.bookings b
  where b.id = release_unpaid_booking.booking_id
    and b.customer_id = (select auth.uid())
    and b.payment_status='pending'
    and b.deposit_paid_at is null
    and b.status in('requested','confirmed');

  released:=found;
  return released;
end
$$;

revoke all on function public.release_unpaid_booking(uuid) from public,anon;
grant execute on function public.release_unpaid_booking(uuid) to authenticated;

-- A conversation price card mirrors the booking that paid for it. The
-- insert/update trigger only fires for reservations that are kept, so a deleted
-- reservation must hand its proposal back to the chat explicitly.
create or replace function public.clear_price_card_after_booking_delete()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if old.price_card_id is not null then
    update public.conversation_price_cards c
       set booking_id=null, updated_at=now()
     where c.id=old.price_card_id
       and c.status='sent'
       and (c.booking_id is null or c.booking_id=old.id);
  end if;
  return old;
end
$$;

drop trigger if exists bookings_clear_price_card on public.bookings;
create trigger bookings_clear_price_card
after delete on public.bookings
for each row
execute function public.clear_price_card_after_booking_delete();
