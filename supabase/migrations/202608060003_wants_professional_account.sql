-- Customers who picked "customer" in onboarding keep the Professional experience
-- locked until they opt in from Settings ("Start a professional account").
alter table public.users
  add column if not exists wants_professional_account boolean not null default false;
