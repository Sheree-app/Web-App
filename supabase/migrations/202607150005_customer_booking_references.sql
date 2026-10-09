alter table public.bookings add column if not exists booking_reference text generated always as (
  'SHR-'||upper(substr(replace(id::text,'-',''),1,4))||'-'||upper(substr(replace(id::text,'-',''),5,4))||'-'||upper(substr(replace(id::text,'-',''),9,4))
) stored;
create unique index if not exists bookings_reference_idx on public.bookings(booking_reference);
