-- Backstop for the reply-aware comment functions. The first attempt at
-- 202609010001 used create-or-replace to change get_post_comments_page's
-- return type, which PostgreSQL rejects (42P13). If that migration was
-- recorded as applied despite the error, only the functions below would still
-- be missing/stale, so drop and recreate them here. Idempotent: the drops make
-- this safe to run whether or not 202609010001 completed.

drop function if exists public.get_post_comments_page(uuid,timestamptz,uuid,integer);
create or replace function public.get_post_comments_page(
  post_id_value uuid,cursor_created_at timestamptz default null,cursor_id uuid default null,page_size integer default 30
) returns table(id uuid,post_id uuid,user_id uuid,parent_id uuid,body text,created_at timestamptz,author_name text,avatar_url text,reply_count bigint)
language sql stable security definer set search_path='' as $$
select c.id,c.post_id,c.user_id,c.parent_id,c.body,c.created_at,coalesce(nullif(u.username,''),'Sheree member'),u.avatar_url,
  (select count(*) from public.feed_post_comments r where r.parent_id=c.id)
from public.feed_post_comments c join public.users u on u.id=c.user_id
where c.post_id=post_id_value and c.parent_id is null and (
  cursor_created_at is null or (c.created_at,c.id)<(cursor_created_at,cursor_id)
)
order by c.created_at desc,c.id desc
limit least(greatest(page_size,1),50)
$$;
revoke all on function public.get_post_comments_page(uuid,timestamptz,uuid,integer) from public;
grant execute on function public.get_post_comments_page(uuid,timestamptz,uuid,integer) to anon,authenticated;

drop function if exists public.get_comment_replies_page(uuid,timestamptz,uuid,integer);
create or replace function public.get_comment_replies_page(
  comment_id_value uuid,cursor_created_at timestamptz default null,cursor_id uuid default null,page_size integer default 30
) returns table(id uuid,post_id uuid,user_id uuid,parent_id uuid,body text,created_at timestamptz,author_name text,avatar_url text,reply_count bigint,reply_to_name text)
language sql stable security definer set search_path='' as $$
select c.id,c.post_id,c.user_id,c.parent_id,c.body,c.created_at,coalesce(nullif(u.username,''),'Sheree member'),u.avatar_url,
  (select count(*) from public.feed_post_comments r where r.parent_id=c.id),
  coalesce(nullif(pu.username,''),'Sheree member')
from public.feed_post_comments c
join public.users u on u.id=c.user_id
left join public.feed_post_comments parent on parent.id=c.parent_id
left join public.users pu on pu.id=parent.user_id
where c.parent_id=comment_id_value and (
  cursor_created_at is null or (c.created_at,c.id)<(cursor_created_at,cursor_id)
)
order by c.created_at desc,c.id desc
limit least(greatest(page_size,1),50)
$$;
revoke all on function public.get_comment_replies_page(uuid,timestamptz,uuid,integer) from public;
grant execute on function public.get_comment_replies_page(uuid,timestamptz,uuid,integer) to anon,authenticated;
