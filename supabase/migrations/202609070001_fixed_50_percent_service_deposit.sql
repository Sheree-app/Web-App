-- Standardize booking deposits at a fixed 50% of the service price.
-- The deposit is collected upfront by Sheree; Sheree's fee (10% of that
-- deposit) and the professional's payout are derived from it server-side.
-- Every service now collects 50% of its price at booking, so no service
-- carries a per-professional "Deposit (%)" rate anymore.

-- Normalize any existing services to the fixed deposit percentage.
update public.professional_services
   set deposit_percentage = 50
 where deposit_percentage is distinct from 50;

-- Default newly inserted services to 50% as well.
alter table public.professional_services
  alter column deposit_percentage set default 50;

-- Enforce the fixed rate at the database so no caller can store anything else.
alter table public.professional_services
  drop constraint if exists professional_services_deposit_percentage_check;

alter table public.professional_services
  add constraint professional_services_deposit_percentage_fixed_check
  check (deposit_percentage = 50);
