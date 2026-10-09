-- The original payout migration was recorded on the hosted project without
-- this table being present. Recreate it idempotently so payout setup and
-- completed-booking transfers have a durable recipient record.
create table if not exists public.professional_payout_accounts (
  professional_id uuid primary key references public.professional_profiles(id) on delete cascade,
  paystack_transfer_recipient_code text not null unique,
  payout_method text not null check (payout_method in ('ghipss','mobile_money')),
  institution_name text not null,
  account_name text not null,
  account_last4 text not null check (account_last4 ~ '^[0-9]{4}$'),
  configured_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.professional_payout_accounts enable row level security;
revoke all on public.professional_payout_accounts from anon, authenticated;

comment on column public.professional_payout_accounts.paystack_transfer_recipient_code is
  'Server-managed Paystack transfer recipient used for completed-booking payouts.';
