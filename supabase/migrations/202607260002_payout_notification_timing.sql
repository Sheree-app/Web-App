-- Completing an appointment prepares its payout; settlement is not instant.
-- Keep the professional-facing push copy accurate until the provider confirms it.
create or replace function public.notify_payout_status()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  professional_user uuid;
  booking_service text;
  title text;
  body text;
begin
  if tg_op='UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  select p.user_id, b.service_name
  into professional_user, booking_service
  from public.professional_profiles p
  left join public.bookings b on b.id=new.booking_id
  where p.id=new.professional_id;

  if professional_user is null then
    return new;
  end if;

  title:=case new.status
    when 'pending' then 'Payout account needed'
    when 'processing' then 'Payout is on its way'
    when 'paid' then 'Payout is on its way'
    when 'failed' then 'Payout needs attention'
    when 'reversed' then 'Payout was returned'
    else 'Payout update'
  end;

  body:=case new.status
    when 'pending' then
      'Connect a payout account to receive your GH₵'||to_char(new.amount,'FM999999990.00')||' payout.'
    when 'processing' then
      'GH₵'||to_char(new.amount,'FM999999990.00')||' will be sent for '||coalesce(booking_service,'your booking')||'.'
    when 'paid' then
      'GH₵'||to_char(new.amount,'FM999999990.00')||' will be sent to your payout account for '||coalesce(booking_service,'your booking')||'.'
    when 'failed' then
      'GH₵'||to_char(new.amount,'FM999999990.00')||' could not be sent. Open Sheree to check your payout details.'
    when 'reversed' then
      'Paystack returned the GH₵'||to_char(new.amount,'FM999999990.00')||' transfer. Sheree will retry after review.'
    else
      'Your payout status changed.'
  end;

  perform public.notify_user(
    professional_user,
    'payment',
    title,
    body,
    '/notifications',
    jsonb_build_object(
      'bookingId',new.booking_id,
      'payoutId',new.id,
      'status',new.status,
      'amount',new.amount,
      'event','payout_status'
    ),
    'professional'
  );
  return new;
end
$$;
