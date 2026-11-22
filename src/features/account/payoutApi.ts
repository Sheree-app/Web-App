import { api } from '@/lib/api';
import { withServerMessage } from '@/lib/errors';

/**
 * Payout account through the Sheree API (`sheree-backend/docs/api/payments.md`).
 * Bodies and responses keep the camelCase contract of the `payout-account`
 * edge function this replaces, and its user-facing refusals.
 */
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
}) => (await call(() => api.put<{ account: PayoutAccount }>('/v1/me/payout-account', { body: input }))).account;
