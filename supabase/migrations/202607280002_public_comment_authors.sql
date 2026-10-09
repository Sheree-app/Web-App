create or replace function public.get_post_comments(post_id_value uuid)
returns table(
  id uuid,
  post_id uuid,
  user_id uuid,
  body text,
  created_at timestamptz,
  author_name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    comment.id,
    comment.post_id,
    comment.user_id,
    comment.body,
    comment.created_at,
    member.full_name,
    member.avatar_url
  from public.feed_post_comments comment
  join public.feed_posts post on post.id = comment.post_id
  join public.users member on member.id = comment.user_id
  where comment.post_id = post_id_value
    and post.is_published
  order by comment.created_at;
$$;

revoke all on function public.get_post_comments(uuid) from public;
grant execute on function public.get_post_comments(uuid) to anon, authenticated;
