create or replace function public.get_my_location_travel_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'address',coalesce(p.business_address,p.location,''),
    'latitude',p.latitude,
    'longitude',p.longitude,
    'offers_mobile',p.offers_mobile_service,
    'travel_fee',p.mobile_service_fee
  )
  from public.professional_profiles p
  where p.user_id=(select auth.uid());
$$;

create or replace function public.save_my_location_travel_settings(
  address_value text,
  latitude_value double precision,
  longitude_value double precision,
  offers_mobile_value boolean,
  travel_fee_value numeric
) returns void language plpgsql security definer set search_path='' as $$
begin
  if nullif(trim(address_value),'') is null then raise exception 'Add the address customers should visit'; end if;
  if latitude_value not between -90 and 90 or longitude_value not between -180 and 180 then raise exception 'Choose a valid map location'; end if;
  if travel_fee_value < 0 or travel_fee_value > 100000 then raise exception 'Travel fee must be between GH₵0 and GH₵100,000'; end if;
  update public.professional_profiles set
    business_address=trim(address_value),location=trim(address_value),
    latitude=latitude_value,longitude=longitude_value,
    offers_mobile_service=offers_mobile_value,
    mobile_service_fee=case when offers_mobile_value then travel_fee_value else 0 end,
    updated_at=now()
  where user_id=(select auth.uid());
  if not found then raise exception 'Professional profile required'; end if;
end $$;

revoke all on function public.get_my_location_travel_settings() from public;
revoke all on function public.save_my_location_travel_settings(text,double precision,double precision,boolean,numeric) from public;
grant execute on function public.get_my_location_travel_settings() to authenticated;
grant execute on function public.save_my_location_travel_settings(text,double precision,double precision,boolean,numeric) to authenticated;
