-- Social notification aggregation.
--
-- Every like, comment, save and follow is still recorded on the interaction
-- table it belongs to (`feed_post_likes`, `feed_post_comments`,
-- `feed_post_saves`, `professional_follows`) — the social graph does not change
-- and the in-app notification centre still knows that Sarah liked the post.
-- What changes is *push delivery*: engagement no longer pushes once per row.
-- The interaction is filed into a server-side aggregation group keyed by
-- recipient + interaction type + post, and a single push is built once the
-- group settles:
--
--   like / comment / save / follow
--        -> notification_groups (pending)
--        -> aggregation window (sliding, bounded by max_group_age)
--        -> flush_social_notification_groups()
--        -> one `notifications` row + one Expo push
--        -> cooldown before the next push for that same group
--        -> optional traction milestone (100 / 500 / 1000 likes)
--
-- Delivery itself is untouched: the row lands in `notifications` and the
-- existing `notification-worker` edge function pushes it to the recipient's
-- `push_tokens` (Expo), reconciles tickets and disables dead tokens. So no new
-- push provider, no new queue, and no client-side timer is introduced.
--
-- Time-sensitive notifications stay immediate through `notify_user`:
-- messages, bookings, booking status, payments, reviews, mentions and replies
-- to a comment.
--
-- Timing is configuration, not code: `notification_aggregation_config` holds
-- AGGREGATION_WINDOW_MINUTES / COOLDOWN_MINUTES / MAX_GROUP_AGE_MINUTES per
-- interaction type.
--
-- Identity: engagement is always performed by an *account*
-- (`users.id` = `auth.users.id`), so actor names come from `users.username`
-- (the personal identity). The professional profile is only used to resolve who
-- owns the post being engaged with. A professional account liking another
-- post therefore never shows up under its business name, and the notification
-- always names the identity that actually acted.

-- ---------------------------------------------------------------------------
-- 1. Priority + timing configuration
-- ---------------------------------------------------------------------------

create table if not exists public.notification_aggregation_config (
  interaction_type text primary key,
  -- 'high' is delivered immediately by its own trigger and is never grouped.
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  enabled boolean not null default true,
  aggregation_window_minutes integer not null default 5 check (aggregation_window_minutes between 1 and 1440),
  max_group_age_minutes integer not null default 30 check (max_group_age_minutes between 1 and 10080),
  cooldown_minutes integer not null default 30 check (cooldown_minutes between 0 and 10080),
  -- Above this many distinct actors the copy switches to "12 people saved…".
  -- 10 keeps every wording the product asked for: "Sarah and 3 others" at four
  -- actors, "Ama and 4 others" at five, and the crowd form from ten up.
  crowd_threshold integer not null default 10 check (crowd_threshold between 3 and 1000),
  updated_at timestamptz not null default now()
);

insert into public.notification_aggregation_config(
  interaction_type,priority,enabled,aggregation_window_minutes,max_group_age_minutes,cooldown_minutes,crowd_threshold
) values
  -- Social engagement: grouped, short window, long cooldown (viral protection).
  ('like','medium',true,5,30,30,10),
  ('comment','medium',true,5,30,30,10),
  ('save','medium',true,10,60,60,10),
  ('follow','medium',true,15,120,180,10),
  -- High priority: documented here so the classification is in one place, but
  -- these are delivered immediately by their existing triggers (`notify_user`)
  -- and are never filed into an aggregation group.
  ('reply','high',false,1,1,0,20),
  ('message','high',false,1,1,0,20),
  ('booking','high',false,1,1,0,20),
  ('booking_status','high',false,1,1,0,20),
  ('payment','high',false,1,1,0,20),
  ('appointment_reminder','high',false,1,1,0,20),
  ('review','high',false,1,1,0,20)
on conflict(interaction_type) do nothing;

create or replace function public.notification_priority(interaction_type text)
returns text language sql stable security definer set search_path='' as $$
  select coalesce(
    (select c.priority from public.notification_aggregation_config c where c.interaction_type=notification_priority.interaction_type),
    'medium')
$$;
revoke all on function public.notification_priority(text) from public,anon,authenticated;
grant execute on function public.notification_priority(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Aggregation groups, interaction ledger and milestones
-- ---------------------------------------------------------------------------

create table if not exists public.notification_groups (
  id uuid primary key default gen_random_uuid(),
  -- recipient:interaction_type:post (or professional for follows). Stable, so
  -- "the group for THIS recipient + THIS post + THIS interaction type" is a
  -- single row per aggregation window instead of one per actor.
  group_key text not null,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  interaction_type text not null references public.notification_aggregation_config(interaction_type) on delete restrict,
  post_id uuid references public.feed_posts(id) on delete cascade,
  professional_id uuid references public.professional_profiles(id) on delete cascade,
  audience public.notification_audience not null default 'professional',
  status text not null default 'pending' check (status in ('pending','sent','cancelled')),
  first_actor_id uuid,
  last_actor_id uuid,
  -- Identity used for the copy, captured at interaction time from
  -- `users.username` so a later profile rename cannot rewrite history.
  first_actor_name text,
  second_actor_name text,
  actor_count integer not null default 0,
  interaction_count integer not null default 0,
  first_interaction_at timestamptz not null default now(),
  last_interaction_at timestamptz not null default now(),
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  cooldown_until timestamptz,
  notification_id uuid references public.notifications(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((post_id is not null)::int + (professional_id is not null)::int = 1)
);

-- Exactly one *open* group per recipient + type + target: this is what makes
-- 100 simultaneous likes collapse into one row instead of 100 groups.
create unique index if not exists notification_groups_pending_key_idx
  on public.notification_groups(group_key) where status='pending';
create index if not exists notification_groups_flush_idx
  on public.notification_groups(scheduled_at) where status='pending';
create index if not exists notification_groups_recipient_idx
  on public.notification_groups(recipient_user_id,status,cooldown_until desc);
create index if not exists notification_groups_cooldown_idx
  on public.notification_groups(group_key,cooldown_until desc) where status='sent';
-- Delivered groups are history; they are pruned by the flush once they are old.
create index if not exists notification_groups_retention_idx
  on public.notification_groups(sent_at) where status='sent';

-- One row per interaction event. The primary key is the idempotency gate: a
-- replayed event (retry, duplicate webhook, double-submit) inserts nothing and
-- therefore cannot inflate a count or trigger a second push. Rows are deleted
-- when their group is flushed or cancelled, which keeps the window-scoped
-- counts exact without unbounded growth.
create table if not exists public.notification_group_events (
  event_key text primary key,
  group_key text not null,
  actor_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists notification_group_events_group_idx
  on public.notification_group_events(group_key,created_at);
create index if not exists notification_group_events_actor_idx
  on public.notification_group_events(group_key,actor_id);

-- Traction milestones. The primary key is the "already triggered" record: a
-- post can cross 100 likes only once.
create table if not exists public.notification_milestones (
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  milestone integer not null check (milestone > 0),
  triggered_at timestamptz not null default now(),
  notification_id uuid references public.notifications(id) on delete set null,
  primary key (post_id,milestone)
);

create table if not exists public.notification_milestone_config (
  milestone integer primary key check (milestone > 0),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
-- Only the thresholds that read as genuinely notable are on by default; the
-- rest stay available and can be switched on without a code change.
insert into public.notification_milestone_config(milestone,enabled) values
  (10,false),(25,false),(50,false),(100,true),(250,false),(500,true),(1000,true)
on conflict(milestone) do nothing;

alter table public.notification_groups enable row level security;
alter table public.notification_group_events enable row level security;
alter table public.notification_milestones enable row level security;
alter table public.notification_aggregation_config enable row level security;
alter table public.notification_milestone_config enable row level security;
-- Internal delivery machinery: reachable by the definer functions and the
-- service role only, never by the app.
revoke all on public.notification_groups,public.notification_group_events,
  public.notification_milestones,public.notification_aggregation_config,
  public.notification_milestone_config from anon,authenticated;
grant all on public.notification_groups,public.notification_group_events,
  public.notification_milestones,public.notification_aggregation_config,
  public.notification_milestone_config to service_role;

comment on table public.notification_groups is
  'Server-side aggregation group for one recipient + interaction type + post (or professional). At most one pending group per key; flushed by flush_social_notification_groups().';
comment on table public.notification_group_events is
  'Idempotency ledger: one row per recorded interaction event. Deleted when its group is flushed, so group counts stay window-scoped.';

-- ---------------------------------------------------------------------------
-- 3. Granular social preferences
-- ---------------------------------------------------------------------------
-- The app currently exposes `feed_engagement` (professional mode) as the
-- umbrella switch for engagement. These per-type switches default to on, so
-- behaviour is unchanged today and finer control can be surfaced later without
-- another migration.

alter table public.notification_preferences
  add column if not exists likes_enabled boolean not null default true,
  add column if not exists comments_enabled boolean not null default true,
  add column if not exists saves_enabled boolean not null default true,
  add column if not exists follows_enabled boolean not null default true;

-- ---------------------------------------------------------------------------
-- 4. Preference resolution
-- ---------------------------------------------------------------------------

-- 'allowed'  -> push may go out now
-- 'deferred' -> recipient is inside quiet hours; keep it for the window end
-- 'disabled' -> recipient switched this category (or push) off; the row still
--               lands in their inbox, only the push is skipped
create or replace function public.notification_social_push_state(target_user uuid,interaction_type text)
returns text language plpgsql stable security definer set search_path='' as $$
declare p public.notification_preferences; granular boolean;
begin
  select * into p from public.notification_preferences where user_id=target_user;
  -- No row means the defaults, which are all on.
  if not found then return 'allowed'; end if;
  if not p.push_enabled then return 'disabled'; end if;
  granular := case interaction_type
    when 'like' then p.likes_enabled
    when 'comment' then p.comments_enabled
    when 'save' then p.saves_enabled
    when 'follow' then p.follows_enabled
    else null
  end;
  if granular is not null and not granular then return 'disabled'; end if;
  -- Umbrella engagement switches: `feed_engagement` is the current one,
  -- `activity` is the legacy column an older build wrote.
  if not (p.feed_engagement and p.activity) then return 'disabled'; end if;
  if p.quiet_hours_enabled and (case
       when p.quiet_from < p.quiet_until then localtime >= p.quiet_from and localtime < p.quiet_until
       else localtime >= p.quiet_from or localtime < p.quiet_until
     end) then
    return 'deferred';
  end if;
  return 'allowed';
end $$;
revoke all on function public.notification_social_push_state(uuid,text) from public,anon,authenticated;
grant execute on function public.notification_social_push_state(uuid,text) to service_role;

-- When the recipient's quiet hours end, or null when they are not active.
create or replace function public.notification_quiet_hours_end(target_user uuid)
returns timestamptz language plpgsql stable security definer set search_path='' as $$
declare p public.notification_preferences; quiet_end interval;
begin
  select * into p from public.notification_preferences where user_id=target_user;
  if not found or not p.quiet_hours_enabled then return null; end if;
  quiet_end := make_interval(hours => extract(hour from p.quiet_until)::integer,mins => extract(minute from p.quiet_until)::integer);
  if p.quiet_from < p.quiet_until then
    if localtime >= p.quiet_from and localtime < p.quiet_until then
      return date_trunc('day',now()) + quiet_end;
    end if;
    return null;
  end if;
  if localtime >= p.quiet_from then return date_trunc('day',now()) + interval '1 day' + quiet_end; end if;
  if localtime < p.quiet_until then return date_trunc('day',now()) + quiet_end; end if;
  return null;
end $$;
revoke all on function public.notification_quiet_hours_end(uuid) from public,anon,authenticated;
grant execute on function public.notification_quiet_hours_end(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Copy
-- ---------------------------------------------------------------------------
-- Single place where aggregated wording lives, so the phrasing can change
-- without touching triggers, the worker, or the app.
--
--   one actor   -> "Sarah liked your post"
--   two actors  -> "Sarah and Ama liked your post"
--   a few       -> "Sarah and 3 others liked your post"
--   a crowd     -> "25 people liked your post"

create or replace function public.format_social_notification(
  interaction_type text,
  first_actor_name text,
  second_actor_name text,
  actor_count integer,
  interaction_count integer,
  crowd_threshold integer default 10
) returns jsonb language plpgsql immutable set search_path='' as $$
declare
  actors integer := greatest(coalesce(actor_count,1),1);
  first_name text := coalesce(nullif(trim(coalesce(first_actor_name,'')),''),'Someone');
  second_name text := nullif(trim(coalesce(second_actor_name,'')),'');
  verb text;
  subject text;
  body text;
begin
  verb := case interaction_type
    when 'like' then 'liked your post'
    when 'comment' then 'commented on your post'
    when 'save' then 'saved your post'
    when 'follow' then 'followed your studio'
    else 'engaged with your post'
  end;
  subject := case
    when actors <= 1 then first_name
    when actors = 2 then first_name||' and '||coalesce(second_name,'someone else')
    when actors >= greatest(coalesce(crowd_threshold,10),3) then actors::text||' people'
    else first_name||' and '||(actors-1)::text||' others'
  end;
  body := case interaction_type
    when 'like' then 'Your look is getting so much love 💕'
    when 'comment' then 'Tap to read what they said 💬'
    when 'save' then 'Your look is inspiring people ✨'
    when 'follow' then 'Your work is getting noticed ✨'
    else 'Tap to see what''s new on Sheree.'
  end;
  return jsonb_build_object(
    'title',subject||' '||verb,
    'body',body,
    'subject',subject,
    'verb',verb,
    'actorCount',actors,
    'interactionCount',greatest(coalesce(interaction_count,0),0)
  );
end $$;
revoke all on function public.format_social_notification(text,text,text,integer,integer,integer) from public,anon,authenticated;

create or replace function public.format_milestone_notification(milestone integer)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'title', case
      when milestone >= 1000 then '👑 Your post just reached '||milestone||' likes!'
      when milestone >= 500 then '🔥 Your post just reached '||milestone||' likes!'
      when milestone >= 250 then '💫 Your post just reached '||milestone||' likes!'
      else '✨ Your post just reached '||milestone||' likes!'
    end,
    'body','Your look is doing numbers — tap to see it.'
  )
$$;
revoke all on function public.format_milestone_notification(integer) from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- 6. Recording an interaction
-- ---------------------------------------------------------------------------

create or replace function public.record_social_interaction(
  p_recipient_user_id uuid,
  p_actor_user_id uuid,
  p_interaction_type text,
  p_post_id uuid default null,
  p_professional_id uuid default null,
  p_event_key text default null,
  p_audience public.notification_audience default 'professional'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cfg public.notification_aggregation_config;
  v_group_key text;
  v_actor_name text;
  v_window_at timestamptz;
  v_cooldown_end timestamptz := to_timestamp(0);
  v_window_interval interval;
  v_max_age interval;
  v_claimed_actor uuid;
  v_group_id uuid;
  v_count integer;
begin
  if p_recipient_user_id is null or p_actor_user_id is null then
    return jsonb_build_object('recorded',false,'reason','missing_participant');
  end if;
  -- A user never gets a social notification for their own action.
  if p_recipient_user_id = p_actor_user_id then
    return jsonb_build_object('recorded',false,'reason','self_interaction');
  end if;
  if p_event_key is null then
    return jsonb_build_object('recorded',false,'reason','missing_event_key');
  end if;

  select * into cfg from public.notification_aggregation_config c where c.interaction_type=p_interaction_type;
  if not found then
    return jsonb_build_object('recorded',false,'reason','unknown_interaction_type');
  end if;
  if not cfg.enabled then
    return jsonb_build_object('recorded',false,'reason','aggregation_disabled');
  end if;

  -- Personal identity of the actor (`users.username`), never a business name.
  select coalesce(nullif(trim(u.username),''),'Someone') into v_actor_name
  from public.users u where u.id=p_actor_user_id;
  v_actor_name := coalesce(v_actor_name,'Someone');

  v_group_key := p_recipient_user_id::text||':'||p_interaction_type||':'||coalesce(p_post_id::text,p_professional_id::text,'');
  v_window_interval := make_interval(mins => cfg.aggregation_window_minutes);
  v_max_age := make_interval(mins => cfg.max_group_age_minutes);
  v_window_at := now() + v_window_interval;

  -- A push that was already sent for this group is still cooling down: the next
  -- one may not leave before it expires, no matter how much activity arrives.
  select max(g.cooldown_until) into v_cooldown_end
  from public.notification_groups g
  where g.group_key=v_group_key and g.status='sent' and g.cooldown_until > now();
  v_cooldown_end := coalesce(v_cooldown_end,to_timestamp(0));

  -- Idempotency gate. The primary key makes a replay a no-op, so the same
  -- interaction can never be counted or pushed twice.
  insert into public.notification_group_events(event_key,group_key,actor_id)
  values(p_event_key,v_group_key,p_actor_user_id)
  on conflict(event_key) do nothing
  returning actor_id into v_claimed_actor;
  if v_claimed_actor is null then
    raise log 'sheree social aggregation duplicate event key=% group=%',p_event_key,v_group_key;
    return jsonb_build_object('recorded',false,'reason','duplicate_event','groupKey',v_group_key);
  end if;

  -- One atomic upsert joins the open group (or opens it). Concurrent actors
  -- contend on the partial unique index instead of racing a select-then-insert.
  insert into public.notification_groups as g (
    group_key,recipient_user_id,interaction_type,post_id,professional_id,audience,status,
    first_actor_id,last_actor_id,first_actor_name,actor_count,interaction_count,
    first_interaction_at,last_interaction_at,scheduled_at,updated_at
  ) values (
    v_group_key,p_recipient_user_id,p_interaction_type,p_post_id,p_professional_id,p_audience,'pending',
    p_actor_user_id,p_actor_user_id,v_actor_name,1,1,
    now(),now(),greatest(v_cooldown_end,least(v_window_at,now()+v_max_age)),now()
  )
  on conflict(group_key) where status='pending' do update set
    last_actor_id = excluded.last_actor_id,
    last_interaction_at = now(),
    second_actor_name = case
      when g.second_actor_name is null and g.first_actor_id is distinct from excluded.first_actor_id
        then excluded.first_actor_name
      else g.second_actor_name
    end,
    actor_count = g.actor_count + case when g.first_actor_id is distinct from excluded.first_actor_id then 1 else 0 end,
    interaction_count = g.interaction_count + 1,
    -- Sliding window (so a burst settles as one push) with a hard ceiling so
    -- sustained virality still flushes, plus the cooldown floor.
    scheduled_at = greatest(v_cooldown_end,least(v_window_at,g.first_interaction_at+v_max_age)),
    updated_at = now()
  returning id into v_group_id;

  select g.interaction_count into v_count from public.notification_groups g where g.id=v_group_id;
  raise log 'sheree social aggregation recorded group=% type=% count=% actor=%',v_group_id,p_interaction_type,v_count,p_actor_user_id;
  return jsonb_build_object('recorded',true,'groupId',v_group_id,'groupKey',v_group_key,'interactionCount',v_count);
end $$;
revoke all on function public.record_social_interaction(uuid,uuid,text,uuid,uuid,text,public.notification_audience) from public,anon,authenticated;
grant execute on function public.record_social_interaction(uuid,uuid,text,uuid,uuid,text,public.notification_audience) to service_role;

-- Withdrawing an interaction (unlike, unsave, deleted comment, unfollow)
-- before the group is flushed. After a flush there is nothing to correct —
-- that notification already went out.
create or replace function public.withdraw_social_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_interaction text;
  v_event_key text;
  v_group_key text;
  v_owner_id uuid;
  v_remaining integer;
begin
  -- Branching statements, not a CASE expression: `old` has different columns per
  -- table, and plpgsql evaluates the whole expression.
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

-- ---------------------------------------------------------------------------
-- 7. Social triggers — record, never push
-- ---------------------------------------------------------------------------

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
  -- by (post_id,user_id). This has to be branching *statements* rather than a
  -- CASE expression, because plpgsql evaluates every branch of an expression and
  -- `new.id` does not exist on the like/save rows.
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

-- The per-interaction push triggers are replaced by the aggregating ones above.
drop trigger if exists notify_feed_like on public.feed_post_likes;
drop trigger if exists notify_feed_comment on public.feed_post_comments;
drop trigger if exists notify_feed_save on public.feed_post_saves;
drop function if exists public.week11_social_notification();

create trigger queue_feed_like_notification after insert on public.feed_post_likes
for each row execute function public.queue_social_notification();
create trigger queue_feed_comment_notification after insert on public.feed_post_comments
for each row execute function public.queue_social_notification();
create trigger queue_feed_save_notification after insert on public.feed_post_saves
for each row execute function public.queue_social_notification();

drop trigger if exists withdraw_feed_like_notification on public.feed_post_likes;
create trigger withdraw_feed_like_notification after delete on public.feed_post_likes
for each row execute function public.withdraw_social_notification();
drop trigger if exists withdraw_feed_comment_notification on public.feed_post_comments;
create trigger withdraw_feed_comment_notification after delete on public.feed_post_comments
for each row execute function public.withdraw_social_notification();
drop trigger if exists withdraw_feed_save_notification on public.feed_post_saves;
create trigger withdraw_feed_save_notification after delete on public.feed_post_saves
for each row execute function public.withdraw_social_notification();

-- Follows are engagement too: same grouping, same cooldown.
create or replace function public.notify_professional_follow()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
  select p.user_id into owner_id from public.professional_profiles p where p.id=new.professional_id;
  if owner_id is null or owner_id = new.user_id then return new; end if;
  perform public.record_social_interaction(
    owner_id,new.user_id,'follow',null,new.professional_id,
    'professional_follows:'||new.professional_id::text||':'||new.user_id::text,'professional');
  return new;
end $$;
revoke all on function public.notify_professional_follow() from public,anon,authenticated;

drop trigger if exists notify_professional_follow on public.professional_follows;
create trigger notify_professional_follow after insert on public.professional_follows
for each row execute function public.notify_professional_follow();
drop trigger if exists withdraw_professional_follow_notification on public.professional_follows;
create trigger withdraw_professional_follow_notification after delete on public.professional_follows
for each row execute function public.withdraw_social_notification();

-- ---------------------------------------------------------------------------
-- 8. Traction milestones
-- ---------------------------------------------------------------------------
-- `feed_posts.like_count` is maintained by adjust_feed_reaction_count(), so this
-- fires on the like that actually crosses a threshold. The INSERT ... ON
-- CONFLICT claim is what makes "once, ever" true even when the count moves up
-- and down around a threshold.

create or replace function public.notify_post_milestones()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_owner_id uuid;
  v_milestone integer;
  v_claimed integer;
  v_copy jsonb;
  v_push_state text;
  v_queued_for timestamptz;
  v_notification_id uuid;
begin
  if coalesce(new.like_count,0) <= coalesce(old.like_count,0) then return new; end if;

  select p.user_id into v_owner_id from public.professional_profiles p where p.id=new.professional_id;
  if v_owner_id is null then return new; end if;

  for v_milestone in
    select c.milestone from public.notification_milestone_config c
    where c.enabled
      and c.milestone > coalesce(old.like_count,0)
      and c.milestone <= new.like_count
    order by c.milestone
  loop
    v_claimed := null;
    insert into public.notification_milestones(post_id,milestone)
    values(new.id,v_milestone)
    on conflict(post_id,milestone) do nothing
    returning milestone into v_claimed;
    if v_claimed is null then
      raise log 'sheree notification milestone already triggered post=% milestone=%',new.id,v_milestone;
      continue;
    end if;

    v_copy := public.format_milestone_notification(v_milestone);
    v_push_state := public.notification_social_push_state(v_owner_id,'like');
    v_queued_for := case v_push_state
      when 'deferred' then coalesce(public.notification_quiet_hours_end(v_owner_id),now()+interval '8 hours')
      when 'disabled' then 'infinity'::timestamptz
      else now()
    end;

    v_notification_id := null;
    insert into public.notifications(
      user_id,kind,title,body,url,data,audience,notification_type,category,reason,reference_id,idempotency_key,user_type,queued_for
    ) values (
      v_owner_id,'social',v_copy->>'title',v_copy->>'body','/post/'||new.id::text,
      jsonb_build_object(
        'event','feed_post_milestones','postId',new.id,'milestone',v_milestone,
        'likeCount',new.like_count,'route','/post/'||new.id::text,'audience','professional','pushState',v_push_state),
      'professional','POST_MILESTONE','engagement',
      'Post crossed '||v_milestone||' likes',new.id::text,
      'POST_MILESTONE:'||new.id::text||':'||v_milestone,
      'professional',v_queued_for
    )
    on conflict(idempotency_key) where idempotency_key is not null do nothing
    returning id into v_notification_id;

    if v_notification_id is not null then
      update public.notification_milestones set notification_id=v_notification_id
      where post_id=new.id and milestone=v_milestone;
    end if;
    raise log 'sheree notification milestone triggered post=% milestone=% push=% notification=%',new.id,v_milestone,v_push_state,v_notification_id;
  end loop;
  return new;
end $$;
revoke all on function public.notify_post_milestones() from public,anon,authenticated;

drop trigger if exists sheree_post_milestones on public.feed_posts;
create trigger sheree_post_milestones after update of like_count on public.feed_posts
for each row when (new.like_count > old.like_count)
execute function public.notify_post_milestones();

-- ---------------------------------------------------------------------------
-- 9. Flush — turn settled groups into one notification each
-- ---------------------------------------------------------------------------
-- Runs before the delivery queue is read by `notification-worker`, so the
-- aggregated push goes out in the same pass. Safe to call repeatedly: the
-- group status transition and `notifications.idempotency_key` both make a
-- retry a no-op.

create or replace function public.flush_social_notification_groups(batch_size integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  grp record;
  cfg public.notification_aggregation_config;
  v_owner_id uuid;
  v_post_image text;
  v_actors integer;
  v_interactions integer;
  v_names text[];
  v_copy jsonb;
  v_url text;
  v_push_state text;
  v_queued_for timestamptz;
  v_notification_id uuid;
  delivered integer := 0;
  cancelled integer := 0;
  suppressed integer := 0;
  pruned integer := 0;
begin
  -- Delivery is service-role work. `session_user` is allowed through so the
  -- database owner can run the SQL test suite (supabase/tests) and the SQL
  -- editor can flush by hand; the app's PostgREST calls always arrive as
  -- `service_role`, and an authenticated end user can never satisfy either test.
  if current_setting('role',true) <> 'service_role'
     and session_user not in ('postgres','supabase_admin') then
    raise exception 'Service role required' using errcode='42501';
  end if;

  -- Delivered groups only exist to enforce their cooldown, so old ones are
  -- dropped instead of accumulating forever.
  delete from public.notification_groups where status='sent' and sent_at < now()-interval '30 days';
  get diagnostics pruned=row_count;

  for grp in
    select g.* from public.notification_groups g
    where g.status='pending' and g.scheduled_at<=now()
    order by g.scheduled_at,g.id
    for update skip locked
    limit least(greatest(batch_size,1),500)
  loop
    select * into cfg from public.notification_aggregation_config c where c.interaction_type=grp.interaction_type;
    if not found or not cfg.enabled then
      update public.notification_groups set status='cancelled',updated_at=now() where id=grp.id;
      delete from public.notification_group_events where group_key=grp.group_key;
      cancelled := cancelled+1;
      continue;
    end if;

    -- Authoritative counts come from the ledger, not the running counters.
    select count(*),count(distinct e.actor_id) into v_interactions,v_actors
    from public.notification_group_events e where e.group_key=grp.group_key;

    -- The target must still exist and still belong to the recipient (post
    -- deleted, unpublished, post removed from the creator, profile deleted).
    v_post_image := null;
    if grp.post_id is not null then
      select fp.image_url,p.user_id into v_post_image,v_owner_id
      from public.feed_posts fp
      join public.professional_profiles p on p.id=fp.professional_id
      where fp.id=grp.post_id and fp.is_published;
      if not found or v_owner_id is distinct from grp.recipient_user_id then
        update public.notification_groups set status='cancelled',updated_at=now() where id=grp.id;
        delete from public.notification_group_events where group_key=grp.group_key;
        cancelled := cancelled+1;
        raise log 'sheree social aggregation cancelled group=% reason=post_unavailable',grp.id;
        continue;
      end if;
    else
      select p.user_id into v_owner_id from public.professional_profiles p where p.id=grp.professional_id;
      if v_owner_id is distinct from grp.recipient_user_id then
        update public.notification_groups set status='cancelled',updated_at=now() where id=grp.id;
        delete from public.notification_group_events where group_key=grp.group_key;
        cancelled := cancelled+1;
        raise log 'sheree social aggregation cancelled group=% reason=target_unavailable',grp.id;
        continue;
      end if;
    end if;

    -- Every interaction was withdrawn, or the only actor was the recipient.
    if v_actors = 0 or grp.first_actor_id = grp.recipient_user_id then
      update public.notification_groups set status='cancelled',updated_at=now() where id=grp.id;
      delete from public.notification_group_events where group_key=grp.group_key;
      cancelled := cancelled+1;
      continue;
    end if;

    v_names := array[coalesce(nullif(trim(grp.first_actor_name),''),'Someone')];
    if v_actors > 1 and nullif(trim(coalesce(grp.second_actor_name,'')),'') is not null then
      v_names := v_names||grp.second_actor_name;
    end if;

    v_copy := public.format_social_notification(
      grp.interaction_type,v_names[1],v_names[2],v_actors,v_interactions,cfg.crowd_threshold);
    v_url := case
      when grp.post_id is not null then '/post/'||grp.post_id::text
      when grp.first_actor_id is not null then '/follower/'||grp.first_actor_id::text
      else '/notifications'
    end;

    v_push_state := public.notification_social_push_state(grp.recipient_user_id,grp.interaction_type);
    -- 'disabled' keeps the row out of the inbox *and* out of the push queue:
    -- an infinite queue time is the existing "never push this" signal, while the
    -- notification itself still lands in the in-app centre.
    v_queued_for := case v_push_state
      when 'deferred' then coalesce(public.notification_quiet_hours_end(grp.recipient_user_id),now()+interval '8 hours')
      when 'disabled' then 'infinity'::timestamptz
      else now()
    end;

    v_notification_id := null;
    insert into public.notifications(
      user_id,kind,title,body,url,data,audience,notification_type,category,reason,reference_id,idempotency_key,user_type,queued_for
    ) values (
      grp.recipient_user_id,'social',v_copy->>'title',v_copy->>'body',v_url,
      jsonb_build_object(
        'event', case grp.interaction_type
          when 'like' then 'feed_post_likes'
          when 'comment' then 'feed_post_comments'
          when 'save' then 'feed_post_saves'
          else 'professional_follow' end,
        'interactionType',grp.interaction_type,'aggregated',true,
        'actorCount',v_actors,'interactionCount',v_interactions,
        'firstActorId',grp.first_actor_id,'groupId',grp.id,
        'audience',grp.audience,'route',v_url,'pushState',v_push_state,
        'postId',grp.post_id,'imageUrl',v_post_image),
      grp.audience,'SOCIAL_'||upper(grp.interaction_type),'engagement',
      'Aggregated '||v_interactions||' '||grp.interaction_type||' interaction(s)',
      coalesce(grp.post_id::text,grp.professional_id::text),
      'SOCIAL_GROUP:'||grp.id::text,
      case grp.audience when 'professional' then 'professional' when 'customer' then 'customer' else null end,
      v_queued_for
    )
    on conflict(idempotency_key) where idempotency_key is not null do nothing
    returning id into v_notification_id;

    update public.notification_groups g set
      status='sent',sent_at=now(),
      interaction_count=v_interactions,actor_count=v_actors,
      notification_id=coalesce(v_notification_id,g.notification_id),
      cooldown_until=case when cfg.cooldown_minutes > 0 then now()+make_interval(mins => cfg.cooldown_minutes) else null end,
      updated_at=now()
    where g.id=grp.id;

    -- Consumed events leave the ledger, so the next window starts from zero.
    delete from public.notification_group_events where group_key=grp.group_key;

    delivered := delivered+1;
    if v_push_state <> 'allowed' then suppressed := suppressed+1; end if;
    raise log 'sheree social aggregation delivered group=% type=% actors=% interactions=% push=% notification=%',
      grp.id,grp.interaction_type,v_actors,v_interactions,v_push_state,v_notification_id;
  end loop;

  return jsonb_build_object('delivered',delivered,'cancelled',cancelled,'push_suppressed',suppressed,'pruned',pruned);
end $$;
revoke all on function public.flush_social_notification_groups(integer) from public,anon,authenticated;
grant execute on function public.flush_social_notification_groups(integer) to service_role;
