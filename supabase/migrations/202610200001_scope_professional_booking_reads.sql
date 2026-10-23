-- A beautician could read *every* booking she had served: the select policy
-- matched on `professional_id` alone. Row-level security cannot tell which
-- screen is asking, so when a beautician switched to customer mode the
-- customer-side query returned her completed work bookings under "My
-- bookings" as well as her own appointments.
--
-- Direct reads are now limited to live appointments — what the studio calendar
-- asks for (requested/confirmed, not yet finished). The full work ledger,
-- including completed, cancelled and no-show visits, is served by the
-- security-definer `get_professional_bookings` RPC, which pins rows to the
-- caller's own profile, so professional history is unaffected.
drop policy if exists "professionals read their bookings" on public.bookings;
drop policy if exists "professionals read live bookings" on public.bookings;
create policy "professionals read live bookings" on public.bookings
  for select to authenticated
  using (
    status in ('requested', 'confirmed')
    and exists (
      select 1
      from public.professional_profiles p
      where p.id = professional_id
        and p.user_id = (select auth.uid())
    )
  );
