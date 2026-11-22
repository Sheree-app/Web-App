import type { TokenResponse } from '@/lib/api';
import { pendingTokenFrom, signIn } from './api';

/**
 * The email-verification step needs the `pending_authentication_token` that
 * sign-up or sign-in returned, and the API has no separate "resend code"
 * route: signing in again as an unverified user is what sends a fresh code and
 * a fresh token. So, between those screens, the email, the token and the
 * password typed a moment ago are held here, in memory only. They are never
 * put in route params (which navigation state keeps) or on disk, and they are
 * dropped as soon as the email is verified, the flow is abandoned or 20
 * minutes pass. After an app restart they are gone and the person signs in
 * again, which sends a new code.
 */
type Pending = { email: string; token: string; password: string; at: number };

const MAX_AGE_MS = 20 * 60 * 1000;
let pending: Pending | null = null;

export function holdVerification(email: string, token: string, password: string) {
  pending = { email, token, password, at: Date.now() };
}

/** The held verification for this email, if it is still fresh. */
export function heldVerification(email: string): { token: string } | null {
  if (!pending || pending.email !== email || Date.now() - pending.at > MAX_AGE_MS) return null;
  return { token: pending.token };
}

export function clearVerification() {
  pending = null;
}

export type ResendResult =
  | { kind: 'sent' }
  | { kind: 'sign_in_again' }
  | { kind: 'verified'; tokens: TokenResponse };

/**
 * Asks for a new code by signing in again with the held password. Resolves to
 * `sign_in_again` when nothing is held (restart, or older than 20 minutes),
 * and to `verified`, with the tokens of that sign-in, if the account turned
 * out to be verified already. Any other failure is thrown for the screen to map.
 */
export async function resendVerification(email: string): Promise<ResendResult> {
  if (!pending || pending.email !== email || Date.now() - pending.at > MAX_AGE_MS) return { kind: 'sign_in_again' };
  const { password } = pending;
  try {
    const tokens = await signIn(email, password);
    // Signed in without a code: the email was verified meanwhile.
    clearVerification();
    return { kind: 'verified', tokens };
  } catch (error) {
    const token = pendingTokenFrom(error);
    if (!token) throw error;
    holdVerification(email, token, password);
    return { kind: 'sent' };
  }
}
