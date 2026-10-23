-- Admin → one specific user notification.
--
-- The notifications module could previously only broadcast to an audience or a
-- saved segment (see 202607260018_admin_notifications.sql). This adds targeted
-- delivery, so an administrator can look up a single account and notify exactly
-- that person (for example a support reply, an account heads-up, or a one-off
-- offer).
--
-- Delivery deliberately reuses the existing pipeline instead of sending from
-- here: a row in public.notifications with push_sent_at is null is drained by
-- the notification-worker edge function (scheduled in
-- 202609210003_schedule_notification_worker.sql). After queueing we nudge the
-- worker so a "send now" action goes out immediately rather than waiting for
-- the next five-minute tick, and the row is delivered on the next run anyway
-- even if that nudge fails.

-- Admin user picker: returns matching accounts plus how many push devices each
-- one can currently receive on, so the composer can warn about an unreachable
-- recipient before sending.
create or replace function public.admin_search_notification_targets(
  search_query text,
  result_limit integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  query text := trim(coalesce(search_query, ''));
  limited integer := least(greatest(coalesce(result_limit, 10), 1), 25);
begin
  if not public.admin_has_permission('notifications.manage') then
    raise exception 'Notifications access required' using errcode = '42501';
  end if;
  if char_length(query) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id,
      'username', x.username,
      'display_name', x.display_name,
      'role', x.role,
      'mobile_devices', x.mobile_devices,
      'web_devices', x.web_devices,
      'reachable', (x.mobile_devices + x.web_devices) > 0
    ) order by x.display_name)
    from (
      select
        u.id::text as id,
        coalesce(nullif(trim(u.username), ''), 'member-' || left(u.id::text, 8)) as username,
        coalesce(
          nullif(trim(pp.display_name), ''),
          nullif(trim(pp.business_name), ''),
          nullif(trim(u.username), ''),
          'Sheree member'
        ) as display_name,
        u.role::text as role,
        (
          select count(*) from public.push_tokens t
          where t.user_id = u.id and t.enabled and t.expo_push_token is not null
        ) as mobile_devices,
        (
          select count(*) from public.push_tokens t
          where t.user_id = u.id and t.enabled and t.web_push_subscription is not null
        ) as web_devices
      from public.users u
      left join public.professional_profiles pp on pp.user_id = u.id
      where coalesce(u.username, '') ilike '%' || query || '%'
         or coalesce(u.phone, '') ilike '%' || query || '%'
         or u.id::text = query
      order by display_name
      limit limited
    ) x
  ), '[]'::jsonb);
end;
$$;

comment on function public.admin_search_notification_targets(text, integer) is
  'Admin user picker for targeted notifications. Requires notifications.manage. Returns matching accounts with how many push devices each can currently receive on.';

create or replace function public.admin_send_user_notification(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid := nullif(payload ->> 'user_id', '')::uuid;
  target_role public.user_role;
  notice_kind public.notification_kind;
  notice_audience public.notification_audience;
  notice_title text := nullif(trim(payload ->> 'title'), '');
  notice_body text := nullif(trim(payload ->> 'body'), '');
  destination text := nullif(trim(payload ->> 'url'), '');
  is_offer boolean := (payload ->> 'purpose') = 'offer';
  device_count integer;
  new_id uuid;
begin
  if not public.admin_has_permission('notifications.manage') then
    raise exception 'Notifications access required' using errcode = '42501';
  end if;
  if target_user is null then
    raise exception 'Choose someone to notify' using errcode = '22023';
  end if;
  if notice_title is null or char_length(notice_title) > 100 then
    raise exception 'A title of up to 100 characters is required' using errcode = '22023';
  end if;
  if notice_body is null or char_length(notice_body) > 1000 then
    raise exception 'A message of up to 1000 characters is required' using errcode = '22023';
  end if;

  select u.role into target_role from public.users u where u.id = target_user;
  if not found then
    raise exception 'That account no longer exists' using errcode = '22023';
  end if;
  notice_audience := (case when target_role = 'professional' then 'professional' else 'customer' end)::public.notification_audience;

  -- Both intents map onto existing kinds so the mobile notification centre files
  -- them in the right tab: `message` ⇒ "Needs attention", `promotion` ⇒ "Updates
  -- & offers".
  notice_kind := (case when is_offer then 'promotion' else 'message' end)::public.notification_kind;

  insert into public.notifications(
    user_id, kind, title, body, url, data, audience,
    notification_type, category, reason, queued_for
  ) values (
    target_user,
    notice_kind,
    notice_title,
    notice_body,
    destination,
    jsonb_build_object(
      'type', 'ADMIN_DIRECT',
      'route', coalesce(destination, '/notifications'),
      'sentByAdmin', true
    ),
    notice_audience,
    'ADMIN_DIRECT',
    case when is_offer then 'marketing' else 'transactional' end,
    'Sent directly by an administrator',
    now()
  )
  returning id into new_id;

  select count(*) into device_count
  from public.push_tokens t
  where t.user_id = target_user and t.enabled;

  -- Best effort only: the notification row is already queued, so a worker
  -- hiccup just defers delivery to the next five-minute scheduled run.
  begin
    perform public.trigger_notification_worker();
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok', true,
    'id', new_id,
    'recipient', target_user,
    'recipient_name', (select coalesce(nullif(trim(u.username), ''), 'member') from public.users u where u.id = target_user),
    'devices', device_count
  );
end;
$$;

comment on function public.admin_send_user_notification(jsonb) is
  'Queues one notification (pushed immediately when possible) for a single user. Requires notifications.manage.';

revoke all on function public.admin_search_notification_targets(text, integer) from public, anon;

revoke all on function public.admin_send_user_notification(jsonb) from public, anon;

grant execute on function public.admin_search_notification_targets(text, integer) to authenticated;

grant execute on function public.admin_send_user_notification(jsonb) to authenticated;

