-- Admin campaign delivery is triggered from the database, not from the admin panel.
--
-- Until now `POST /api/admin/notifications` called the
-- `notification-campaign-dispatch` Edge Function directly and proved itself with a
-- `NOTIFICATION_DISPATCH_SECRET` copied out of the admin panel environment. The
-- function keeps its own copy of the same value in its own environment, so a deploy
-- that updates one side but not the other silently breaks every "send now" campaign
-- with `{"error":"Unauthorized"}` — exactly what happened to campaign
-- ff759cb2-2214-4f15-a56b-f7a78d31248c — and the campaign row is left sitting in
-- `scheduled` with nobody left to pick it up.
--
-- Two things change:
--
-- 1. The secret lives in exactly one place, Supabase Vault, under the name
--    `notification_dispatch_secret` — the same secret `trigger_notification_worker()`
--    already uses (see 202609210003_schedule_notification_worker.sql). The Edge
--    Function reads it back through `notification_dispatch_secret()`, so the app env
--    and the function env can no longer disagree.
-- 2. Due campaigns are swept every five minutes from Postgres with pg_net, so a
--    campaign is delivered even when the nudge from the admin panel never happens
--    (worker hiccup, closed tab, a scheduled send nobody triggered).
--
-- The vault secret is never stored in the repo or in this migration. Create it once
-- (SQL editor) if it does not exist yet:
--
--   select vault.create_secret(
--     '<NOTIFICATION_DISPATCH_SECRET>',
--     'notification_dispatch_secret',
--     'x-dispatch-secret value for the Sheree notification workers');
--
-- Until it exists campaign sends report "Push delivery is not configured" instead of
-- pretending to succeed, and the cron sweep logs a warning rather than failing.

create table if not exists public.notification_campaign_worker_config (
  id boolean primary key default true check (id),
  -- Override if the app is ever deployed under another project ref.
  worker_url text not null default 'https://pjplmsceqzwwmdhwlwnt.supabase.co/functions/v1/notification-campaign-dispatch',
  schedule text not null default '*/5 * * * *',
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.notification_campaign_worker_config(id) values(true) on conflict(id) do nothing;

alter table public.notification_campaign_worker_config enable row level security;

revoke all on public.notification_campaign_worker_config from anon, authenticated;

grant all on public.notification_campaign_worker_config to service_role;

comment on table public.notification_campaign_worker_config is
  'Single-row schedule configuration for notification-campaign-dispatch (URL, cron expression, kill switch). The dispatch secret itself lives in Supabase Vault.';

-- Read side of the single shared secret. Only the service role — which is what the
-- Edge Function authenticates as — can read it, so nothing in the admin panel or in
-- a mobile client can ever see it.
create or replace function public.notification_dispatch_secret()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'notification_dispatch_secret';
$$;

revoke all on function public.notification_dispatch_secret() from public, anon, authenticated;

grant execute on function public.notification_dispatch_secret() to service_role;

-- Nudge the campaign worker once. Returns a status the composer can show, never
-- raises for an unconfigured deployment: a campaign that cannot be nudged is still
-- claimed by the scheduled sweep as soon as the configuration is fixed.
create or replace function public.notification_campaign_dispatch_nudge()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg public.notification_campaign_worker_config;
  secret text;
begin
  select * into cfg from public.notification_campaign_worker_config where id;
  if not found or not cfg.enabled or cfg.worker_url is null then
    return jsonb_build_object('dispatched', false, 'message', 'Campaign delivery is switched off.');
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    return jsonb_build_object('dispatched', false,
      'message', 'Push delivery is not configured: Supabase Vault is unavailable, so the dispatch secret cannot be read.');
  end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'notification_dispatch_secret';
  if secret is null then
    return jsonb_build_object('dispatched', false,
      'message', 'Push delivery is not configured: create a Vault secret named notification_dispatch_secret.');
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'net' and p.proname = 'http_post'
  ) then
    return jsonb_build_object('dispatched', false,
      'message', 'Push delivery is not configured: enable the pg_net extension.');
  end if;

  perform net.http_post(
    url := cfg.worker_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000);

  -- pg_net queues the call and sends it once this transaction commits, so the
  -- campaign row is always visible to the worker that claims it. The worker's own
  -- answer cannot be awaited from here, so the message stays honest about that:
  -- a campaign left in `scheduled` beyond one sweep means the worker refused the
  -- nudge (check the function logs / net._http_response).
  return jsonb_build_object('dispatched', true,
    'message', 'Delivery request queued. Recipient and failure counts appear once the worker finishes.');
end $$;

revoke all on function public.notification_campaign_dispatch_nudge() from public, anon, authenticated;

grant execute on function public.notification_campaign_dispatch_nudge() to service_role;

-- Cron entry point. Same shape as trigger_notification_worker(): a misconfigured
-- deployment warns and stays idle instead of spamming errors every tick.
create or replace function public.trigger_notification_campaign_dispatch()
returns void language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  result := public.notification_campaign_dispatch_nudge();
  if not coalesce((result ->> 'dispatched')::boolean, false) then
    raise warning 'Sheree notification campaign dispatcher idle: %', result ->> 'message';
  end if;
end $$;

revoke all on function public.trigger_notification_campaign_dispatch() from public, anon, authenticated;

grant execute on function public.trigger_notification_campaign_dispatch() to service_role;

-- Campaigns now dispatch themselves. `cron.schedule` replaces a job already carrying
-- this name, so re-applying the migration (or editing `schedule` and re-running it)
-- reschedules rather than duplicating.
select cron.schedule(
  'sheree-notification-campaign-dispatch',
  (select schedule from public.notification_campaign_worker_config where id),
  $cron$select public.trigger_notification_campaign_dispatch()$cron$);

-- "Send now" used to be a scheduler concern only. It now nudges the worker from
-- inside the same transaction that queues the campaign, and reports back whether the
-- nudge was possible, so the composer can say something true instead of a 502.
create or replace function public.admin_save_notification_campaign(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
  send_at timestamptz;
  campaign_status text;
  is_immediate boolean := coalesce((payload ->> 'send_now')::boolean, false);
  nudge jsonb;
begin
  if not public.admin_has_permission('notifications.manage') then
    raise exception 'Notifications access required' using errcode = '42501';
  end if;
  send_at := nullif(payload ->> 'scheduled_at', '')::timestamptz;
  campaign_status := case when is_immediate or send_at is not null then 'scheduled' else 'draft' end;
  insert into public.notification_campaigns(
    name,title,body,channels,audience,segment_id,promotion_id,destination_url,banner_image_url,
    status,scheduled_at,created_by
  ) values(
    trim(payload ->> 'name'),trim(payload ->> 'title'),trim(payload ->> 'body'),
    array(select jsonb_array_elements_text(payload -> 'channels')),payload ->> 'audience',
    nullif(payload ->> 'segment_id', '')::uuid,nullif(payload ->> 'promotion_id', '')::uuid,
    nullif(payload ->> 'destination_url', ''),nullif(payload ->> 'banner_image_url', ''),
    campaign_status,case when is_immediate then now() else send_at end,(select auth.uid())
  ) returning id into new_id;

  if not is_immediate then
    return jsonb_build_object('ok', true, 'id', new_id, 'status', campaign_status);
  end if;

  -- Best effort only: the row is already scheduled_at now(), so the sweep picks it up
  -- on its next tick even if this nudge fails or the deployment is not configured yet.
  begin
    nudge := public.notification_campaign_dispatch_nudge();
  exception when others then
    nudge := jsonb_build_object('dispatched', false, 'message', SQLERRM);
  end;

  return jsonb_build_object('ok', true, 'id', new_id, 'status', campaign_status, 'dispatch', nudge);
end $$;
