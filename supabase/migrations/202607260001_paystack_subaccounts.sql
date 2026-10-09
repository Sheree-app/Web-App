-- Split booking deposits directly between Sheree and each professional.
-- Keep the legacy recipient column nullable so existing rows can migrate when
-- the professional next saves their payout account.
alter table public.professional_payout_accounts
  add column if not exists paystack_subaccount_code text unique;

alter table public.professional_payout_accounts
  alter column paystack_transfer_recipient_code drop not null;

comment on column public.professional_payout_accounts.paystack_subaccount_code is
  'Paystack subaccount used to split booking deposits at transaction initialization.';

comment on column public.professional_payout_accounts.paystack_transfer_recipient_code is
  'Legacy transfer recipient retained during migration to Paystack subaccounts.';
