-- `calculate_sheree_service_fee` is the single-fee helper the app and admin
-- tooling call. It only guarded against a NULL price, so a NEGATIVE price
-- produced a negative fee — a credit rather than a charge:
--
--   select public.calculate_sheree_service_fee(-120);   -- was: -8.40
--
-- Both JavaScript twins already clamp a non-positive price to a zero fee
-- (`calculateShereeFee` in supabase/functions/_shared/finance.ts and
-- `calculateBookingFinancials` in src/lib/finance.ts), and the database's own
-- `calculate_booking_financials` clamps by zeroing the price first. This
-- restores that same single rule here, so the app, the Edge Functions and SQL
-- cannot disagree:
--
--   fee = min(price × rate, cap)   and   price <= 0   →   fee = 0
--
-- `service_fee_cap` is constrained to be >= 0, so `least(0, cap)` is 0.

create or replace function public.calculate_sheree_service_fee(p_professional_price numeric)
returns numeric
language sql
stable
security definer
set search_path=''
as $$
  select least(
    round(
      (case when coalesce(p_professional_price, 0) > 0
        then p_professional_price else 0 end) * s.service_fee_rate,
      2
    ),
    s.service_fee_cap
  )
  from public.platform_financial_settings s
  where s.id;
$$;
revoke all on function public.calculate_sheree_service_fee(numeric) from public;
grant execute on function public.calculate_sheree_service_fee(numeric)
  to anon, authenticated;

comment on function public.calculate_sheree_service_fee(numeric) is
  'Sheree''s service fee for one professional price: min(price × rate, cap). A non-positive or NULL price yields 0, never a negative fee.';
