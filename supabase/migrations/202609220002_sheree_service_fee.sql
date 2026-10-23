-- Sheree's service fee: the professional sets the price they want to earn, and
-- Sheree adds 7% (capped at GH₵50) to the CUSTOMER's price.
--
--   sheree_fee          = min(professional price × 7%, GH₵50)
--   customer_total      = professional price + sheree_fee
--   professional_payout = professional price
--
-- What this migration changes, and why
-- ------------------------------------
-- 1. The fee is no longer deducted from the professional. The old model took a
--    flat 10% of the collected deposit out of the professional's Paystack split
--    (`transaction_charge`) and recorded it as `payouts.platform_fee`. Now the
--    customer pays the deposit PLUS the fee, Sheree keeps the fee, and the
--    professional's subaccount receives the whole deposit.
-- 2. Sheree still only collects the 40% deposit through Paystack; the balance is
--    paid to the professional after the appointment. The fee is collected in
--    full with the deposit, once. The professional nets their full listed price
--    across both halves, so nothing is ever subtracted from them.
-- 3. Every booking stores a snapshot of the fee values actually used, so a later
--    rate/cap change can never rewrite history. Historical rows keep NULL
--    snapshots and their original amounts — nothing is recalculated, and the
--    legacy ledger shape stays valid (see the `fee_model` column below).
--
-- Rounding: `round(numeric, 2)` in Postgres rounds half away from zero, which is
-- exactly what `divideRoundHalfUp()` in src/lib/finance.ts does, so the database
-- and the app always agree to the pesewa.

-- ---------------------------------------------------------------------------
-- 1. Configuration. The rate and cap live in one row so they are never
--    hard-coded in more than a single default.
-- ---------------------------------------------------------------------------

create table if not exists public.platform_financial_settings (
  -- Single-row table: the check constraint makes a second row impossible.
  id boolean primary key default true check (id),
  currency text not null default 'GHS' check (currency = 'GHS'),
  service_fee_rate numeric(6,4) not null default 0.0700
    check (service_fee_rate >= 0 and service_fee_rate <= 1),
  service_fee_cap numeric(10,2) not null default 50.00
    check (service_fee_cap >= 0),
  -- Cancellation policy for the fee. Defaults preserve the previous economics:
  -- Sheree earned nothing when a customer cancelled, so the fee is handed back
  -- with the deposit refund. Flip these to retain the fee instead; no code or
  -- data migration is needed.
  refund_fee_on_customer_cancellation boolean not null default true,
  refund_fee_on_professional_cancellation boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.platform_financial_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.platform_financial_settings enable row level security;
revoke all on public.platform_financial_settings from anon, authenticated;

drop trigger if exists platform_financial_settings_set_updated_at
  on public.platform_financial_settings;
create trigger platform_financial_settings_set_updated_at
  before update on public.platform_financial_settings
  for each row execute function public.set_updated_at();

comment on table public.platform_financial_settings is
  'Single row holding Sheree''s live service fee rate and cap. Read through get_service_fee_config().';

-- Clients only ever read the configuration through this function, so the table
-- stays server-managed while the app can still show the exact fee it will be
-- charged. Readable by anon because service prices are public.
create or replace function public.get_service_fee_config()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'service_fee_rate', s.service_fee_rate,
    'service_fee_cap', s.service_fee_cap,
    'currency', s.currency,
    'refund_fee_on_customer_cancellation', s.refund_fee_on_customer_cancellation,
    'refund_fee_on_professional_cancellation', s.refund_fee_on_professional_cancellation
  )
  from public.platform_financial_settings s
  where s.id;
$$;
revoke all on function public.get_service_fee_config() from public;
grant execute on function public.get_service_fee_config() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The single calculation. Everything else calls this.
-- ---------------------------------------------------------------------------

create or replace function public.calculate_sheree_service_fee(p_professional_price numeric)
returns numeric
language sql
stable
security definer
set search_path=''
as $$
  select least(
    round(coalesce(p_professional_price, 0) * s.service_fee_rate, 2),
    s.service_fee_cap
  )
  from public.platform_financial_settings s
  where s.id;
$$;
revoke all on function public.calculate_sheree_service_fee(numeric) from public;
grant execute on function public.calculate_sheree_service_fee(numeric)
  to anon, authenticated;

-- Returns the full snapshot for one professional price. Amounts are cedis
-- (numeric(10,2)) to match bookings.price/deposit_amount.
create or replace function public.calculate_booking_financials(p_professional_price numeric)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  with settings as (
    select s.* from public.platform_financial_settings s where s.id
  ), priced as (
    select
      settings.currency,
      settings.service_fee_rate,
      settings.service_fee_cap,
      case when coalesce(p_professional_price, 0) > 0
        then round(p_professional_price, 2) else 0 end as professional_price
    from settings
  ), fees as (
    select
      priced.*,
      least(
        round(priced.professional_price * priced.service_fee_rate, 2),
        priced.service_fee_cap
      ) as sheree_fee
    from priced
  )
  select jsonb_build_object(
    'professional_price', fees.professional_price,
    'fee_rate', fees.service_fee_rate,
    'fee_cap', fees.service_fee_cap,
    'sheree_fee', fees.sheree_fee,
    'customer_total', fees.professional_price + fees.sheree_fee,
    'professional_payout', fees.professional_price,
    'currency', fees.currency
  )
  from fees;
$$;
revoke all on function public.calculate_booking_financials(numeric) from public;
grant execute on function public.calculate_booking_financials(numeric)
  to anon, authenticated;

-- The one calculation. `reserve_booking_core` calls it so every booking stores
-- the fee it was actually charged under, which is what keeps history intact when
-- the rate or cap changes later.
comment on function public.calculate_booking_financials(numeric) is
  'The one place Sheree''s service fee is calculated: sheree_fee = min(price × rate, cap), customer_total = price + fee, professional_payout = price.';

-- ---------------------------------------------------------------------------
-- 3. Booking snapshot columns.
--
-- `bookings.price` IS the professional's listed price (it has always been stored
-- un-inflated) — the 7% fee is a transaction-level calculation, never part of
-- the service price, so a later fee change cannot rewrite what the professional
-- asked for.
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists sheree_fee_rate numeric(6,4),
  add column if not exists sheree_fee_cap numeric(10,2),
  add column if not exists sheree_fee_amount numeric(10,2),
  add column if not exists customer_total numeric(10,2),
  add column if not exists professional_payout numeric(10,2),
  add column if not exists currency text not null default 'GHS',
  add column if not exists payout_status text not null default 'none';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_payout_status_check'
  ) then
    alter table public.bookings
      add constraint bookings_payout_status_check
      check (payout_status in ('none','pending','processing','paid','failed','reversed'));
  end if;
end $$;

comment on column public.bookings.price is
  'The professional''s listed price — the amount they want to earn. Never inflated by Sheree''s fee.';
comment on column public.bookings.sheree_fee_rate is
  'Snapshot of Sheree''s service fee rate used for this booking (e.g. 0.0700). NULL on bookings created before the customer-paid fee model.';
comment on column public.bookings.sheree_fee_cap is
  'Snapshot of Sheree''s service fee cap in cedis used for this booking (e.g. 50.00).';
comment on column public.bookings.sheree_fee_amount is
  'Sheree''s service fee for this booking, in cedis. Added to the customer''s price and collected with the deposit; never deducted from the professional.';
comment on column public.bookings.customer_total is
  'Service price + Sheree fee, in cedis (excludes the professional''s mobile travel fee, which passes through in full).';
comment on column public.bookings.professional_payout is
  'What the professional receives for the service, in cedis. Always their listed price.';
comment on column public.bookings.payout_status is
  'Mirror of the latest payouts.status for this booking, kept in step by sync_booking_payout_status(). ''none'' means no payout is due yet.';

-- Payout status has exactly one source of truth (`payouts`), mirrored here so a
-- booking can be reconciled without joining the ledger.
create or replace function public.sync_booking_payout_status()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.booking_id is null then return new; end if;
  update public.bookings
     set payout_status = new.status
   where id = new.booking_id
     and payout_status is distinct from new.status;
  return new;
end $$;
revoke all on function public.sync_booking_payout_status() from public, anon, authenticated;

drop trigger if exists payouts_sync_booking_payout_status on public.payouts;
create trigger payouts_sync_booking_payout_status
  after insert or update of status on public.payouts
  for each row execute function public.sync_booking_payout_status();

-- ---------------------------------------------------------------------------
-- 4. Reserve a booking with the snapshot stamped in by the server.
--
-- The price, deposit rate and fee all come from database rows, so a client can
-- never influence any of the stored financial values.
-- ---------------------------------------------------------------------------

create or replace function public.reserve_booking_core(
  p_professional_id uuid,
  p_service_id uuid,
  p_service_name text,
  p_price numeric,
  p_duration_minutes integer,
  p_deposit_percentage numeric,
  p_cancellation_policy text,
  p_offers_mobile boolean,
  p_mobile_fee numeric,
  p_country_code text,
  p_starts_at timestamptz,
  p_notes text,
  p_mobile_service boolean,
  p_source text,
  p_price_card_id text,
  p_conversation_ref text,
  p_customer uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  pref record; hours record; booking_id uuid; finish timestamptz;
  buffered_start timestamptz; buffered_finish timestamptz;
  local_start timestamp; local_finish timestamp;
  selected_travel_fee numeric(10,2):=0; requires_deposit boolean;
  professional_price numeric(10,2);
  financials jsonb;
  service_deposit numeric(10,2);
begin
  if p_customer is null then raise exception 'Authentication required'; end if;

  if p_mobile_service and not coalesce(p_offers_mobile,false) then
    raise exception 'Mobile service is unavailable';
  end if;
  if p_mobile_service then selected_travel_fee:=coalesce(p_mobile_fee,0); end if;

  -- Paystack deposits are currently a Ghana-only booking policy.
  requires_deposit:=coalesce(p_country_code,'GH')='GH';

  -- Idempotency: a retried confirm inside the hold window returns the booking
  -- that is already in flight rather than creating a second one.
  select b.id into booking_id
    from public.bookings b
   where b.customer_id=p_customer
     and b.starts_at=p_starts_at
     and (
       (p_service_id is not null and b.service_id=p_service_id)
       or (p_price_card_id is not null and b.price_card_id=p_price_card_id)
     )
     and (
       (requires_deposit and b.payment_status='pending' and b.created_at>now()-interval '15 minutes')
       or (not requires_deposit and b.payment_status='paid')
     )
   order by b.created_at desc limit 1;
  if booking_id is not null then return booking_id; end if;

  select * into pref from public.professional_schedule_preferences p
   where p.professional_id=p_professional_id;

  local_start:=timezone('Africa/Accra',p_starts_at);
  finish:=p_starts_at+make_interval(mins=>p_duration_minutes);
  local_finish:=timezone('Africa/Accra',finish);

  if p_starts_at<=now()+make_interval(hours=>coalesce(pref.minimum_notice_hours,2)) then
    raise exception 'This time is too close to book';
  end if;
  if p_starts_at>now()+make_interval(days=>coalesce(pref.booking_window_days,60)) then
    raise exception 'This date is outside the booking window';
  end if;

  select * into hours from public.professional_working_hours h
   where h.professional_id=p_professional_id
     and h.day_of_week=extract(dow from local_start);
  if hours.id is null or hours.is_closed
     or local_start::time<hours.opens_at or local_finish::time>hours.closes_at then
    raise exception 'Outside working hours';
  end if;

  if exists(select 1 from public.professional_time_off t
             where t.professional_id=p_professional_id
               and tstzrange(t.starts_at,t.ends_at,'[)')&&tstzrange(p_starts_at,finish,'[)')) then
    raise exception 'Professional is away at that time';
  end if;

  if exists(select 1 from public.professional_schedule_breaks b
             where b.professional_id=p_professional_id
               and b.day_of_week=extract(dow from local_start)
               and tsrange(local_start,local_finish,'[)')
                   &&tsrange(local_start::date+b.starts_at,local_start::date+b.ends_at,'[)')) then
    raise exception 'That time overlaps a scheduled break';
  end if;

  if (select count(*) from public.bookings b
       where b.professional_id=p_professional_id
         and (b.payment_status='paid' or b.created_at>now()-interval '15 minutes')
         and timezone('Africa/Accra',b.starts_at)::date=local_start::date
         and b.status in('requested','confirmed'))>=coalesce(pref.max_appointments_per_day,8) then
    raise exception 'That day is fully booked';
  end if;

  buffered_start:=p_starts_at-make_interval(mins=>coalesce(pref.buffer_minutes,15));
  buffered_finish:=finish+make_interval(mins=>coalesce(pref.buffer_minutes,15));
  if exists(select 1 from public.bookings b
             where b.professional_id=p_professional_id
               and b.status in('requested','confirmed')
               and (b.payment_status='paid' or b.created_at>now()-interval '15 minutes')
               and tstzrange(b.starts_at,b.ends_at,'[)')
                   &&tstzrange(buffered_start,buffered_finish,'[)')) then
    raise exception 'That time was just booked';
  end if;

  -- Server-side money: the fee and the collected deposit are computed here, from
  -- the service row and the platform settings, never from the caller.
  professional_price:=round(coalesce(p_price,0),2);
  financials:=public.calculate_booking_financials(professional_price);
  service_deposit:=round(professional_price*p_deposit_percentage/100,2);

  insert into public.bookings(
    customer_id,professional_id,service_id,starts_at,ends_at,status,service_name,price,
    deposit_amount,balance_amount,payment_status,deposit_paid_at,notes,cancellation_policy,
    is_mobile_service,travel_fee,source,price_card_id,conversation_ref,duration_minutes,
    sheree_fee_rate,sheree_fee_cap,sheree_fee_amount,customer_total,professional_payout,currency
  ) values(
    p_customer,p_professional_id,p_service_id,p_starts_at,finish,
    case when coalesce(pref.approval_mode,'automatic')='manual'
      then 'requested'::public.booking_status else 'confirmed'::public.booking_status end,
    p_service_name,professional_price,
    -- The professional's upfront share: their 40% deposit plus any travel fee,
    -- and this is what their Paystack subaccount receives in full.
    case when requires_deposit then service_deposit+selected_travel_fee else 0 end,
    case when requires_deposit then round(professional_price-service_deposit,2) else professional_price+selected_travel_fee end,
    'pending'::public.payment_status,null,nullif(trim(p_notes),''),p_cancellation_policy,
    p_mobile_service,selected_travel_fee,p_source,p_price_card_id,p_conversation_ref,p_duration_minutes,
    (financials->>'fee_rate')::numeric,
    (financials->>'fee_cap')::numeric,
    (financials->>'sheree_fee')::numeric,
    (financials->>'customer_total')::numeric + selected_travel_fee,
    (financials->>'professional_payout')::numeric,
    financials->>'currency'
  ) returning id into booking_id;

  if not requires_deposit then
    update public.bookings set payment_status='paid',deposit_paid_at=now() where id=booking_id;
  end if;

  return booking_id;
end $$;

revoke all on function public.reserve_booking_core(
  uuid,uuid,text,numeric,integer,numeric,text,boolean,numeric,text,
  timestamptz,text,boolean,text,text,text,uuid
) from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- 5. Payout ledger.
--
-- `fee_model` records which economics a payout row was booked under, so the
-- existing rows keep their original shape while new rows follow the new model:
--   legacy            amount = deposit − platform_fee   (Sheree deducted 10%)
--   customer_paid_fee amount = deposit                 (Sheree's fee is paid by
--                                                      the customer instead, so
--                                                      the professional receives
--                                                      the whole deposit)
-- ---------------------------------------------------------------------------

alter table public.payouts
  add column if not exists fee_model text not null default 'legacy';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payouts'::regclass
      and conname = 'payouts_fee_model_check'
  ) then
    alter table public.payouts
      add constraint payouts_fee_model_check
      check (fee_model in ('legacy','customer_paid_fee'));
  end if;
end $$;

comment on column public.payouts.fee_model is
  'Which Sheree fee model this payout was booked under: legacy (fee deducted from the deposit) or customer_paid_fee (fee paid by the customer, professional receives the full deposit).';
comment on column public.payouts.platform_fee is
  'Under legacy: Sheree''s cut of the deposit (deducted). Under customer_paid_fee: Sheree''s service fee for the booking (paid by the customer, not deducted from this payout).';

alter table public.payouts drop constraint if exists payouts_amounts_match_booking_check;
alter table public.payouts add constraint payouts_amounts_match_booking_check check (
  booking_id is null or (
    deposit_amount >= 0 and
    platform_fee >= 0 and
    service_price >= 0 and
    case payout_type
      when 'completion' then
        amount = case fee_model
          when 'customer_paid_fee' then deposit_amount
          else deposit_amount - platform_fee
        end
      else
        amount = round(deposit_amount * 0.10, 2) and platform_fee = 0
    end
  )
);

-- ---------------------------------------------------------------------------
-- 6. Cancellation settlement.
--
-- `sheree_fee_refunded` records how much of the Sheree fee went back to the
-- customer, so the balances still close:
--   refund_amount + professional_compensation = deposit_amount + sheree_fee_refunded
-- Historical rows leave it NULL and keep their original identity.
-- ---------------------------------------------------------------------------

alter table public.booking_cancellation_settlements
  add column if not exists sheree_fee_refunded numeric(10,2)
    check (sheree_fee_refunded >= 0);

comment on column public.booking_cancellation_settlements.deposit_amount is
  'The booking''s service deposit (what Sheree collected for the professional), in cedis.';
comment on column public.booking_cancellation_settlements.sheree_fee_refunded is
  'Sheree''s service fee returned to the customer as part of this cancellation. NULL on historical settlements.';

-- The original sum check is auto-named by Postgres, so drop it by shape rather
-- than guessing its name, then restate it in its new form.
do $$
declare target record;
begin
  for target in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'booking_cancellation_settlements'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%refund_amount%professional_compensation%'
  loop
    execute format(
      'alter table public.booking_cancellation_settlements drop constraint %I',
      target.conname
    );
  end loop;
end $$;

alter table public.booking_cancellation_settlements
  add constraint booking_cancellation_settlements_amounts_check check (
    refund_amount + professional_compensation
      = deposit_amount + coalesce(sheree_fee_refunded, 0)
  );

-- ---------------------------------------------------------------------------
-- 7. Payment ledger.
--
-- `amount` is what the customer was actually charged. Under the new model that
-- is deposit + Sheree fee. `platform_fee` records how much of that charge was
-- Sheree's fee (NULL on historical payments, where no fee was charged on top).
-- ---------------------------------------------------------------------------

alter table public.payments
  add column if not exists platform_fee numeric(10,2) check (platform_fee >= 0);

comment on column public.payments.amount is
  'The amount the customer was charged, in cedis (deposit + Sheree service fee under the customer-paid fee model).';
comment on column public.payments.platform_fee is
  'Sheree''s service fee included in amount. NULL for payments collected before the customer-paid fee model.';

-- ---------------------------------------------------------------------------
-- 8. Refund reconciliation helper. Every completed payment can now be reported
--    as: professional service amount · Sheree fee · customer payment ·
--    professional payout · Paystack fee · Sheree net revenue.
-- ---------------------------------------------------------------------------

create or replace function public.get_booking_financial_reconciliation(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  with booking as (
    select b.* from public.bookings b where b.id = p_booking_id
  ), payment as (
    select p.amount, p.platform_fee, p.status, p.provider_payload
      from public.payments p
     where p.booking_id = p_booking_id
     order by p.created_at desc
     limit 1
  )
  select jsonb_build_object(
    'booking_id', booking.id,
    'professional_price', booking.price,
    'professional_price_pesewas', round(booking.price * 100)::bigint,
    'fee_rate', booking.sheree_fee_rate,
    'fee_cap', booking.sheree_fee_cap,
    'sheree_fee', coalesce(booking.sheree_fee_amount, 0),
    'sheree_fee_pesewas', round(coalesce(booking.sheree_fee_amount, 0) * 100)::bigint,
    'customer_total', coalesce(booking.customer_total, booking.price),
    'professional_payout', coalesce(booking.professional_payout, booking.price),
    'deposit_collected', booking.deposit_amount,
    'amount_charged', payment.amount,
    'customer_payment', payment.amount,
    'paystack_fee', coalesce(nullif(payment.provider_payload->'data'->>'fees','')::numeric, 0) / 100,
    'sheree_net_revenue',
      coalesce(booking.sheree_fee_amount, 0)
      - coalesce(nullif(payment.provider_payload->'data'->>'fees','')::numeric, 0) / 100,
    'currency', booking.currency,
    'payment_status', booking.payment_status,
    'payout_status', booking.payout_status,
    'payment_recorded', payment.status
  )
  from booking
  left join payment on true;
$$;
revoke all on function public.get_booking_financial_reconciliation(uuid) from public, anon, authenticated;

comment on function public.get_booking_financial_reconciliation(uuid) is
  'Admin/support reconciliation for one booking: professional price, Sheree fee, customer payment, professional payout, Paystack fee and Sheree net revenue.';
