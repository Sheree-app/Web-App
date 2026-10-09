-- Include the profile-owned cancellation policy in reserve_booking's svc record.
-- Rebuild the current function definition in place to preserve all booking rules.
do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.reserve_booking(uuid,timestamptz,text,boolean)'::regprocedure)
    into definition;

  if position('p.cancellation_policy' in definition) = 0 then
    definition := replace(
      definition,
      'p.offers_mobile_service,p.mobile_service_fee into svc',
      'p.offers_mobile_service,p.mobile_service_fee,p.cancellation_policy into svc'
    );
  end if;

  if position('p.cancellation_policy' in definition) = 0 then
    raise exception 'reserve_booking definition did not contain the expected service query';
  end if;

  execute definition;
end $$;
