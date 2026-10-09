-- Comment replies: let users thread the conversation under a parent comment.
-- Replies share the same feed_post_comments table via a self-referencing
-- parent_id, so existing RLS, counts, and notification plumbing keep working.
-- Statements are idempotent so a partially-applied run can be retried.

alter table public.feed_post_comments
  add column if not exists parent_id uuid references public.feed_post_comments(id) on delete cascade;

create index if not exists feed_post_comments_parent_idx on public.feed_post_comments(parent_id, created_at);
create index if not exists feed_post_comments_post_parent_idx on public.feed_post_comments(post_id, parent_id, created_at);

-- Notify the parent comment's author when someone replies to them. The post
-- owner is already notified by the week11 trigger (a reply is still a new
-- comment), so skip when the reply's parent author owns the post.
create or replace function public.notify_comment_reply()
returns trigger language plpgsql security definer set search_path='' as $$
declare parent_author uuid; owner_id uuid; actor_name text;
begin
  if new.parent_id is null then return new; end if;
  select user_id into parent_author from public.feed_post_comments where id=new.parent_id;
  if parent_author is null or parent_author=new.user_id then return new; end if;
  select p.user_id into owner_id from public.feed_posts fp join public.professional_profiles p on p.id=fp.professional_id where fp.id=new.post_id;
  if parent_author=owner_id then return new; end if;
  select coalesce(nullif(username,''),'Someone') into actor_name from public.users where id=new.user_id;
  perform public.notify_user(parent_author,'social',
    actor_name||' replied to your comment',
    actor_name||' replied: "'||left(new.body,60)||(case when char_length(new.body)>60 then '…' else '' end)||'".',
    '/post/'||new.post_id,
    jsonb_build_object('postId',new.post_id,'commentId',new.id,'parentId',new.parent_id,'actorId',new.user_id,'event','comment_reply'),
    'customer');
  return new;
end $$;
revoke all on function public.notify_comment_reply() from public,anon,authenticated;

drop trigger if exists notify_comment_reply_trigger on public.feed_post_comments;
create trigger notify_comment_reply_trigger after insert on public.feed_post_comments
for each row execute function public.notify_comment_reply();

-- Top-level comments only, with a live reply count so the thread list can show
-- how many replies each comment has without an extra round trip. The previous
-- version of this function returned a different column set, so it is dropped
-- first (create-or-replace cannot change a function's return type).
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

-- Cursor-paginated replies for a single comment, newest first (clients reverse
-- for chronological reading order). reply_to_name is the author of the comment
-- being replied to, so threads can show "replying to @name" on nested replies.
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
