-- Enum additions must commit before functions can safely use the new value.
alter type public.account_status add value if not exists 'blocked';
