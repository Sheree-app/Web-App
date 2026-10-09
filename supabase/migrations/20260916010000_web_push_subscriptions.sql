-- Web Push subscriptions.
--
-- `push_tokens` was written for the mobile builds: one row per device holding an
-- Expo push token. Browsers hold a different thing — an RFC 8291 subscription
-- (an endpoint plus the p256dh/auth keys the payload is sealed with) — so the
-- same table now carries both channels, and a row only ever has one of them.

alter table public.push_tokens
  add column if not exists web_push_subscription jsonb;

-- A browser row has no Expo token, so the column can no longer be mandatory.
alter table public.push_tokens
  alter column expo_push_token drop not null;

-- `notification-worker` reads the enabled tokens for a user and picks whichever
-- channel each row can actually receive on, so this is the lookup it repeats.
create index if not exists push_tokens_web_push_idx
  on public.push_tokens (user_id)
  where enabled and web_push_subscription is not null;

comment on column public.push_tokens.web_push_subscription is
  'Web Push subscription: { endpoint, keys: { p256dh, auth } }. Null for mobile builds, which use expo_push_token instead.';
