-- Checkout is silent until the deposit is real.
--
-- `reserve_booking` writes the reservation row with `payment_status='pending'`
-- and the status implied by the professional's approval mode ('confirmed' for
-- automatic approval) BEFORE Paystack is ever opened. The notification trigger
-- guarded only the "paid" branches, and the fall-through branch tested
-- `new.status is distinct from old.status` — which is TRUE on every INSERT
-- (OLD is NULL). So a brand-new, unpaid reservation was treated as a status
-- *change* to 'confirmed' and the customer was congratulated with
-- "💗 You're booked!" while the payment sheet was still open.
--
-- That row is then drained by the notification worker, so the push arrives
-- right after the customer closes the Paystack sheet — at which point
-- `release_unpaid_booking` has already deleted the reservation. The result is a
-- notification advertising a booking that does not exist and a payment status
-- that never left 'pending'.
--
-- This restores what 202608100005_release_unpaid_bookings.sql originally
-- enforced, but durably at the function level (the trigger no longer carries a
-- WHEN clause that a future rebuild can drop):
--
--   1. An INSERT is announced only when the reservation arrives already paid
--      (regions that require no deposit settle inside reserve_booking).
--   2. An UPDATE is announced only while money is real, so releasing an
--      abandoned hold, or any other bookkeeping on a pending row, stays silent.
--   3. Releasing an unpaid reservation also deletes the notifications it
--      produced, so an abandoned checkout leaves nothing in the notification
--      centre.
--   4. A reservation whose checkout died with the app (browser killed, device
--      offline, OS killed the sheet) is swept after the hold window instead of
--      sitting in both parties' booking lists as "BALANCE DUE" forever.
create or replace function public.notification_booking_events()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  pro public.professional_profiles;
  customer_name text;
  t public.notification_templates;
  typ text;
  became_paid boolean;
begin
  -- A pending reservation is a checkout hold, not a booking. Nothing may be
  -- announced for one, in either direction.
  if tg_op='INSERT' then
    if new.payment_status<>'paid' then return new; end if;
  elsif new.payment_status<>'paid' and old.payment_status is distinct from 'paid' then
    return new;
  end if;

  select * into pro from public.professional_profiles where id=new.professional_id;
  select username into customer_name from public.users where id=new.customer_id;

  -- Money arriving is the announcement event for a deposit-backed booking;
  -- a row inserted already paid is the no-deposit case.
  became_paid:=(tg_op='INSERT' and new.payment_status='paid')
    or (tg_op='UPDATE' and new.payment_status='paid'
        and old.payment_status is distinct from 'paid');

  if became_paid then
    typ:=case when new.status='confirmed' then 'BOOKING_CONFIRMED' else null end;
    select * into t from public.notification_templates where notification_type='PROFESSIONAL_NEW_BOOKING';
    insert into public.notifications(user_id,kind,title,body,url,data,audience,notification_type,category,reason,reference_id,idempotency_key,user_type)
    values(pro.user_id,'booking',t.title_template,replace(t.body_template,'{{name}}',customer_name),'/calendar',jsonb_build_object('type','PROFESSIONAL_NEW_BOOKING','route','/calendar','bookingId',new.id),'professional','PROFESSIONAL_NEW_BOOKING','transactional','New booking created',new.id::text,'PROFESSIONAL_NEW_BOOKING:'||new.id,'professional') on conflict(idempotency_key) where idempotency_key is not null do nothing;
  elsif new.status is distinct from old.status and new.status='confirmed' then typ:='BOOKING_CONFIRMED';
  elsif new.status is distinct from old.status and new.status='cancelled' then
    select * into t from public.notification_templates where notification_type='PROFESSIONAL_BOOKING_CANCELLED';
    insert into public.notifications(user_id,kind,title,body,url,data,audience,notification_type,category,reason,reference_id,idempotency_key,user_type)
    values(pro.user_id,'booking',t.title_template,replace(t.body_template,'{{name}}',customer_name),'/calendar',jsonb_build_object('type','PROFESSIONAL_BOOKING_CANCELLED','route','/calendar','bookingId',new.id),'professional','PROFESSIONAL_BOOKING_CANCELLED','transactional','Booking cancelled',new.id::text,'PROFESSIONAL_BOOKING_CANCELLED:'||new.id,'professional') on conflict(idempotency_key) where idempotency_key is not null do nothing;
    typ:='BOOKING_CANCELLED';
  end if;

  if typ is not null then
    select * into t from public.notification_templates where notification_type=typ;
    insert into public.notifications(user_id,kind,title,body,url,data,audience,notification_type,category,reason,reference_id,idempotency_key,user_type)
    values(new.customer_id,'booking',t.title_template,replace(replace(t.body_template,'{{name}}',coalesce(pro.display_name,pro.business_name)),'{{time}}',to_char(new.starts_at at time zone 'Africa/Accra','FMDay at FMHH12:MI AM')),'/bookings',jsonb_build_object('type',typ,'route','/bookings','bookingId',new.id),'customer',typ,'transactional','Booking confirmed',new.id::text,typ||':'||new.id,'customer') on conflict(idempotency_key) where idempotency_key is not null do nothing;
  end if;
  return new;
end $$;

drop trigger if exists notification_booking_events on public.bookings;
create trigger notification_booking_events
after insert or update of status,payment_status on public.bookings
for each row execute function public.notification_booking_events();

-- Releasing an abandoned checkout must also withdraw its announcement. Rows
-- that were already queued for the notification worker are deleted before the
-- worker's next pass, so the push never fires at all; a push that already went
-- out stops being an inbox entry once the list is refetched.
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

  -- Nothing was ever paid on this reservation, so every notification pointing
  -- at it is an invitation to an appointment that will not exist.
  delete from public.notifications n
  where n.reference_id = release_unpaid_booking.booking_id::text
     or n.data->>'bookingId' = release_unpaid_booking.booking_id::text;

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

-- Backfill: the same guard that let the trigger announce a hold also left
-- "you're booked" rows behind for reservations that were released and deleted.
-- Those rows have no booking left to open, so they are removed rather than left
-- to route the customer to an empty screen.
delete from public.notifications n
where n.notification_type in ('BOOKING_CONFIRMED','BOOKING_CANCELLED','PROFESSIONAL_NEW_BOOKING','PROFESSIONAL_BOOKING_CANCELLED')
  and n.reference_id is not null
  and not exists (
    select 1 from public.bookings b where b.id::text=n.reference_id
  );

-- Hold window sweep: `release_unpaid_booking` only runs when the app survives
-- the Paystack sheet. A customer who swipes the app away, loses connectivity, or
-- has the sheet killed by the OS leaves a pending reservation behind, which the
-- 15-minute idempotency window no longer covers — so it would sit in the
-- customer's "My bookings" and the professional's upcoming list forever, held at
-- "pending", blocking neither slot (see 202608150001_paid_slots_only.sql) but
-- confusing both sides.
create index if not exists bookings_pending_hold_idx
  on public.bookings(created_at)
  where payment_status='pending';

create or replace function public.purge_abandoned_reservations(hold_minutes integer default 30)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  stale record;
  swept integer:=0;
  -- The floor is the 15-minute idempotency window in `reserve_booking_core`:
  -- past that point the app can no longer attach to the reservation and no new
  -- checkout can reuse it, so it can be nothing but an abandoned hold. The
  -- scheduled sweep uses the 30-minute default, which also clears any Paystack
  -- card or mobile-money prompt that was still settling.
  window_minutes integer:=greatest(coalesce(hold_minutes,30),15);
begin
  for stale in
    select b.id
    from public.bookings b
    where b.payment_status='pending'
      and b.deposit_paid_at is null
      and b.status in('requested','confirmed')
      and b.created_at < now()-make_interval(mins=>window_minutes)
      and not exists(
        select 1 from public.payments p
        where p.booking_id=b.id
          and p.status in('paid','refund_pending','refunded')
      )
  loop
    delete from public.notifications n
    where n.reference_id=stale.id::text
       or n.data->>'bookingId'=stale.id::text;
    delete from public.payments p
    where p.booking_id=stale.id
      and p.status in('pending','failed');
    -- Ordered deletes (not a data-modifying CTE) because `payments.booking_id`
    -- is `on delete restrict` and must be gone before the booking row is.
    begin
      delete from public.bookings b where b.id=stale.id;
      swept:=swept+1;
    exception when others then
      -- A payout, dispute or settlement row pinned this reservation down. It
      -- then needs a person, not a sweep, and must not abort the whole run.
      raise warning 'Abandoned reservation % was not swept: %',stale.id,sqlerrm;
    end;
  end loop;
  return swept;
end
$$;

revoke all on function public.purge_abandoned_reservations(integer) from public,anon,authenticated;

-- Clear the backlog now rather than waiting for the first scheduled pass: every
-- reservation that is still `pending` and older than the idempotency window is
-- an abandoned checkout from before this fix (the trigger announced them, and
-- the app released them without cleaning up), so it has no business sitting in
-- either party's upcoming list. Running the sweep here keeps the cleanup in one
-- place instead of duplicating the delete order as ad-hoc SQL.
select public.purge_abandoned_reservations(15);

-- `cron.schedule` replaces a job that already carries this name, so re-running
-- this migration reschedules rather than duplicating.
select cron.schedule(
  'sheree-abandoned-reservation-sweep',
  '*/15 * * * *',
  $cron$select public.purge_abandoned_reservations()$cron$
);

-- The professional's side of the same rule. A live appointment with
-- `payment_status='pending'` is somebody else's checkout, not work: it must not
-- appear in the studio's ledger, in its upcoming counts, or on the calendar
-- while the customer is still on the Paystack sheet. Rebuilt from
-- 202610180002_professional_booking_history.sql with that single filter added to
-- both the counts and the page query (the search predicate and pagination are
-- unchanged).
create or replace function public.get_professional_bookings(
  p_scope text default 'upcoming',
  p_search text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pid uuid;
  scope_filter text :=
    case when lower(coalesce(p_scope, '')) = 'past' then 'past' else 'upcoming' end;
  -- A pasted reference often arrives as "#SHR-1234"; the stored value has no
  -- hash, so strip the decorative prefix instead of returning no matches.
  search_term text :=
    nullif(trim(both '#' from trim(coalesce(p_search, ''))), '');
  page_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  page_offset integer := greatest(coalesce(p_offset, 0), 0);
  upcoming_count integer;
  past_count integer;
  total_count integer;
  items jsonb;
begin
  select p.id into pid
  from public.professional_profiles p
  where p.user_id = auth.uid();

  -- A beautician who has not finished studio setup still gets a usable ledger
  -- screen with zero counts instead of an error page.
  if pid is null then
    return jsonb_build_object(
      'items', '[]'::jsonb,
      'total', 0,
      'counts', jsonb_build_object('upcoming', 0, 'past', 0)
    );
  end if;

  -- Counts are taken with the current search applied, so the tab badges and
  -- the "the other tab has matches" hint always agree with the list below.
  select
    (count(*) filter (
      where b.status in ('requested', 'confirmed') and b.ends_at >= now()
    ))::integer,
    (count(*) filter (
      where b.status in ('completed', 'cancelled') or b.ends_at < now()
    ))::integer
  into upcoming_count, past_count
  from public.bookings b
  join public.users u on u.id = b.customer_id
  where b.professional_id = pid
    and b.customer_id <> auth.uid()
    and b.payment_status <> 'pending'
    and (
      search_term is null
      or u.username ilike '%' || search_term || '%'
      or b.service_name ilike '%' || search_term || '%'
      or b.booking_reference ilike '%' || search_term || '%'
      or coalesce(b.notes, '') ilike '%' || search_term || '%'
    );

  total_count := case when scope_filter = 'past' then past_count else upcoming_count end;

  select coalesce(
    jsonb_agg(
      row_data
      order by start_order asc nulls last, past_order desc nulls last, id_order asc
    ),
    '[]'::jsonb
  )
  into items
  from (
    select
      jsonb_build_object(
        'id', b.id,
        'customer_id', b.customer_id,
        'booking_reference', b.booking_reference,
        'customer_name', coalesce(nullif(trim(u.username), ''), 'Client'),
        'customer_avatar', u.avatar_url,
        'service_name', b.service_name,
        'starts_at', b.starts_at,
        'ends_at', b.ends_at,
        'status', b.status,
        'payment_status', b.payment_status,
        'price', b.price,
        'deposit_amount', b.deposit_amount,
        'balance_amount', b.balance_amount,
        'sheree_fee_amount', b.sheree_fee_amount,
        'notes', b.notes,
        'is_mobile_service', b.is_mobile_service,
        'travel_fee', b.travel_fee,
        'cancellation_reason', b.cancellation_reason,
        'cancelled_at', b.cancelled_at
      ) as row_data,
      case when scope_filter = 'upcoming' then b.starts_at end as start_order,
      case when scope_filter = 'past' then b.starts_at end as past_order,
      b.id as id_order
    from public.bookings b
    join public.users u on u.id = b.customer_id
    where b.professional_id = pid
      and b.customer_id <> auth.uid()
      and b.payment_status <> 'pending'
      and (
        case when scope_filter = 'upcoming'
          then b.status in ('requested', 'confirmed') and b.ends_at >= now()
          else b.status in ('completed', 'cancelled') or b.ends_at < now()
        end
      )
      and (
        search_term is null
        or u.username ilike '%' || search_term || '%'
        or b.service_name ilike '%' || search_term || '%'
        or b.booking_reference ilike '%' || search_term || '%'
        or coalesce(b.notes, '') ilike '%' || search_term || '%'
      )
    order by
      case when scope_filter = 'upcoming' then b.starts_at end asc nulls last,
      case when scope_filter = 'past' then b.starts_at end desc nulls last,
      b.id asc
    limit page_limit
    offset page_offset
  ) rows;

  return jsonb_build_object(
    'items', items,
    'total', total_count,
    'counts', jsonb_build_object('upcoming', upcoming_count, 'past', past_count)
  );
end;
$$;

revoke all on function public.get_professional_bookings(text, text, integer, integer) from public;
grant execute on function public.get_professional_bookings(text, text, integer, integer) to authenticated;

-- Direct reads (studio calendar, booking modal) follow the same rule.
drop policy if exists "professionals read live bookings" on public.bookings;
create policy "professionals read live bookings" on public.bookings
  for select to authenticated
  using (
    status in ('requested', 'confirmed')
    and payment_status <> 'pending'
    and exists (
      select 1
      from public.professional_profiles p
      where p.id = professional_id
        and p.user_id = (select auth.uid())
    )
  );
