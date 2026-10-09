-- Sheree keeps 10% of the collected deposit; the remaining 90% of that
-- deposit is paid to the professional after completion.
create table public.professional_payout_accounts (
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

alter table public.payouts
  add column if not exists booking_id uuid references public.bookings(id) on delete restrict,
  add column if not exists payout_type text not null default 'completion' check (payout_type in ('completion','customer_cancellation')),
  add column if not exists deposit_amount numeric(10,2),
  add column if not exists platform_fee numeric(10,2),
  add column if not exists service_price numeric(10,2);

create unique index if not exists payouts_booking_unique_idx
  on public.payouts(booking_id)
  where booking_id is not null;

alter table public.payouts
  add constraint payouts_amounts_match_booking_check check (
    booking_id is null or (
      deposit_amount >= 0 and
      platform_fee >= 0 and
      service_price >= 0 and
      ((payout_type = 'completion' and amount = deposit_amount - platform_fee) or
       (payout_type = 'customer_cancellation' and amount = round(deposit_amount * 0.10, 2) and platform_fee = 0))
    )
  );

comment on column public.payouts.platform_fee is
  'Sheree commission: 10% of the collected booking deposit, deducted from that deposit.';

create table public.booking_cancellation_settlements (
  booking_id uuid primary key references public.bookings(id) on delete restrict,
  cancelled_by text not null check (cancelled_by in ('customer','professional')),
  deposit_amount numeric(10,2) not null check (deposit_amount >= 0),
  refund_amount numeric(10,2) not null check (refund_amount >= 0),
  professional_compensation numeric(10,2) not null check (professional_compensation >= 0),
  refund_status text not null default 'pending' check (refund_status in ('pending','processing','refunded','failed')),
  provider_refund_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (refund_amount + professional_compensation = deposit_amount),
  check ((cancelled_by = 'professional' and professional_compensation = 0) or cancelled_by = 'customer')
);
alter table public.booking_cancellation_settlements enable row level security;
revoke all on public.booking_cancellation_settlements from anon, authenticated;

-- Money movement notifications are created from ledger state, never from the app.
-- notify_user stores an in-app notification and sends Expo Push when a token exists.
create or replace function public.notify_payout_status() returns trigger language plpgsql security definer set search_path='' as $$
declare professional_user uuid; booking_service text; title text; body text;
begin
  if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
  select p.user_id,b.service_name into professional_user,booking_service
  from public.professional_profiles p left join public.bookings b on b.id=new.booking_id
  where p.id=new.professional_id;
  if professional_user is null then return new; end if;
  title:=case new.status
    when 'pending' then 'Payout account needed'
    when 'processing' then 'Payout is processing'
    when 'paid' then 'Money sent to your account'
    when 'failed' then 'Payout needs attention'
    when 'reversed' then 'Payout was returned'
    else 'Payout update' end;
  body:=case new.status
    when 'pending' then 'Connect a payout account to receive your GH₵'||to_char(new.amount,'FM999999990.00')||' cancellation payment.'
    when 'processing' then 'Paystack is sending GH₵'||to_char(new.amount,'FM999999990.00')||' for '||coalesce(booking_service,'your booking')||'.'
    when 'paid' then 'GH₵'||to_char(new.amount,'FM999999990.00')||' was sent for '||coalesce(booking_service,'your booking')||'.'
    when 'failed' then 'GH₵'||to_char(new.amount,'FM999999990.00')||' could not be sent. Open Sheree to check your payout details.'
    when 'reversed' then 'Paystack returned the GH₵'||to_char(new.amount,'FM999999990.00')||' transfer. Sheree will retry after review.'
    else 'Your payout status changed.' end;
  perform public.notify_user(professional_user,'payment',title,body,'/notifications',jsonb_build_object('bookingId',new.booking_id,'payoutId',new.id,'status',new.status,'amount',new.amount,'event','payout_status'),'professional');
  return new;
end $$;
drop trigger if exists notify_payout_status on public.payouts;
create trigger notify_payout_status after insert or update of status on public.payouts for each row execute function public.notify_payout_status();

create or replace function public.notify_refund_status() returns trigger language plpgsql security definer set search_path='' as $$
declare customer_user uuid; booking_service text; title text; body text;
begin
  if tg_op='UPDATE' and new.refund_status is not distinct from old.refund_status then return new; end if;
  select b.customer_id,b.service_name into customer_user,booking_service from public.bookings b where b.id=new.booking_id;
  if customer_user is null then return new; end if;
  title:=case new.refund_status
    when 'processing' then 'Refund is processing'
    when 'refunded' then 'Refund sent'
    when 'failed' then 'Refund needs attention'
    else 'Refund update' end;
  body:=case new.refund_status
    when 'processing' then 'Paystack is processing your GH₵'||to_char(new.refund_amount,'FM999999990.00')||' refund for '||booking_service||'.'
    when 'refunded' then 'Your GH₵'||to_char(new.refund_amount,'FM999999990.00')||' refund was sent. Your bank or Mobile Money provider may take time to display it.'
    when 'failed' then 'Your GH₵'||to_char(new.refund_amount,'FM999999990.00')||' refund could not be processed. Sheree will need to retry it.'
    else 'Your refund status changed.' end;
  perform public.notify_user(customer_user,'payment',title,body,'/bookings',jsonb_build_object('bookingId',new.booking_id,'status',new.refund_status,'amount',new.refund_amount,'event','refund_status'),'customer');
  return new;
end $$;
drop trigger if exists notify_refund_status on public.booking_cancellation_settlements;
create trigger notify_refund_status after insert or update of refund_status on public.booking_cancellation_settlements for each row execute function public.notify_refund_status();
comment on column public.professional_payout_accounts.paystack_transfer_recipient_code is
  'Server-managed Paystack transfer recipient used for completed-booking payouts.';
