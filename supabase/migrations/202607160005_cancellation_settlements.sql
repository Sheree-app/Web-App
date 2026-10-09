-- Incremental deployment for cancellation accounting added after migration 004
-- had already been applied to production.
alter table public.payouts
  add column if not exists payout_type text not null default 'completion'
  check (payout_type in ('completion','customer_cancellation'));

alter table public.payouts drop constraint if exists payouts_amounts_match_booking_check;
alter table public.payouts add constraint payouts_amounts_match_booking_check check (
  booking_id is null or (
    deposit_amount >= 0 and platform_fee >= 0 and service_price >= 0 and
    ((payout_type='completion' and amount=deposit_amount-platform_fee) or
     (payout_type='customer_cancellation' and amount=round(deposit_amount*0.10,2) and platform_fee=0))
  )
);

create table if not exists public.booking_cancellation_settlements (
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
  check ((cancelled_by='professional' and professional_compensation=0) or cancelled_by='customer')
);
alter table public.booking_cancellation_settlements enable row level security;
revoke all on public.booking_cancellation_settlements from anon,authenticated;

create or replace function public.notify_payout_status() returns trigger language plpgsql security definer set search_path='' as $$
declare uid uuid; service text; title text; body text;
begin
 if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
 select p.user_id,b.service_name into uid,service from public.professional_profiles p left join public.bookings b on b.id=new.booking_id where p.id=new.professional_id;
 if uid is null then return new; end if;
 title:=case new.status when 'pending' then 'Payout account needed' when 'processing' then 'Payout is processing' when 'paid' then 'Money sent to your account' when 'failed' then 'Payout needs attention' when 'reversed' then 'Payout was returned' else 'Payout update' end;
 body:='GH₵'||to_char(new.amount,'FM999999990.00')||case new.status when 'paid' then ' was sent for ' when 'processing' then ' is being sent for ' when 'failed' then ' could not be sent for ' else ' payout update for ' end||coalesce(service,'your booking')||'.';
 perform public.notify_user(uid,'payment',title,body,'/notifications',jsonb_build_object('bookingId',new.booking_id,'payoutId',new.id,'status',new.status,'amount',new.amount,'event','payout_status'),'professional');
 return new;
end $$;
drop trigger if exists notify_payout_status on public.payouts;
create trigger notify_payout_status after insert or update of status on public.payouts for each row execute function public.notify_payout_status();

create or replace function public.notify_refund_status() returns trigger language plpgsql security definer set search_path='' as $$
declare uid uuid; service text; title text; body text;
begin
 if tg_op='UPDATE' and new.refund_status is not distinct from old.refund_status then return new; end if;
 select customer_id,service_name into uid,service from public.bookings where id=new.booking_id;
 if uid is null then return new; end if;
 title:=case new.refund_status when 'processing' then 'Refund is processing' when 'refunded' then 'Refund sent' when 'failed' then 'Refund needs attention' else 'Refund update' end;
 body:='Your GH₵'||to_char(new.refund_amount,'FM999999990.00')||case new.refund_status when 'refunded' then ' refund was sent for ' when 'processing' then ' refund is processing for ' when 'failed' then ' refund could not be processed for ' else ' refund changed for ' end||service||'.';
 perform public.notify_user(uid,'payment',title,body,'/bookings',jsonb_build_object('bookingId',new.booking_id,'status',new.refund_status,'amount',new.refund_amount,'event','refund_status'),'customer');
 return new;
end $$;
drop trigger if exists notify_refund_status on public.booking_cancellation_settlements;
create trigger notify_refund_status after insert or update of refund_status on public.booking_cancellation_settlements for each row execute function public.notify_refund_status();
