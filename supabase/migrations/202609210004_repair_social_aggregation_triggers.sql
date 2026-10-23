-- Repair: the social triggers read per-table fields inside CASE expressions.
--
-- `queue_social_notification()` and `withdraw_social_notification()` picked their
-- event key with a CASE expression that mentioned `new.id` / `old.id` for
-- comments. plpgsql evaluates every branch of an expression, so a like or a save
-- — rows that have no `id` column — raised `record "new" has no field "id"` and
-- the whole statement was rolled back: liking a post failed at the database
-- level. Both functions now branch with IF/ELSIF so only fields that exist on the
-- current table are touched.
--
-- `202609210002_aggregate_social_notifications.sql` carries the same corrected
-- bodies, so a fresh environment is fixed by that file alone; this migration is
-- what repairs databases that already applied the original version.

create or replace function public.queue_social_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_owner_id uuid;
  v_interaction text;
  v_event_key text;
begin
  select p.user_id into v_owner_id
  from public.feed_posts fp
  join public.professional_profiles p on p.id=fp.professional_id
  where fp.id=new.post_id;
  -- Self-engagement never notifies, and a post without an owner cannot.
  if v_owner_id is null or v_owner_id = new.user_id then return new; end if;

  -- `new` differs per table: a comment has its own id, a like or a save is keyed
  -- by (post_id,user_id).
  if tg_table_name = 'feed_post_comments' then
    v_interaction := 'comment';
    v_event_key := tg_table_name||':'||new.id::text;
  elsif tg_table_name = 'feed_post_likes' then
    v_interaction := 'like';
    v_event_key := tg_table_name||':'||new.post_id::text||':'||new.user_id::text;
  else
    v_interaction := 'save';
    v_event_key := tg_table_name||':'||new.post_id::text||':'||new.user_id::text;
  end if;

  perform public.record_social_interaction(
    v_owner_id,new.user_id,v_interaction,new.post_id,null,v_event_key,'professional');
  return new;
end $$;
revoke all on function public.queue_social_notification() from public,anon,authenticated;

create or replace function public.withdraw_social_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_interaction text;
  v_event_key text;
  v_group_key text;
  v_owner_id uuid;
  v_remaining integer;
begin
  if tg_table_name = 'feed_post_comments' then
    v_interaction := 'comment';
    v_event_key := tg_table_name||':'||old.id::text;
  elsif tg_table_name = 'feed_post_likes' then
    v_interaction := 'like';
    v_event_key := tg_table_name||':'||old.post_id::text||':'||old.user_id::text;
  elsif tg_table_name = 'feed_post_saves' then
    v_interaction := 'save';
    v_event_key := tg_table_name||':'||old.post_id::text||':'||old.user_id::text;
  elsif tg_table_name = 'professional_follows' then
    v_interaction := 'follow';
    v_event_key := tg_table_name||':'||old.professional_id::text||':'||old.user_id::text;
  else
    return old;
  end if;

  delete from public.notification_group_events where event_key=v_event_key;
  if not found then return old; end if;

  if tg_table_name = 'professional_follows' then
    select p.user_id into v_owner_id from public.professional_profiles p where p.id=old.professional_id;
    if v_owner_id is null or v_owner_id = old.user_id then return old; end if;
    v_group_key := v_owner_id::text||':follow:'||old.professional_id::text;
  else
    select p.user_id into v_owner_id
    from public.feed_posts fp join public.professional_profiles p on p.id=fp.professional_id
    where fp.id=old.post_id;
    if v_owner_id is null or v_owner_id = old.user_id then return old; end if;
    v_group_key := v_owner_id::text||':'||v_interaction||':'||old.post_id::text;
  end if;

  v_remaining := null;
  update public.notification_groups g set
    interaction_count = (select count(*) from public.notification_group_events e where e.group_key=g.group_key),
    actor_count = (select count(distinct e.actor_id) from public.notification_group_events e where e.group_key=g.group_key),
    last_actor_id = (select e.actor_id from public.notification_group_events e where e.group_key=g.group_key order by e.created_at desc limit 1),
    updated_at = now()
  where g.group_key=v_group_key and g.status='pending'
  returning g.interaction_count into v_remaining;

  if v_remaining = 0 then
    update public.notification_groups set status='cancelled',updated_at=now()
    where group_key=v_group_key and status='pending';
  end if;
  return old;
end $$;
revoke all on function public.withdraw_social_notification() from public,anon,authenticated;
