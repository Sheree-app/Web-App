-- Qualify RPC inputs positionally so they cannot collide with booking columns.
create or replace function public.reserve_booking(
  service_id uuid,
  starts_at timestamptz,
  notes text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  svc record;
  pref record;
  booking_id uuid;
  finish timestamptz;
  customer uuid := (select auth.uid());
begin
  if customer is null then
    raise exception 'Authentication required';
  end if;

  select s.*, p.cancellation_policy
    into svc
    from public.professional_services s
    join public.professional_profiles p on p.id = s.professional_id
   where s.id = $1
     and s.is_active;

  if not found then
    raise exception 'Service unavailable';
  end if;

  finish := $2 + make_interval(mins => svc.duration_minutes);

  select *
    into pref
    from public.professional_schedule_preferences schedule_pref
   where schedule_pref.professional_id = svc.professional_id;

  if $2 < now() then
    raise exception 'Choose a future time';
  end if;

  if exists (
    select 1
      from public.bookings b
     where b.professional_id = svc.professional_id
       and b.status in ('requested', 'confirmed')
       and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange($2, finish, '[)')
  ) then
    raise exception 'That time was just booked';
  end if;

  insert into public.bookings (
    customer_id, professional_id, service_id, starts_at, ends_at, status,
    service_name, price, deposit_amount, balance_amount, notes,
    cancellation_policy
  ) values (
    customer,
    svc.professional_id,
    svc.id,
    $2,
    finish,
    case when coalesce(pref.approval_mode, 'automatic') = 'manual'
      then 'requested'::public.booking_status
      else 'confirmed'::public.booking_status
    end,
    svc.name,
    svc.price,
    round(svc.price * svc.deposit_percentage / 100, 2),
    round(svc.price - (svc.price * svc.deposit_percentage / 100), 2),
    nullif(trim($3), ''),
    svc.cancellation_policy
  ) returning id into booking_id;

  return booking_id;
end;
$$;

revoke all on function public.reserve_booking(uuid, timestamptz, text) from public;
grant execute on function public.reserve_booking(uuid, timestamptz, text) to authenticated;
