/**
 * Where Convex gets its token: `POST /v1/auth/convex-token` (a 15-minute JWT
 * with audience `convex`, verified against the API's JWKS).
 */
export type ConvexTokenSource = {
  /** The signed-in account right now, or null. */
  currentUserId: () => string | null;
  issue: () => Promise<{ token: string; expires_in: number }>;
};

/** Ask for a new token this long before the cached one expires. */
const MARGIN_MS = 60_000;

/** Convex keeps this function for an account's lifetime, including token rotation. */
export function createMessagingTokenFetcher(
  source: ConvexTokenSource,
  userId: string | undefined,
  now: () => number = Date.now,
) {
  let cached: { token: string; expiresAt: number } | null = null;
  let inFlight: Promise<string | null> | null = null;

  const issue = () => {
    if (!inFlight) {
      inFlight = source
        .issue()
        .then(({ token, expires_in }) => {
          // Signed out or switched account while the token was being issued.
          if (source.currentUserId() !== userId) return null;
          cached = { token, expiresAt: now() + expires_in * 1000 };
          return token;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };

  return async ({ forceRefreshToken }: { forceRefreshToken: boolean }): Promise<string | null> => {
    if (!userId) return null;
    try {
      // Sign-out/account changes must not return another user's token.
      if (source.currentUserId() !== userId) {
        cached = null;
        return null;
      }
      if (!forceRefreshToken && cached && cached.expiresAt - MARGIN_MS > now()) return cached.token;
      return await issue();
    } catch {
      // Convex handles authentication failure. Do not create a second retry loop.
      return null;
    }
  };
}
