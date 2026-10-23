-- Messaging V1: bookings can be created from a conversation-only custom
-- service proposed in a price card.
--
-- Design notes:
--
-- 1. `conversation_price_cards` is the Postgres mirror of a Convex price card.
--    It exists so the *price* is validated by the RPC below instead of being
--    accepted from the client. Without it, any signed-in user could call the
--    booking RPC directly with an arbitrary price.
--
-- 2. The booking rules (notice period, booking window, working hours, time off,
--    breaks, daily cap, buffer-aware overlap) are NOT duplicated. They are
--    extracted into `reserve_booking_core`, and both the existing catalog path
--    and the new conversation path call it. Catalog bookings keep behaving
--    exactly as before.
--
-- 3. Nothing here creates a row in `professional_services`. A conversation
--    service can never appear on a public profile, in search, or in the
--    catalogue; the booking row is the durable business record.
--
-- 4. Internal helpers use `p_`-prefixed parameters. Past migrations in this
--    codebase repeatedly needed "fix ... ambiguity" follow-ups because
--    unqualified parameter names collided with column names; the prefix makes
--    that impossible here.

-- ---------------------------------------------------------------------------
-- 1. Bookings can now reference either a catalog service or a price card.
-- ---------------------------------------------------------------------------

alter table public.bookings alter column service_id drop not null;

alter table public.bookings
  add column if not exists source text not null default 'catalog'
    check (source in ('catalog', 'conversation')),
  add column if not exists price_card_id text,
  add column if not exists conversation_ref text,
  add column if not exists duration_minutes integer;

create index if not exists bookings_price_card_idx
  on public.bookings(price_card_id) where price_card_id is not null;

-- A conversation service must always be traceable back to its proposal.
alter table public.bookings
  drop constraint if exists bookings_conversation_source_check;
alter table public.bookings
  add constraint bookings_conversation_source_check
  check (
    (source = 'catalog' and service_id is not null and price_card_id is null)
    or (source = 'conversation' and price_card_id is not null)
  );

-- ---------------------------------------------------------------------------
-- 2. The price card mirror.
-- ---------------------------------------------------------------------------

create table if not exists public.conversation_price_cards (
  -- Mirrors the Convex `priceCards` document id.
  id text primary key,
  conversation_ref text not null,
  professional_user_id uuid not null references public.users(id) on delete cascade,
  customer_user_id uuid not null references public.users(id) on delete cascade,
  service_name text not null,
  description text,
  price numeric(10,2) not null check (price > 0),
  currency text not null default 'GHS',
  duration_minutes integer not null check (duration_minutes between 1 and 1440),
  status text not null default 'sent'
    check (status in ('draft','sent','booked','expired','cancelled')),
  booking_id uuid references public.bookings(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversation_price_cards_customer_idx
  on public.conversation_price_cards(customer_user_id, created_at desc);
create index if not exists conversation_price_cards_professional_idx
  on public.conversation_price_cards(professional_user_id, created_at desc);
create index if not exists conversation_price_cards_conversation_idx
  on public.conversation_price_cards(conversation_ref);

alter table public.conversation_price_cards enable row level security;

-- Participants may read the proposal that concerns them. Only the service role
-- (Convex) writes it, so no insert/update/delete policy is granted to clients —
-- a user cannot rewrite the price of a card they are about to book.
drop policy if exists "participants read own price cards" on public.conversation_price_cards;
create policy "participants read own price cards" on public.conversation_price_cards
  for select to authenticated
  using (
    customer_user_id = (select auth.uid())
    or professional_user_id = (select auth.uid())
  );

grant select on public.conversation_price_cards to authenticated;

drop trigger if exists conversation_price_cards_set_updated_at on public.conversation_price_cards;
create trigger conversation_price_cards_set_updated_at
  before update on public.conversation_price_cards
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. The shared booking engine (behaviour identical to the previous
--    reserve_booking body, parameterised so both entry points share it).
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

  insert into public.bookings(
    customer_id,professional_id,service_id,starts_at,ends_at,status,service_name,price,
    deposit_amount,balance_amount,payment_status,deposit_paid_at,notes,cancellation_policy,
    is_mobile_service,travel_fee,source,price_card_id,conversation_ref,duration_minutes
  ) values(
    p_customer,p_professional_id,p_service_id,p_starts_at,finish,
    case when coalesce(pref.approval_mode,'automatic')='manual'
      then 'requested'::public.booking_status else 'confirmed'::public.booking_status end,
    p_service_name,p_price,
    case when requires_deposit then round(p_price*p_deposit_percentage/100,2)+selected_travel_fee else 0 end,
    case when requires_deposit then round(p_price-(p_price*p_deposit_percentage/100),2) else p_price+selected_travel_fee end,
    'pending'::public.payment_status,null,nullif(trim(p_notes),''),p_cancellation_policy,
    p_mobile_service,selected_travel_fee,p_source,p_price_card_id,p_conversation_ref,p_duration_minutes
  ) returning id into booking_id;

  if not requires_deposit then
    update public.bookings set payment_status='paid',deposit_paid_at=now() where id=booking_id;
  end if;

  return booking_id;
end $$;

-- Internal only: clients must go through reserve_booking or
-- reserve_custom_booking, which are the functions that resolve and validate
-- their inputs.
revoke all on function public.reserve_booking_core(
  uuid,uuid,text,numeric,integer,numeric,text,boolean,numeric,text,
  timestamptz,text,boolean,text,text,text,uuid
) from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- 4. Existing catalog booking — same signature, same observable behaviour.
-- ---------------------------------------------------------------------------

create or replace function public.reserve_booking(
  service_id uuid,
  starts_at timestamptz,
  notes text default null,
  mobile_service boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare svc record;
begin
  select s.*,p.offers_mobile_service,p.mobile_service_fee,p.country_code,p.cancellation_policy
    into svc
    from public.professional_services s
    join public.professional_profiles p on p.id=s.professional_id
   where s.id=$1 and s.is_active;
  if svc.id is null then raise exception 'Service unavailable'; end if;

  return public.reserve_booking_core(
    svc.professional_id,svc.id,svc.name,svc.price,svc.duration_minutes,
    svc.deposit_percentage,svc.cancellation_policy,svc.offers_mobile_service,
    svc.mobile_service_fee,svc.country_code,$2,$3,$4,
    'catalog',null,null,(select auth.uid())
  );
end $$;

revoke all on function public.reserve_booking(uuid,timestamptz,text,boolean) from public,anon;
grant execute on function public.reserve_booking(uuid,timestamptz,text,boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Conversation-only booking. The price and duration come from the mirrored
--    price card, not from the caller.
-- ---------------------------------------------------------------------------

create or replace function public.reserve_custom_booking(
  price_card_id text,
  starts_at timestamptz,
  notes text default null,
  mobile_service boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  card record; prof record; customer uuid:=(select auth.uid()); held uuid;
begin
  if customer is null then raise exception 'Authentication required'; end if;

  select * into card from public.conversation_price_cards c where c.id=$1;
  if card.id is null then
    raise exception 'This price card is no longer available';
  end if;
  -- Authorisation is derived from the card's own relationship, never from the
  -- caller's current app mode.
  if card.customer_user_id<>customer then
    raise exception 'Only the customer on this price card can book it';
  end if;
  if card.status='cancelled' then
    raise exception 'This price card was withdrawn';
  end if;
  if card.status='booked' or exists(
       select 1 from public.bookings b
        where b.price_card_id=$1
          and b.status in('requested','confirmed')
          and (b.payment_status='paid' or b.created_at>now()-interval '15 minutes')
     ) then
    raise exception 'This price card has already been booked';
  end if;
  if card.expires_at is not null and card.expires_at<=now() then
    raise exception 'This price card has expired';
  end if;

  select p.* into prof from public.professional_profiles p
   where p.user_id=card.professional_user_id;
  if prof.id is null then
    raise exception 'This professional is no longer accepting bookings';
  end if;

  return public.reserve_booking_core(
    prof.id,
    null,
    card.service_name,
    card.price,
    card.duration_minutes,
    -- The platform deposit rate is fixed at 40% and enforced on
    -- professional_services by a check constraint and trigger; a conversation
    -- service has no row there, so the same policy is applied directly.
    40,
    prof.cancellation_policy,
    prof.offers_mobile_service,
    prof.mobile_service_fee,
    prof.country_code,
    $2,$3,$4,
    'conversation',$1,card.conversation_ref,customer
  );
end $$;

revoke all on function public.reserve_custom_booking(text,timestamptz,text,boolean) from public,anon;
grant execute on function public.reserve_custom_booking(text,timestamptz,text,boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Keep the mirror honest: a card is only "booked" once the deposit is paid,
--    so an abandoned payment does not strand a proposal.
-- ---------------------------------------------------------------------------

create or replace function public.sync_price_card_from_booking()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.price_card_id is null then return new; end if;

  if new.payment_status='paid' and new.status in ('requested','confirmed') then
    update public.conversation_price_cards
       set status='booked', booking_id=new.id, updated_at=now()
     where id=new.price_card_id and status<>'booked';
  elsif new.status='cancelled' and new.payment_status in ('failed','pending') then
    -- The hold was released; the proposal becomes available again.
    update public.conversation_price_cards
       set booking_id=null, updated_at=now()
     where id=new.price_card_id and status='sent';
  end if;

  return new;
end $$;

revoke all on function public.sync_price_card_from_booking() from public,anon,authenticated;

drop trigger if exists bookings_sync_price_card on public.bookings;
create trigger bookings_sync_price_card
  after insert or update of payment_status, status on public.bookings
  for each row execute function public.sync_price_card_from_booking();

-- ---------------------------------------------------------------------------
-- 7. Slot availability for a conversation service.
--
--    `get_booking_availability` is intentionally not replaced: its body counts
--    bookings per day and never reads the service row, so a conversation
--    service can reuse it by passing a null service_id. Only the slot list
--    depends on duration, so that is the one function that needs a variant.
-- ---------------------------------------------------------------------------

create or replace function public.get_booking_slots_custom(
  p_profile_id uuid,
  p_duration_minutes integer,
  p_booking_date date
) returns table(slot_time text,is_available boolean,unavailable_reason text)
language sql stable security definer set search_path='' as $$
with settings as (
  select p_profile_id professional_id,
         greatest(coalesce(p_duration_minutes,60),1) duration_minutes,
         coalesce(pref.buffer_minutes,15) buffer_minutes,
         coalesce(pref.minimum_notice_hours,1) minimum_notice_hours,
         coalesce(pref.max_appointments_per_day,8) max_per_day,
         h.opens_at,h.closes_at,h.is_closed
    from (select 1) anchor
    left join public.professional_schedule_preferences pref
      on pref.professional_id=p_profile_id
    left join public.professional_working_hours h
      on h.professional_id=p_profile_id
     and h.day_of_week=extract(dow from p_booking_date)
), candidates as (
  select candidate local_start,
         candidate+make_interval(mins=>settings.duration_minutes) local_finish,
         settings.*
    from settings
    cross join lateral generate_series(
      p_booking_date+settings.opens_at,
      p_booking_date+settings.closes_at-make_interval(mins=>settings.duration_minutes),
      interval '30 minutes'
    ) candidate
   where not coalesce(settings.is_closed,true)
), slots as (
  select i.*,
         i.local_start at time zone 'Africa/Accra' starts_at,
         i.local_finish at time zone 'Africa/Accra' ends_at
    from candidates i
), states as (
  select i.*,
    i.starts_at<=now()+make_interval(hours=>i.minimum_notice_hours) notice_short,
    exists(select 1 from public.bookings b
            where b.professional_id=i.professional_id
              and b.status in('requested','confirmed') and b.payment_status='paid'
              and tstzrange(b.starts_at,b.ends_at,'[)')
                  &&tstzrange(i.starts_at-make_interval(mins=>i.buffer_minutes),
                              i.ends_at+make_interval(mins=>i.buffer_minutes),'[)')) booked,
    exists(select 1 from public.professional_schedule_blocks b
            where b.professional_id=i.professional_id
              and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(i.starts_at,i.ends_at,'[)')) blocked,
    exists(select 1 from public.professional_schedule_breaks b
            where b.professional_id=i.professional_id
              and b.day_of_week=extract(dow from p_booking_date)
              and tsrange(i.local_start,i.local_finish,'[)')
                  &&tsrange(p_booking_date+b.starts_at,p_booking_date+b.ends_at,'[)')) on_break,
    (select count(*) from public.bookings b
      where b.professional_id=i.professional_id
        and b.status in('requested','confirmed') and b.payment_status='paid'
        and timezone('Africa/Accra',b.starts_at)::date=p_booking_date)>=i.max_per_day day_full
    from slots i where i.starts_at>now()
)
select to_char(local_start,'HH24:MI'),
       not(notice_short or booked or blocked or on_break or day_full),
       case when notice_short then '1 hour notice'
            when booked then 'Booked'
            when day_full then 'Day full'
            when on_break then 'Break'
            when blocked then 'Unavailable'
            else null end
  from states order by local_start;
$$;

revoke all on function public.get_booking_slots_custom(uuid,integer,date) from public,anon;
grant execute on function public.get_booking_slots_custom(uuid,integer,date) to authenticated;
