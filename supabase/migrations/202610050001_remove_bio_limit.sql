-- The bio is a free-form introduction again: no length cap in the app or the
-- database.
--
-- 202610020002_bio_limit.sql tightened the column from the original 1000
-- characters down to 100. This reverses that entirely by dropping the check
-- rather than restoring a larger number — the app now submits whatever the
-- professional writes, so a cap of any size would only reject valid input.
--
-- There is no backfill: existing bios were already truncated below 100 and are
-- unaffected. The migration stays recorded, so this simply drops the rule it
-- installed.

alter table public.professional_profiles
  drop constraint if exists professional_profiles_bio_length;

alter table public.professional_profiles
  drop constraint if exists professional_profiles_bio_check;

comment on column public.professional_profiles.bio is
  'Public introduction clients read on the profile. Editable from the app, no length cap.';
