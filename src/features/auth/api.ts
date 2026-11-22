import { api, isApiError, type TokenResponse } from '@/lib/api';

/**
 * Auth routes of the Sheree API (`sheree-backend/docs/api/auth.md`). All of
 * them are public (`auth: 'none'`) except changing the password. Screens start
 * the session with `useAuth().startSession(tokens)`, never with the client
 * directly, so the profile is loaded in the same step.
 */

export type VerificationPending = {
  status: 'email_verification_required';
  pending_authentication_token: string;
};

/** `GET /v1/me`: the signed-in user's own account (`docs/api/profiles.md`). */
export type Account = {
  user_id: string;
  email: string | null;
  role: 'customer' | 'professional';
  username: string | null;
  avatar_url: string | null;
  phone: string | null;
  account_status: 'active' | 'suspended' | 'blocked';
  onboarding_step: string | null;
  onboarding_completed: boolean;
  wants_professional_account: boolean;
  professional: {
    id: string;
    business_name: string | null;
    profile_photo_url: string | null;
    is_verified: boolean;
    location: string | null;
    bio: string | null;
    /** instagram, tiktok, facebook, x, snapchat: a URL or null. */
    socials: Record<string, string | null>;
  } | null;
};

export const signIn = (email: string, password: string) =>
  api.post<TokenResponse>('/v1/auth/sign-in', { auth: 'none', body: { email, password } });

/** 202: usually a pending verification; tokens only if WorkOS skips verification. */
export const signUp = (email: string, password: string, username: string) =>
  api.post<VerificationPending | TokenResponse>('/v1/auth/sign-up', {
    auth: 'none',
    body: { email, password, username },
  });

export const verifyEmail = (pendingToken: string, code: string) =>
  api.post<TokenResponse>('/v1/auth/verify-email', {
    auth: 'none',
    body: { pending_authentication_token: pendingToken, code },
  });

/** Always succeeds for a well-formed email; it never says whether the account exists. */
export const requestPasswordReset = (email: string) =>
  api.post<{ status: 'sent_if_registered' }>('/v1/auth/password/forgot', { auth: 'none', body: { email } });

/** Checks the code and sets the password in one step; signs every other device out and this one in. */
export const resetPassword = (email: string, code: string, newPassword: string) =>
  api.post<TokenResponse>('/v1/auth/password/reset', {
    auth: 'none',
    body: { email, code, new_password: newPassword },
  });

/** Signed in: checks the current password and signs out the other devices. */
export const changePassword = (currentPassword: string, newPassword: string) =>
  api.post<void>('/v1/auth/password', {
    body: { current_password: currentPassword, new_password: newPassword },
  });

/** One-time move from a Supabase session (design.md §5.3). The server logs the Supabase session out. */
export const exchangeSupabaseSession = (tokens: { accessToken?: string; refreshToken?: string }) =>
  api.post<TokenResponse>('/v1/auth/exchange', {
    auth: 'none',
    body: {
      ...(tokens.accessToken ? { supabase_access_token: tokens.accessToken } : {}),
      ...(tokens.refreshToken ? { supabase_refresh_token: tokens.refreshToken } : {}),
    },
  });

export const fetchAccount = () => api.get<Account>('/v1/me');

export const isVerificationPending = (value: VerificationPending | TokenResponse): value is VerificationPending =>
  (value as VerificationPending).status === 'email_verification_required';

/** The token that `verify-email` needs, from sign-in's `403 email_verification_required`. */
export function pendingTokenFrom(error: unknown): string | null {
  if (!isApiError(error) || error.code !== 'email_verification_required') return null;
  const token = (error.details as { pending_authentication_token?: unknown } | undefined)
    ?.pending_authentication_token;
  return typeof token === 'string' && token ? token : null;
}
