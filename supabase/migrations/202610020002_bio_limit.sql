-- The bio becomes editable in the app, capped at one short paragraph.
--
-- The column has allowed 1000 characters since the first migration, and
-- onboarding writes it too. Bring existing rows inside the new limit first —
-- this truncates, it does not fail — then make 100 the rule at the database, so
-- the cap holds for the edit form, onboarding and any future client alike.

update public.professional_profiles
set bio = left(bio, 100)
where bio is not null and char_length(bio) > 100;

-- The original inline check (char_length(bio) <= 1000) is now both redundant and
-- weaker. Postgres names an inline single-column check `<table>_<column>_check`.
alter table public.professional_profiles
  drop constraint if exists professional_profiles_bio_check;

alter table public.professional_profiles
  drop constraint if exists professional_profiles_bio_length;

alter table public.professional_profiles
  add constraint professional_profiles_bio_length
  check (bio is null or char_length(bio) <= 100);

comment on column public.professional_profiles.bio is
  'Short public introduction, at most 100 characters. Editable from the app.';
