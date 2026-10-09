# Notification worker

Deploy `notification-worker` and schedule an authenticated POST every 15 minutes.
The same call is safe to retry: database idempotency keys prevent duplicate generation and the worker only selects unsent rows.

Required secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NOTIFICATION_DISPATCH_SECRET`
- `EXPO_ACCESS_TOKEN` (recommended when Expo enhanced push security is enabled)

Example Supabase Dashboard Cron job (HTTP request):

- Method: `POST`
- URL: `https://<project-ref>.supabase.co/functions/v1/notification-worker`
- Header: `x-dispatch-secret: <NOTIFICATION_DISPATCH_SECRET>`
- Schedule: `*/15 * * * *`

The worker first runs `run_notification_scheduler()`, sends due queue entries in batches, retries transient failures up to three times, checks Expo receipts, records delivery, and disables tokens reported as `DeviceNotRegistered`.
