-- Fix SQLSTATE 42702 in reschedule_booking: the unqualified `notes` column
-- reference in the UPDATE SET clause was ambiguous with the `notes` parameter.
-- The old column value is now qualified as bookings.notes.
create or replace function public.reschedule_booking(
  booking_id uuid,
  new_starts_at timestamptz,
  notes text default null,
  mobile_service boolean default false
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  b record; svc record; pref record; hours record;
  customer uuid := (select auth.uid());
  local_start timestamp; local_finish timestamp; finish timestamptz;
  buffered_start timestamptz; buffered_finish timestamptz;
  selected_travel_fee numeric(10,2) := 0;
  professional_user uuid;
begin
  if customer is null then raise exception 'Authentication required'; end if;

  select * into b from public.bookings where id=$1;
  if b.id is null or b.customer_id<>customer then raise exception 'Appointment not found'; end if;
  if b.status not in ('requested','confirmed') then raise exception 'This appointment can no longer be rescheduled'; end if;
  if b.starts_at<=now() then raise exception 'This appointment has already started'; end if;

  select s.*, p.offers_mobile_service, p.mobile_service_fee, p.country_code, p.cancellation_policy, p.user_id
    into svc from public.professional_services s
    join public.professional_profiles p on p.id=s.professional_id
   where s.id=b.service_id and s.is_active;
  if svc.id is null then raise exception 'Service unavailable'; end if;
  if $4 and not svc.offers_mobile_service then raise exception 'Mobile service is unavailable'; end if;
  if $4 then selected_travel_fee := coalesce(svc.mobile_service_fee,0); end if;

  select * into pref from public.professional_schedule_preferences p where p.professional_id=svc.professional_id;
  local_start := timezone('Africa/Accra',$2);
  finish := $2 + make_interval(mins=>svc.duration_minutes);
  local_finish := timezone('Africa/Accra',finish);
  if $2<=now()+make_interval(hours=>coalesce(pref.minimum_notice_hours,2)) then raise exception 'This time is too close to book'; end if;
  if $2>now()+make_interval(days=>coalesce(pref.booking_window_days,60)) then raise exception 'This date is outside the booking window'; end if;

  select * into hours from public.professional_working_hours h where h.professional_id=svc.professional_id and h.day_of_week=extract(dow from local_start);
  if hours.id is null or hours.is_closed or local_start::time<hours.opens_at or local_finish::time>hours.closes_at then raise exception 'Outside working hours'; end if;

  if exists(select 1 from public.professional_time_off t where t.professional_id=svc.professional_id and tstzrange(t.starts_at,t.ends_at,'[)')&&tstzrange($2,finish,'[)')) then raise exception 'Professional is away at that time'; end if;
  if exists(select 1 from public.professional_schedule_breaks br where br.professional_id=svc.professional_id and br.day_of_week=extract(dow from local_start) and tsrange(local_start,local_finish,'[)')&&tsrange(local_start::date+br.starts_at,local_start::date+br.ends_at,'[)')) then raise exception 'That time overlaps a scheduled break'; end if;

  -- Daily cap excludes the appointment being moved.
  if (select count(*) from public.bookings x
       where x.professional_id=svc.professional_id and x.id<>b.id
         and (x.payment_status='paid' or x.created_at>now()-interval '15 minutes')
         and timezone('Africa/Accra',x.starts_at)::date=local_start::date
         and x.status in('requested','confirmed'))>=coalesce(pref.max_appointments_per_day,8)
  then raise exception 'That day is fully booked'; end if;

  -- Overlap check excludes the appointment being moved (its own slot is fine).
  buffered_start := $2-make_interval(mins=>coalesce(pref.buffer_minutes,15));
  buffered_finish := finish+make_interval(mins=>coalesce(pref.buffer_minutes,15));
  if exists(select 1 from public.bookings x
       where x.professional_id=svc.professional_id and x.id<>b.id
         and x.status in('requested','confirmed')
         and (x.payment_status='paid' or x.created_at>now()-interval '15 minutes')
         and tstzrange(x.starts_at,x.ends_at,'[)')&&tstzrange(buffered_start,buffered_finish,'[)'))
  then raise exception 'That time was just booked'; end if;

  -- Move the appointment. Deposit/balance amounts are only recomputed while the
  -- deposit is still unpaid; an already-paid deposit stays frozen so a reschedule
  -- never silently refunds or recharges money.
  update public.bookings
     set starts_at=$2,
         ends_at=finish,
         notes=coalesce(nullif(trim($3),''),bookings.notes),
         is_mobile_service=$4,
         travel_fee=selected_travel_fee,
         original_starts_at=coalesce(original_starts_at,b.starts_at),
         rescheduled_at=now(),
         deposit_amount=case when b.payment_status='pending' then round(svc.price*svc.deposit_percentage/100,2)+selected_travel_fee else b.deposit_amount end,
         balance_amount=case when b.payment_status='pending' then round(svc.price-(svc.price*svc.deposit_percentage/100),2) else b.balance_amount end
   where id=b.id;

  -- Tell the professional their diary moved, and confirm the new time to the
  -- customer. Status/payment triggers do not fire here, so notify explicitly.
  professional_user := svc.user_id;
  perform public.notify_user(
    professional_user,'booking','Appointment rescheduled',
    'A client moved their '||svc.name||' appointment to a new time.',
    '/calendar',jsonb_build_object('bookingId',b.id,'rescheduled',true),
    'professional'::public.notification_audience
  );
  perform public.notify_user(
    b.customer_id,'booking','Appointment rescheduled',
    'Your '||svc.name||' appointment now has a different time.',
    '/bookings',jsonb_build_object('bookingId',b.id,'rescheduled',true),
    'customer'::public.notification_audience
  );
  return b.id;
end $$;

revoke all on function public.reschedule_booking(uuid,timestamptz,text,boolean) from public;
grant execute on function public.reschedule_booking(uuid,timestamptz,text,boolean) to authenticated;
