-- Paystack references are assigned and confirmed only by trusted Edge Functions.
alter table public.bookings
  add column paystack_reference text unique,
  add column deposit_paid_at timestamptz;

create index bookings_unpaid_idx on public.bookings(created_at)
  where payment_status = 'pending';
