-- The public feed RPC is security invoker and reads these tables to calculate
-- personalization flags. Anonymous callers need table-level SELECT permission,
-- while the existing RLS policies continue to expose zero private rows.
grant select on public.user_interests, public.feed_post_saves to anon;
