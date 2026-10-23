-- Sheree's service fee rate moves from 7% to 5%. The cap is unchanged.
--
--   sheree_fee          = min(professional price × 5%, GH₵50)
--   customer_total      = professional price + sheree_fee
--   professional_payout = professional price
--
-- What this changes
-- -----------------
-- 1. The live value in `platform_financial_settings` — the row the app reads
--    through `get_service_fee_config()` and the one `calculate_booking_financials`
--    reads when a booking is created. Both the existing row and the column default
--    are moved, so an already-migrated database and a fresh one agree.
-- 2. Nothing else. The cap stays GH₵50, and no arithmetic changes: the fee is
--    still `min(price × rate, cap)` in one SQL function, one Deno module and one
--    app module.
--
-- History is untouched
-- --------------------
-- Every booking stores the rate and cap it was priced under (`sheree_fee_rate`,
-- `sheree_fee_cap`, `sheree_fee_amount`), and `reserve_booking_core` stamps the
-- CURRENT settings onto each NEW booking. So bookings taken at 7% keep 7% for
-- their fee, totals, refunds and payouts forever; only new bookings use 5%.
--
-- Where the cap now bites: 5% of GH₵1,000 is exactly GH₵50, so the cap starts to
-- apply at GH₵1,000 and above (it was GH₵714.28 at 7%).

insert into public.platform_financial_settings (id, service_fee_rate)
values (true, 0.0500)
on conflict (id) do update set service_fee_rate = excluded.service_fee_rate;

alter table public.platform_financial_settings
  alter column service_fee_rate set default 0.0500;

comment on column public.platform_financial_settings.service_fee_rate is
  'Sheree''s service fee rate applied on top of the professional''s price. 5% since 2026-09-23 (was 7%). The cap is service_fee_cap.';
