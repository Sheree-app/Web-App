-- Payouts are earned when an appointment completes, but Paystack settles each
-- professional's share to their subaccount on a batched schedule. Until now a
-- completion payout was written as 'paid' immediately, so the professional's
-- earnings page claimed money had arrived while the transfer was still pending
-- at Paystack (GH₵16.20 "received" with nothing settled).
--
-- A payout is now recorded as 'processing' at completion and only promoted to
-- 'paid' by the payout-reconcile worker once Paystack confirms a settled
-- transfer to the professional's subaccount. Settlement is matched by amount,
-- oldest first, because one Paystack transfer can cover several bookings.

-- The Paystack transfer recipient that settles a subaccount. Resolved from the
-- subaccount's own settlement details and cached here so settled transfers can
-- be listed per professional.
alter table public.professional_payout_accounts
  add column if not exists paystack_recipient_code text;

comment on column public.professional_payout_accounts.paystack_recipient_code is
  'Paystack transfer recipient that receives this subaccount''s settlements. Resolved from the subaccount settlement details.';

-- The Paystack transfer that covered this payout, kept for support and audit.
alter table public.payouts
  add column if not exists settlement_reference text;

comment on column public.payouts.settlement_reference is
  'Paystack transfer reference that settled this payout. Null until payout-reconcile confirms settlement.';

-- Reconciliation scans one professional's unallocated payouts oldest-first.
create index if not exists payouts_professional_status_created_idx
  on public.payouts (professional_id, status, created_at);

-- Every existing 'paid' completion payout was written by the app at completion,
-- before reconciliation existed, so none were confirmed against Paystack. Move
-- them back to 'processing' so the next run settles the ones Paystack has
-- actually paid out. The notification trigger is suppressed so this backfill
-- does not push a "payout on its way" alert per row.
alter table public.payouts disable trigger notify_payout_status;

update public.payouts
   set status = 'processing',
       paid_at = null
 where status = 'paid'
   and payout_type = 'completion'
   and settlement_reference is null;

alter table public.payouts enable trigger notify_payout_status;
