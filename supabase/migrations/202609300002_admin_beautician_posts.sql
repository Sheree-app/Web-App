-- admin_beautician_posts
--
-- Restored from the remote migration history (version 202609300002). This
-- migration was applied to the remote database before the file existed
-- locally, so it is written back verbatim to keep local and remote in sync.
-- Comments from the original file are not preserved by migration history.

-- Admin tooling: browse and delete a beautician's feed posts.
--
-- The trust & safety console could only act on posts that had already been
-- reported or auto-flagged. This adds a direct view of every post belonging to
-- a specific professional plus a hard delete. Deleting a post cascades to its
-- images, likes, saves, comments, reports and flags, so those child tables must
-- all reference feed_posts with "on delete cascade" (they do).

create or replace function public.get_admin_beautician_posts(
  target_professional_id uuid,
  page_number integer default 1,
  page_size integer default 24
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  page integer := greatest(coalesce(page_number, 1), 1);
  size integer := least(greatest(coalesce(page_size, 24), 1), 100);
begin
  if not public.admin_has_permission('users.read') then
    raise exception 'User directory access required' using errcode='42501';
  end if;

  return (
    with posts as (
      select fp.id, fp.image_url, fp.video_url, fp.caption, fp.is_published,
        fp.moderation_status, fp.moderation_reason, fp.created_at,
        (select count(*) from public.feed_post_likes l where l.post_id=fp.id) like_count,
        (select count(*) from public.feed_post_comments c where c.post_id=fp.id) comment_count,
        (select count(*) from public.content_reports r where r.post_id=fp.id) report_count,
        (select count(*) from public.moderation_flags f where f.post_id=fp.id) flag_count,
        coalesce((select jsonb_agg(i.image_url order by i.sort_order)
          from public.feed_post_images i where i.post_id=fp.id),
          jsonb_build_array(fp.image_url)) images
      from public.feed_posts fp
      where fp.professional_id=target_professional_id
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
        from (select * from posts order by created_at desc limit size offset (page-1)*size) x), '[]'::jsonb),
      'total', (select count(*) from posts),
      'page', page,
      'page_size', size
    )
  );
end;
$$;

create or replace function public.admin_delete_feed_post(
  target_post_id uuid,
  reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  clean text := trim(coalesce(reason, ''));
  professional uuid;
  caption text;
begin
  if not public.admin_has_permission('moderation.manage') then
    raise exception 'Moderation access required' using errcode='42501';
  end if;
  if char_length(clean) < 5 then
    raise exception 'A reason of at least 5 characters is required';
  end if;

  select fp.professional_id, fp.caption into professional, caption
  from public.feed_posts fp where fp.id=target_post_id for update;
  if not found then
    raise exception 'Post not found' using errcode='P0002';
  end if;

  delete from public.feed_posts where id=target_post_id;

  insert into public.admin_audit_logs(actor_id, action, resource_type, resource_id, summary, metadata)
  values ((select auth.uid()), 'post.delete', 'feed_post', target_post_id,
    'Deleted feed post', jsonb_build_object('reason', clean, 'professional_id', professional, 'caption', caption));

  return jsonb_build_object('id', target_post_id, 'deleted', true, 'professional_id', professional);
end;
$$;

revoke all on function public.get_admin_beautician_posts(uuid, integer, integer),
  public.admin_delete_feed_post(uuid, text) from public, anon;

grant execute on function public.get_admin_beautician_posts(uuid, integer, integer),
  public.admin_delete_feed_post(uuid, text) to authenticated;
