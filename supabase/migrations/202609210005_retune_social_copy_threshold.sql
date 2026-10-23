-- Retune the aggregated copy threshold.
--
-- The crowd form ("12 people saved your post") should start at ten actors, not
-- twenty, so every phrasing the product asked for is reachable:
--
--   four actors  -> "Sarah and 3 others liked your post"
--   five actors  -> "Ama and 4 others commented on your post"
--   twelve       -> "12 people saved your post"
--   twenty-five  -> "25 people liked your post"
--
-- 202609210002 ships this value for fresh environments; this migration retunes
-- databases that were migrated before it. It is safe to re-run.

alter table public.notification_aggregation_config alter column crowd_threshold set default 10;
update public.notification_aggregation_config set crowd_threshold=10, updated_at=now() where crowd_threshold=20;

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
