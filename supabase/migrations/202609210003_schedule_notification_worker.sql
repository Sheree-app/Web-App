-- Schedule the notification worker from the database.
--
-- `notification-worker` is responsible for everything that leaves Sheree as a
-- push: due reminders/digests, the social aggregation flush, the Expo send, and
-- the receipt reconciliation. Until now the schedule lived in the Dashboard, so a
-- branch, a restored project or a mis-click could silently stop all pushes. This
-- puts the schedule in the schema instead, at the 5-minute cadence the social
-- aggregation window expects.
--
-- The dispatch secret is never stored in the repo or in this migration: it is read
-- from Supabase Vault at call time. Create it once (SQL editor):
--
--   select vault.create_secret(
--     '<NOTIFICATION_DISPATCH_SECRET>',
--     'notification_dispatch_secret',
--     'x-dispatch-secret value for the Sheree notification worker');
--
-- Until that secret exists the job is a no-op that logs a warning, so applying
-- this migration first and creating the secret second is safe.

create table if not exists public.notification_worker_config (
  id boolean primary key default true check (id),
  -- Override if the app is ever deployed under another project ref.
  worker_url text not null default 'https://pjplmsceqzwwmdhwlwnt.supabase.co/functions/v1/notification-worker',
  schedule text not null default '*/5 * * * *',
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.notification_worker_config(id) values(true) on conflict(id) do nothing;

alter table public.notification_worker_config enable row level security;
revoke all on public.notification_worker_config from anon,authenticated;
grant all on public.notification_worker_config to service_role;

comment on table public.notification_worker_config is
  'Single-row schedule configuration for notification-worker (URL, cron expression, kill switch). The dispatch secret itself lives in Supabase Vault.';

create or replace function public.trigger_notification_worker()
returns void language plpgsql security definer set search_path='' as $$
declare cfg public.notification_worker_config; secret text;
begin
  select * into cfg from public.notification_worker_config where id;
  if not found or not cfg.enabled then return; end if;

  -- Aggregated engagement is flushed here as well as inside the worker, so a
  -- deploy that predates the aggregation work still delivers aggregated pushes
  -- instead of leaving settled groups pending. Both calls are idempotent.
  perform public.flush_social_notification_groups(200);

  if cfg.worker_url is null then
    raise warning 'Sheree notification worker has no worker_url configured; nothing was dispatched.';
    return;
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise warning 'Sheree notification worker cannot dispatch: Supabase Vault is unavailable, so the dispatch secret cannot be read.';
    return;
  end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name='notification_dispatch_secret';
  if secret is null then
    raise warning 'Sheree notification worker is idle: create a Vault secret named notification_dispatch_secret.';
    return;
  end if;

  perform net.http_post(
    url := cfg.worker_url,
    headers := jsonb_build_object('Content-Type','application/json','x-dispatch-secret',secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000);
  raise log 'Sheree notification worker dispatched (schedule %)',cfg.schedule;
end $$;
revoke all on function public.trigger_notification_worker() from public,anon,authenticated;
grant execute on function public.trigger_notification_worker() to service_role;

-- `cron.schedule` replaces a job that already carries this name, so re-applying
-- the migration — or changing `schedule` and re-running it — reschedules rather
-- than duplicating. It also supersedes any Dashboard/HTTP cron with the same job
-- name, which is why switching to it cannot leave two schedulers firing.
select cron.schedule(
  'sheree-notification-worker',
  (select schedule from public.notification_worker_config where id),
  $cron$select public.trigger_notification_worker()$cron$
);
