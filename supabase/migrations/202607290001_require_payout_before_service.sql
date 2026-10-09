-- A client-side check improves the experience, but this trigger is the
-- authoritative rule for every insert path (mobile app, dashboard, or API).
create or replace function public.require_payout_account_for_service()
returns trigger
language plpgsql
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
