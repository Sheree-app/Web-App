-- Official (brand) professional profiles.
--
-- Sheree keeps its own account so the team can post inspiration work into the
-- same feed as everyone else. An official profile is an ordinary
-- `professional_profiles` row in every other respect — it owns posts, has a
-- handle and appears in Discover — so this is a flag rather than a new role or
-- table. Clients read it to drop the booking call to action, because the brand
-- is not bookable.
--
-- Written server-side only, like `is_verified` and `is_founding_beautician`.
-- Clients only ever read it; the existing profile select policies already cover
-- the new column, so no policy or grant changes are needed.

alter table public.professional_profiles
  add column if not exists is_official boolean not null default false;

comment on column public.professional_profiles.is_official is
  'True for the Sheree brand account. Its posts are inspiration and carry no booking call to action.';

-- At most a handful of official profiles should ever exist, so a partial index
-- keeps that set trivial to read and makes the intent obvious.
create index if not exists professional_profiles_official_idx
  on public.professional_profiles(id) where is_official;

-- Mark the brand account after it has been created — by handle:
--
--   update public.professional_profiles
--   set is_official = true
--   where handle = 'sheree';
--
-- or by the email it signed up with:
--
--   update public.professional_profiles p
--   set is_official = true
--   from auth.users u
--   where u.id = p.user_id and u.email = 'hello@sheree.world';
