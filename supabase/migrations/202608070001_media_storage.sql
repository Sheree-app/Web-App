-- Sheree v1 media storage.
--
-- Reusable registry for every image stored in Cloudflare R2. We store object
-- keys (never full URLs) so public URLs can be generated dynamically from the
-- configured CDN base URL. Uploads are authorized through the media-storage
-- Edge Function; this table is the source of truth for ownership, purpose, and
-- the generated image variants.
--
-- This table intentionally mirrors the platform-agnostic shape in the design
-- document while adding a `variants` JSONB column so a single media row can
-- reference its thumbnail / feed / original objects without a separate table.
-- Private profiles, moderation, watermarks, and AI analysis can later be added
-- by extending this row or referencing it, without reshaping v1 call sites.

create table public.media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  -- Canonical object key of the "original" variant, e.g. posts/a7c4e1d9/original.webp
  bucket_key text not null,
  -- Purpose of the upload: profile | post | portfolio | service
  media_type text not null check (media_type in ('profile','post','portfolio','service')),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  -- Dimensions of the "original" variant
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  -- Variant object keys + dimensions, e.g.
  -- {"thumbnail":{"bucket_key":"posts/a7c4e1d9/thumbnail.webp","width":320,"height":240},
  --  "feed":{"bucket_key":"posts/a7c4e1d9/feed.webp","width":720,"height":540},
  --  "original":{"bucket_key":"posts/a7c4e1d9/original.webp","width":1440,"height":1080}}
  variants jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index media_user_created_idx on public.media(user_id, created_at desc);
create index media_type_idx on public.media(media_type);

alter table public.media enable row level security;

-- Metadata is owner-only by default. Image bytes are public through R2/CDN;
-- the registry itself stays private to support future private profiles and
-- moderation without exposing user storage internals.
create policy "media owner select" on public.media for select to authenticated using ((select auth.uid()) = user_id);
create policy "media owner insert" on public.media for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "media owner update" on public.media for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "media owner delete" on public.media for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.media from anon;
grant select, insert, update, delete on public.media to authenticated;
