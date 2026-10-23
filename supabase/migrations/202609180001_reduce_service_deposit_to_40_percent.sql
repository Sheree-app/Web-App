-- Reduce the standard upfront booking deposit from 50% to 40% of the service price.
-- Sheree still collects the deposit upfront; Sheree's fee (10% of the collected
-- deposit) and the professional's payout are derived from it server-side.
-- Every booking computes its deposit_amount from professional_services.deposit_percentage
-- (reserve_booking, reschedule_booking) and Paystack charges the stored
-- bookings.deposit_amount, so this column is the single place the rate lives.

-- Drop the 50% pin first: it would reject the backfill below.
alter table public.professional_services
  drop constraint if exists professional_services_deposit_percentage_fixed_check;

-- Normalize any existing services to the new fixed deposit percentage.
update public.professional_services
   set deposit_percentage = 40
 where deposit_percentage is distinct from 40;

-- Default newly inserted services to 40% as well.
alter table public.professional_services
  alter column deposit_percentage set default 40;

-- Enforce the fixed rate at the database so no caller can store anything else.
alter table public.professional_services
  add constraint professional_services_deposit_percentage_fixed_check
  check (deposit_percentage = 40);

-- A released build still sends 50 when a professional saves a service, which would
-- now fail the constraint above. The rate is a platform policy rather than a
-- per-service choice, so stamp it server-side and let every client version
-- converge on the fixed rate instead of erroring.
create or replace function public.fix_service_deposit_percentage() returns trigger
language plpgsql set search_path='' as $$
begin
  new.deposit_percentage := 40;
  return new;
end $$;

drop trigger if exists services_fix_deposit_percentage on public.professional_services;
create trigger services_fix_deposit_percentage
  before insert or update on public.professional_services
  for each row execute function public.fix_service_deposit_percentage();
