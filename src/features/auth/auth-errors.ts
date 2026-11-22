import { isApiError } from '@/lib/api/errors';
import { OFFLINE_MESSAGE, SESSION_EXPIRED_MESSAGE, isNetworkError, isSessionExpired, reportError } from '@/lib/errors';

export type AuthFlow = 'sign-in' | 'sign-up' | 'verify-code' | 'reset-code' | 'resend' | 'forgot-password' | 'update-password';

export type AuthFailureKind =
  | 'offline'
  | 'rate_limited'
  | 'invalid_credentials'
  | 'wrong_current_password'
  | 'email_not_confirmed'
  | 'email_exists'
  | 'weak_password'
  | 'code_expired'
  | 'code_invalid'
  | 'code_locked'
  | 'account_blocked'
  | 'account_not_found'
  | 'session_expired'
  | 'other';

export type AuthFailure = {
  kind: AuthFailureKind;
  message: string;
  /** True only when the typed one-time code itself was wrong, expired or used up. */
  clearCode: boolean;
};

export const RATE_LIMIT_MESSAGE = 'Too many attempts. Wait a minute and try again.';
export const INVALID_CREDENTIALS_MESSAGE = 'The email or password is incorrect.';
export const WRONG_CURRENT_PASSWORD_MESSAGE = 'Your current password is incorrect.';
export const EMAIL_EXISTS_MESSAGE =
  'That email already has a Sheree account. Sign in instead, or reset your password if you’ve forgotten it.';
export const CODE_EXPIRED_MESSAGE = 'That code has expired. Request a fresh one below.';
export const CODE_INVALID_MESSAGE = 'That code isn’t right. Check the email and try again.';
export const CODE_LOCKED_MESSAGE = 'Too many wrong codes. Request a fresh one below.';
export const UNVERIFIED_MESSAGE = 'Verify your email before signing in. Use the code we sent you, or request a new one.';
export const ACCOUNT_BLOCKED_MESSAGE = 'This account has been blocked. Contact Sheree support if you think this is a mistake.';
export const ACCOUNT_NOT_FOUND_MESSAGE =
  'We couldn’t find your Sheree account just yet. Try again in a few minutes, or contact support if this keeps happening.';

/** WorkOS sets the real minimum (10 on staging); the API passes it on as `details.min_length`. */
export function weakPasswordMessage(details?: unknown): string {
  const min = (details as { min_length?: unknown } | undefined)?.min_length;
  const length = typeof min === 'number' && min > 0 ? min : 10;
  return `Choose a stronger password: at least ${length} characters, and harder to guess.`;
}

const FALLBACKS: Record<AuthFlow, string> = {
  'sign-in': "We couldn't sign you in. Please try again.",
  'sign-up': "We couldn't create your account. Please try again in a few minutes.",
  'verify-code': "We couldn't check that code. Please try again.",
  'reset-code': "We couldn't check that code. Please try again.",
  resend: "We couldn't send a new code. Please try again in a minute.",
  'forgot-password': "We couldn't send a reset code. Please try again in a minute.",
  'update-password': "We couldn't update your password. Please try again.",
};

/**
 * Turn a Sheree API auth error into copy we wrote, by its stable `code`
 * (`sheree-backend/docs/api/auth.md`). Unknown errors get the flow's fallback
 * and are reported; server text is never shown.
 */
export function mapAuthError(error: unknown, flow: AuthFlow): AuthFailure {
  const make = (kind: AuthFailureKind, text: string, clearCode = false): AuthFailure => ({ kind, message: text, clearCode });

  if (isNetworkError(error)) return make('offline', OFFLINE_MESSAGE);
  if (!isApiError(error)) {
    reportError(error, `auth.${flow}`);
    return make('other', FALLBACKS[flow]);
  }
  switch (error.code) {
    case 'rate_limited':
      return make('rate_limited', RATE_LIMIT_MESSAGE);
    case 'invalid_credentials':
      return make('invalid_credentials', INVALID_CREDENTIALS_MESSAGE);
    case 'invalid_current_password':
      return make('wrong_current_password', WRONG_CURRENT_PASSWORD_MESSAGE);
    case 'email_verification_required':
      return make('email_not_confirmed', UNVERIFIED_MESSAGE);
    case 'email_already_registered':
      return make('email_exists', EMAIL_EXISTS_MESSAGE);
    case 'weak_password':
      return make('weak_password', weakPasswordMessage(error.details));
    case 'invalid_code':
      return make('code_invalid', CODE_INVALID_MESSAGE, true);
    case 'verification_expired':
      return make('code_expired', CODE_EXPIRED_MESSAGE, true);
    case 'code_locked':
      return make('code_locked', CODE_LOCKED_MESSAGE, true);
    case 'account_blocked':
      return make('account_blocked', ACCOUNT_BLOCKED_MESSAGE);
    case 'account_not_found':
      return make('account_not_found', ACCOUNT_NOT_FOUND_MESSAGE);
  }
  if (isSessionExpired(error)) return make('session_expired', SESSION_EXPIRED_MESSAGE);
  // 4xx refusals we have no copy for (mfa_required, sso_required, validation)
  // are expected outcomes, but worth knowing about while auth is new.
  reportError(error, `auth.${flow}`);
  return make('other', FALLBACKS[flow]);
}
