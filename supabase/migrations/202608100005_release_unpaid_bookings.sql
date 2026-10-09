-- Release a temporary slot hold when the customer closes Paystack without paying.
-- The conditional update prevents a confirmed payment from being cancelled.
create or replace function public.release_unpaid_booking(booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare released boolean;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;

  update public.bookings b
  set status='cancelled', payment_status='failed'
  where b.id=release_unpaid_booking.booking_id
    and b.customer_id=(select auth.uid())
    and b.payment_status='pending'
    and b.deposit_paid_at is null;

  released:=found;
  if released then
    update public.payments p
    set status='failed', updated_at=now()
    where p.booking_id=release_unpaid_booking.booking_id
      and p.status='pending';
  end if;
  return released;
end
$$;

revoke all on function public.release_unpaid_booking(uuid) from public,anon;
grant execute on function public.release_unpaid_booking(uuid) to authenticated;

-- Unpaid reservations were never bookings, so releasing one must not send
-- cancellation notifications. Paid booking changes still use the same handler.
drop trigger if exists week11_booking_notifications on public.bookings;
drop trigger if exists week11_booking_notifications_insert on public.bookings;
drop trigger if exists week11_booking_notifications_update on public.bookings;
create trigger week11_booking_notifications_insert
after insert on public.bookings
for each row
when (new.payment_status='paid')
execute function public.week11_booking_notifications();
create trigger week11_booking_notifications_update
after update of status,payment_status on public.bookings
for each row
when (new.payment_status='paid' or old.payment_status='paid')
execute function public.week11_booking_notifications();
