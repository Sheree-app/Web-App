# Sheree

Sheree is a marketplace for hair, beauty, wellness and grooming professionals —
mostly in Ghana. This repository is the **web client**: mobile-first, installable,
and backed by the same Supabase project the mobile app used.

> The original React Native app is kept in [`mobile/`](mobile) as reference. It is
> excluded from the build; see [MIGRATION.md](MIGRATION.md) for how the port was done,
> what is shared with the backend, and what is left to build.

## Running it

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
bun run build      # production build
bun run start      # serve the build
bun run lint       # eslint
bunx tsc --noEmit  # types
```

Configuration is read from `.env.local`. The variables are still named for Expo
(`EXPO_PUBLIC_*`) and `next.config.ts` re-exports them under `NEXT_PUBLIC_*`, so the
existing file works as-is. See [MIGRATION.md](MIGRATION.md#environment).

## What's in here

```
src/
  app/                     routes (App Router)
    (auth)/                welcome-adjacent account screens
    (app)/                 the signed-in frame
      (protected)/         routes that need an account
      studio/              the professional side
    auth/callback/         where emailed links land
  components/
    brand/                 wordmark, lookbook rail, launch splash
    shell/                 app frame, navigation, guards
    ui/                    the design system's primitives
  features/                one folder per domain (explore, booking, feed, …)
  lib/                     supabase clients, media pipeline, storage, utils
  providers/               theme, auth, toasts
  proxy.ts                 Next 16 proxy: session refresh + route guards
```

## How it is put together

**Mobile first, then widened.** Every screen is built for a phone: bottom navigation,
sheet-based details, thumb-sized controls, safe-area padding. From `md` up the
navigation moves into the header, lists become grids and sheets become dialogs —
nobody gets a stretched phone.

**One palette, two schemes.** The colours, type scale and radii live in
[`src/app/globals.css`](src/app/globals.css) as design tokens, with light and dark
values side by side. A small inline script applies the stored preference before the
first paint, so there is no flash of the wrong theme.

**Data is client-side and cached.** Feature modules fetch through
`supabase-js` and [`src/lib/query-cache.ts`](src/lib/query-cache.ts), which
de-duplicates in-flight requests and keeps hot results between navigations. The
server is used for session checks and email-link round-trips, not for rendering other
people's data.

**Every write is optimistic where it can be.** Likes, saves, cancellations and
reschedules update immediately and roll back if the request fails.

## Accounts to try

Sign-up flow: create an account → confirm the six-digit code → pick what you're into →
land in the lookbook. Choosing "I create" instead leads to professional setup, which
opens the studio (services, calendar, posts, payouts).
