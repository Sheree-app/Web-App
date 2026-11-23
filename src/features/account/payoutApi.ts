import { api } from '@/lib/api';
import { withServerMessage } from '@/lib/errors';
import { invalidateCached, setCached } from '@/lib/query-cache';

/**
 * Payout account through the Sheree API (`sheree-backend/docs/api/payments.md`).
 * Bodies and responses keep the camelCase contract of the `payout-account`
 * edge function this replaces, and its user-facing refusals.
 */
/**
 * Cache keys. Both start with `payout`, so they are never written to storage
 * (`@/lib/query-cache`); they live in memory for this tab only.
 */
export const PAYOUT_ACCOUNT_KEY = 'payout:account';
export const payoutInstitutionsKey = (method: PayoutMethod) => `payout:institutions:${method}`;
export const PAYOUT_ACCOUNT_TTL = 5 * 60_000;

export type PayoutMethod = 'ghipss' | 'mobile_money';
export type PayoutInstitution = { name: string; code: string; type: string };
export type PayoutAccount = {
  configured: boolean;
  method: PayoutMethod | null;
  institutionName: string | null;
  accountName: string | null;
  last4: string | null;
  configuredAt: string | null;
  /** Only on a save: false when the provider couldn't confirm the name on the account. */
  nameVerified?: boolean;
};

const call = async <T,>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw withServerMessage(error);
  }
};

export const fetchPayoutAccount = async () =>
  (await call(() => api.get<{ account: PayoutAccount }>('/v1/me/payout-account'))).account;

export const fetchPayoutInstitutions = async (method: PayoutMethod) =>
  (await call(() => api.get<{ institutions: PayoutInstitution[] }>('/v1/payout-institutions', { query: { type: method } }))).institutions;

export const savePayoutAccount = async (input: {
  method: PayoutMethod;
  bankCode: string;
  institutionName: string;
  accountNumber: string;
  accountName?: string;
}) => {
  const account = (await call(() => api.put<{ account: PayoutAccount }>('/v1/me/payout-account', { body: input }))).account;
  setCached(PAYOUT_ACCOUNT_KEY, account, PAYOUT_ACCOUNT_TTL);
  // The payouts page shows the account summary too.
  invalidateCached('payout:list');
  return account;
};
