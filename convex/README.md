# Web text messaging

The web app uses the same Convex deployment and Supabase accounts as mobile.
Bookings and payments remain in Supabase. This first web release sends text only;
existing photo, voice and quote messages are represented by descriptive placeholders.

## Configuration

Set `NEXT_PUBLIC_CONVEX_URL` in `.env.local` and in the web hosting environment to
`https://hearty-cobra-558.convex.cloud`. Restart the development server after changing it.
The public `.convex.site` URL is not needed by the text client. No service-role key
belongs in a `NEXT_PUBLIC_*` variable.

The existing Convex deployment must have `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` configured in its own environment for profile sync
and notification delivery. `auth.config.ts` verifies Supabase ES256 access tokens
with audience `authenticated`; the Supabase signing key must match this configuration.

## Routes and behavior

- `/messages`: customer/professional inboxes and per-thread unread counts.
- `/messages/[conversationId]`: paginated text history, send/retry, Sent/Read labels.
- The app header contains a Messages link with an unread total across both inboxes.
- Professional profiles contain a Message professional button. The professional
  profile ID is resolved to the Supabase account ID before creating the thread.
- Read acknowledgement occurs only with the newest history visible in a focused,
  visible tab. Reading older history or leaving the tab does not clear new arrivals.
- Failed sends retain their idempotency key when retried with the same text.
- Missing configuration and failed connections have explicit states; the rest of
  the app can still load. Sign-out removes access to messaging subscriptions.

## Verification

`bun run test:chat` runs schema-backed tests for inbox roles, read receipts,
presence, read-request races, authorization, and send idempotency.
`bun run test` runs pricing tests. `bun run build` verifies the web production build.

The read-cursor race fixes in `conversations.ts` require a Convex backend deploy.
Use `bun run convex:deploy` for the intended deployment, after reviewing the complete
folder: it also contains the pre-existing quote integrations and scheduled retention
jobs. This web integration does not deploy those jobs or change their schedules.

For an end-to-end check, use two test accounts: start from a professional profile,
send text, confirm the recipient badge increases, open the recipient thread and
confirm the sender sees Read. Repeat with the recipient tab hidden and with it
scrolled to older history; new messages must remain unread until shown.
