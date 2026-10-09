-- Enum additions must commit before functions can safely use the new value.
alter type public.booking_status add value if not exists 'no_show';
