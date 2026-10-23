-- 12-second work clips in the Discover feed.
--
-- A post carries at most one clip, and the clip never replaces the poster: the
-- `image_url` every card already renders stays required and holds the frame
-- grabbed from the video, `video_url` points at the single uploaded object.
-- Feed queries keep their existing shape — clients read these two columns for
-- the posts on screen.
--
-- The 12-second ceiling is enforced here as well as on the device so a
-- hand-rolled API call cannot publish a longer clip, and it is enforced on
-- `media` too so the registry matches what a post may reference.

alter table public.feed_posts
  add column if not exists video_url text,
  add column if not exists video_duration_ms integer;

alter table public.feed_posts
  drop constraint if exists feed_posts_video_check,
  add constraint feed_posts_video_check check (
    (video_url is null and video_duration_ms is null)
    or (video_url ~ '^https?://' and video_duration_ms between 500 and 12000)
  );

comment on column public.feed_posts.video_url is
  'Single MP4/MOV object for this post. NULL for picture-only posts.';
comment on column public.feed_posts.video_duration_ms is
  'Clip length in milliseconds. Capped at 12000 by feed_posts_video_check.';

-- The media registry accepted optimized WebP images only. Clips travel through
-- the same pipeline, so the constraint has to know about them.
alter table public.media
  drop constraint if exists media_mime_type_check;
alter table public.media
  add constraint media_mime_type_check check (
    mime_type in ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime')
  );

alter table public.media add column if not exists duration_ms integer;
alter table public.media
  drop constraint if exists media_duration_check,
  add constraint media_duration_check check (
    duration_ms is null or duration_ms between 500 and 12000
  );

-- Supabase Storage is the fallback while Cloudflare R2 is not configured
-- (EXPO_PUBLIC_MEDIA_STORAGE_PROVIDER). It shares the public `portfolio` bucket
-- with images, so the bucket has to accept clips and their larger payloads.
update storage.buckets
  set allowed_mime_types = array[
        'image/jpeg','image/png','image/webp','image/heic','image/heif',
        'video/mp4','video/quicktime'
      ],
      file_size_limit = 52428800
  where id = 'portfolio';
