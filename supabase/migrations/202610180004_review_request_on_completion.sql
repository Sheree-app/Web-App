-- Ask the customer to rate the professional the moment an appointment is marked
-- complete.
--
-- The live booking trigger (`notification_booking_events`) only reacts to paid,
-- confirmed and cancelled transitions, so a `confirmed → completed` update
-- currently produces no notification at all. This adds a dedicated trigger
-- instead of widening that function: the review request is its own event with
-- its own destination, copy and preference, and keeping it separate means a
-- future edit to booking copy cannot silently drop the ask.
--
-- Delivery goes through `notify_user`, which pushes straight away (subject to
-- the customer's activity-push preference and quiet hours) and writes the row
-- shown in the notification centre. The returned row is then stamped with the
-- review-request metadata so `notificationDestination` can resolve
-- `/review/<bookingId>` and the ask can never be sent twice for one booking.
create or replace function public.notify_customer_review_request()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  professional_name text;
  notification_id uuid;
begin
  -- Completion is compare-and-set in the app, but this guard also protects a
  -- manual retry or a future admin action from asking the same customer twice.
  if exists (
    select 1 from public.notifications
    where idempotency_key='REVIEW_REQUEST:'||new.id
  ) then
    return new;
  end if;

  select coalesce(nullif(p.display_name,''),nullif(p.business_name,''),'your professional')
  into professional_name
  from public.professional_profiles p
  where p.id=new.professional_id;

  notification_id := public.notify_user(
    new.customer_id,
    'review',
    'How was your visit?',
    'Tell us how '||professional_name||' did — one tap is all it takes, and it helps the next person choose with confidence.',
    '/review/'||new.id,
    jsonb_build_object(
      'type','REVIEW_REQUEST',
      'route','/review/'||new.id,
      'bookingId',new.id,
      'status','completed',
      'event','review_requested',
      'audience','customer'
    ),
    'customer'
  );

  update public.notifications
  set notification_type='REVIEW_REQUEST',
      category='transactional',
      reason='Appointment completed',
      reference_id=new.id::text,
      idempotency_key='REVIEW_REQUEST:'||new.id,
      user_type='customer'
  where id=notification_id;

  return new;
end
$$;

revoke all on function public.notify_customer_review_request() from public, anon, authenticated;

drop trigger if exists notify_customer_review_request on public.bookings;
create trigger notify_customer_review_request
after update of status on public.bookings
for each row
when (new.status='completed' and old.status is distinct from 'completed')
execute function public.notify_customer_review_request();

-- Once the review is in, the invite it answers is no longer an action to take.
-- Marking it read keeps the notification centre honest without deleting the
-- history of the ask.
create or replace function public.mark_review_request_handled()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.notifications
  set read_at=coalesce(read_at,now())
  where user_id=new.customer_id
    and idempotency_key='REVIEW_REQUEST:'||new.booking_id;
  return new;
end
$$;

revoke all on function public.mark_review_request_handled() from public, anon, authenticated;

drop trigger if exists mark_review_request_handled on public.reviews;
create trigger mark_review_request_handled
after insert on public.reviews
for each row
execute function public.mark_review_request_handled();
