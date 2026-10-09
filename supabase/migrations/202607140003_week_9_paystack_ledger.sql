-- Week 9: an immutable Paystack attempt ledger plus payout records.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  customer_id uuid not null references auth.users(id) on delete restrict,
  provider text not null default 'paystack' check (provider = 'paystack'),
  provider_reference text not null unique,
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'GHS' check (currency = 'GHS'),
  status public.payment_status not null default 'pending',
  channel text,
  gateway_response text,
  paid_at timestamptz,
  provider_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_booking_idx on public.payments(booking_id, created_at desc);
alter table public.payments enable row level security;
create policy "customers read their payments" on public.payments for select to authenticated using (customer_id = auth.uid());

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'GHS' check (currency = 'GHS'),
  status text not null default 'pending' check (status in ('pending','processing','paid','failed','reversed')),
  provider_reference text unique,
  failure_reason text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

alter table public.payouts enable row level security;
create policy "professionals read their payouts" on public.payouts for select to authenticated
using (exists (select 1 from public.professional_profiles p where p.id = professional_id and p.user_id = auth.uid()));

revoke all on public.payments, public.payouts from anon;
grant select on public.payments, public.payouts to authenticated;
