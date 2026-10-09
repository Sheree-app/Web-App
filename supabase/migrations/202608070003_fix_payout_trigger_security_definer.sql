-- Fix "permission denied for table professional_payout_accounts" when creating a
-- service.
--
-- require_payout_account_for_service() runs as a BEFORE INSERT trigger on
-- professional_services. It was defined as SECURITY INVOKER (the default), so
-- when an authenticated professional inserts a service, the trigger's read of
-- public.professional_payout_accounts executes with the caller's privileges.
-- That table deliberately revokes all access from anon,authenticated and has no
-- RLS read policy for authenticated, so the insert failed with SQLSTATE 42501.
--
-- The trigger is an internal authorization check, not a user-facing query, so
-- it should run with the privileges of its owner. It already fully qualifies
-- every table and pins search_path='', so making it SECURITY DEFINER is safe.

create or replace function public.require_payout_account_for_service()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  -- Outside Ghana, Sheree does not collect a deposit, so there is no
  -- platform-held money to settle through a payout account.
  if exists (
    select 1 from public.professional_profiles profile
    where profile.id=new.professional_id and profile.country_code<>'GH'
  ) then
    return new;
  end if;
  if not exists (
    select 1
    from public.professional_payout_accounts payout
    where payout.professional_id=new.professional_id
      and payout.paystack_subaccount_code is not null
  ) then
    raise exception using
      errcode='23514',
      message='Connect a payout account before adding a service.';
  end if;
  return new;
end
$$;

drop trigger if exists require_payout_account_for_service on public.professional_services;
create trigger require_payout_account_for_service
before insert on public.professional_services
for each row execute function public.require_payout_account_for_service();
