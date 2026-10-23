-- Cloudinary as a second clip store.
--
-- Images stay in Cloudflare R2, but a 12-second clip may instead live in
-- Cloudinary (see CLOUDINARY_SETUP.md). The `media` registry is the source of
-- truth for where an object lives, so it records which provider a row belongs
-- to: deleting by `mediaId` must route to the Cloudinary Admin API for a
-- Cloudinary asset instead of the R2 bucket.
--
-- `r2` is the correct backfill: the Supabase Storage fallback never inserts a
-- `media` row, so every pre-existing row is an R2 object.

alter table public.media
  add column if not exists provider text not null default 'r2';

alter table public.media
  drop constraint if exists media_provider_check,
  add constraint media_provider_check check (provider in ('r2','cloudinary'));

comment on column public.media.provider is
  'Object store for this media row: r2 for images and R2 clips, cloudinary for Cloudinary clips.';
