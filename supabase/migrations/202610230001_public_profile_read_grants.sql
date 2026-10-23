-- Public read grants for the web client's batched lookups.
--
-- The post viewer and the Founding Beautician badge store read
-- `professional_profiles` directly (one batched query per feed page, one query
-- per profile), and the feed reads the clip columns on `feed_posts`. On
-- deployments where those tables were left with column-level grants, selecting
-- a newly added column failed with:
--
--   42501 permission denied for table professional_profiles
--
-- Row level security still decides which rows are visible; these grants only
-- restore the table-level privilege the existing read policies expect, so new
-- columns are readable without another grant migration.

grant usage on schema public to anon, authenticated;

grant select on table public.professional_profiles to anon, authenticated;
grant select on table public.feed_posts to anon, authenticated;
grant select on table public.feed_post_images to anon, authenticated;
grant select on table public.interests to anon, authenticated;
