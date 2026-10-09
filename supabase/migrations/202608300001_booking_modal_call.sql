-- Let customers call their beautician from the booking modal. The
-- professional's phone lives on public.users.phone, but the users table RLS
-- only lets a user read their own row, so this function runs as security
-- definer (matching get_creator_profile) to surface the professional's own
-- contact number to the authenticated customer.

create or replace function public.get_booking_fulfilment(profile_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'offers_mobile',p.offers_mobile_service,
    'travel_fee',p.mobile_service_fee,
    'business_address',p.business_address,
    'country_code',p.country_code,
    'deposit_required',p.country_code='GH',
    'phone',(select u.phone from public.users u where u.id=p.user_id)
  )
  from public.professional_profiles p where p.id=profile_id;
$$;
revoke all on function public.get_booking_fulfilment(uuid) from public, anon;
grant execute on function public.get_booking_fulfilment(uuid) to authenticated;
