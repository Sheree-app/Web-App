-- Resolve a follower notification to the small amount of public identity needed
-- for its destination screen. Only the followed professional can request it.
create or replace function public.get_notification_follower(follower_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'id', u.id,
    'name', coalesce(nullif(u.full_name,''),'Sheree member'),
    'avatar_url', u.avatar_url,
    'professional_profile_id', pp.id
  )
  from public.users u
  left join public.professional_profiles pp on pp.user_id=u.id
  where u.id=follower_user_id
    and exists(
      select 1
      from public.professional_follows f
      join public.professional_profiles followed on followed.id=f.professional_id
      where f.user_id=u.id and followed.user_id=(select auth.uid())
    );
$$;

revoke all on function public.get_notification_follower(uuid) from public,anon;
grant execute on function public.get_notification_follower(uuid) to authenticated;

-- Store direct destinations on new notifications as well as structured data,
-- so inbox taps and push taps behave consistently.
create or replace function public.week11_social_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;actor_name text;post_image text;action_text text;
begin
  select p.user_id,fp.image_url into owner_id,post_image from public.feed_posts fp join public.professional_profiles p on p.id=fp.professional_id where fp.id=new.post_id;
  if owner_id is null or owner_id=new.user_id then return new;end if;
  select coalesce(nullif(full_name,''),'Someone') into actor_name from public.users where id=new.user_id;
  action_text:=case tg_table_name when 'feed_post_likes' then 'liked your work' when 'feed_post_comments' then 'commented on your work' else 'saved your work' end;
  perform public.notify_user(owner_id,'social',case tg_table_name when 'feed_post_likes' then actor_name||' liked your work' when 'feed_post_comments' then 'New comment on your work' else 'Your work was saved' end,actor_name||' '||action_text||'.','/post/'||new.post_id,jsonb_build_object('postId',new.post_id,'actorId',new.user_id,'event',tg_table_name,'imageUrl',post_image),'professional');
  return new;
end $$;

create or replace function public.notify_professional_follow()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;actor_name text;
begin
  select p.user_id into owner_id from public.professional_profiles p where p.id=new.professional_id;
  if owner_id is null or owner_id=new.user_id then return new;end if;
  select coalesce(nullif(full_name,''),'Someone') into actor_name from public.users where id=new.user_id;
  perform public.notify_user(owner_id,'social','New follower',actor_name||' followed your studio.','/follower/'||new.user_id,jsonb_build_object('actorId',new.user_id,'event','professional_follow'),'professional');
  return new;
end $$;
