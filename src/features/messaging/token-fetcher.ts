type TokenSession = { access_token: string; user: { id: string } };
type AuthResult = { data: { session: TokenSession | null }; error: unknown };
type SessionAuth = {
  getSession: () => Promise<AuthResult>;
  refreshSession: () => Promise<AuthResult>;
};

/** Convex keeps this function for an account's lifetime, including token rotation. */
export function createMessagingTokenFetcher(auth: SessionAuth, userId: string | undefined) {
  let refreshInFlight: Promise<AuthResult> | null = null;
  return async ({ forceRefreshToken }: { forceRefreshToken: boolean }): Promise<string | null> => {
    if (!userId) return null;
    try {
      const current = await auth.getSession();
      // Sign-out/account changes must not refresh or return another user's token.
      if (current.error || current.data.session?.user.id !== userId) return null;
      if (!forceRefreshToken) return current.data.session.access_token;
      if (!refreshInFlight) {
        refreshInFlight = auth.refreshSession().finally(() => { refreshInFlight = null; });
      }
      const refreshed = await refreshInFlight;
      if (refreshed.error || refreshed.data.session?.user.id !== userId) return null;
      return refreshed.data.session.access_token;
    } catch {
      // Convex handles authentication failure. Do not create a second retry loop.
      return null;
    }
  };
}
