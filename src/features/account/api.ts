import { fetchAccount, type Account } from "@/features/auth/api";
import {
  EMPTY_SOCIAL_LINKS,
  normalizeSocialLink,
  type SocialLinks,
  type SocialPlatform,
} from "@/features/profile/socials";
import { api } from "@/lib/api";
import { AppError, errorCode } from "@/lib/errors";
import { uploadMedia, deleteMedia } from "@/lib/media";
import type { MediaAsset } from "@/lib/media/types";
import { creatorProfileKey } from "@/features/profile/api";
import { cachedQuery, updateCached } from "@/lib/query-cache";

/**
 * The signed-in user's own account, through the Sheree API
 * (`sheree-backend/docs/api/profiles.md`, `account.md`, `schedule.md`). Function
 * signatures are unchanged from the Supabase version, so screens still pass the
 * user id they hold; the API itself always acts on the signed-in user.
 */
export type AccountProfile = {
  name: string;
  email: string;
  avatar: string | null;
  phone: string;
  business: string;
  verified: boolean;
  location: string;
  /** Short public introduction clients read on the profile. */
  bio: string;
  socials: SocialLinks;
};
/** Cache key (the cache belongs to the signed-in person, so no user id). */
export const accountQueryKey = (role: "customer" | "professional") => `me:account:${role}`;
// The user id stays in the signature for existing callers.
const accountKey = (_userId: string, role: "customer" | "professional") => accountQueryKey(role);
export const ACCOUNT_TTL = 5 * 60 * 1000;
/**
 * `GET /v1/me` as the API returns it (username, phone, the professional-account
 * wish), for the personal details and settings screens.
 */
export const ACCOUNT_DETAILS_KEY = "me:details";

export async function fetchAccountProfile(
  userId: string,
  role: "customer" | "professional",
  email: string,
): Promise<AccountProfile> {
  return cachedQuery(accountKey(userId, role), ACCOUNT_TTL, () => loadAccountProfile(role, email));
}

/** `GET /v1/me` shaped for the profile screens; always a network read. */
export async function loadAccountProfile(
  role: "customer" | "professional",
  email: string,
): Promise<AccountProfile> {
  const account = await fetchAccount();
  const business = role === "professional" ? account.professional : null;
  const socials = { ...EMPTY_SOCIAL_LINKS };
  const stored = business?.socials ?? {};
  for (const platform of Object.keys(socials) as SocialPlatform[])
    socials[platform] = stored[platform] ?? null;
  return {
    name: account.username ?? "Sheree member",
    email: account.email ?? email,
    avatar: business?.profile_photo_url ?? account.avatar_url ?? null,
    phone: account.phone ?? "",
    business: business?.business_name ?? "",
    verified: Boolean(business?.is_verified),
    location: business?.location ?? "",
    bio: business?.bio ?? "",
    socials,
  };
}

/** Sets every platform at once: a link saves it, an empty value removes it. */
export async function saveProfessionalSocialLinks(
  userId: string,
  values: Record<SocialPlatform, string>,
) {
  const normalized = { ...EMPTY_SOCIAL_LINKS };
  for (const [platform, value] of Object.entries(values) as Array<[SocialPlatform, string]>)
    normalized[platform] = normalizeSocialLink(platform, value);
  const stored = await api.put<SocialLinks>("/v1/me/social-links", { body: normalized });
  updateCached<AccountProfile>(accountKey(userId, "professional"), (current) => ({
    ...current,
    socials: stored,
  }));
  const professionalId = await fetchOwnProfessionalId(userId).catch(() => null);
  if (professionalId)
    updateCached<{ socials: SocialLinks & { whatsapp: string | null; telephone: string | null } }>(
      creatorProfileKey(professionalId),
      (current) => ({ ...current, socials: { ...current.socials, ...stored } }),
    );
  return stored;
}

export async function updateAccountProfile(
  userId: string,
  role: "customer" | "professional",
  values: {
    username: string;
    phone: string;
    businessName?: string;
    location?: string;
    bio?: string;
  },
) {
  await api.patch<void>("/v1/me", {
    body: { username: values.username.trim(), phone: values.phone.trim() || null },
  });
  if (role === "professional") {
    await api.patch<void>("/v1/me/professional", {
      body: {
        ...(values.businessName === undefined ? {} : { business_name: values.businessName.trim() }),
        // Location is edited from the Location & travel screen, not the profile
        // sheet, so an omitted value must leave the stored one alone.
        ...(values.location === undefined ? {} : { location: values.location.trim() || null }),
        ...(values.bio === undefined ? {} : { bio: values.bio.trim() || null }),
      },
    });
  }
  updateCached<Account>(ACCOUNT_DETAILS_KEY, (current) => ({
    ...current,
    username: values.username.trim(),
    phone: values.phone.trim() || null,
  }));
  updateCached<AccountProfile>(accountKey(userId, role), (current) => ({
    ...current,
    name: values.username.trim(),
    phone: values.phone.trim(),
    business:
      role === "professional" ? (values.businessName?.trim() ?? current.business) : current.business,
    location:
      role === "professional" && values.location !== undefined ? values.location.trim() : current.location,
    bio: role === "professional" && values.bio !== undefined ? values.bio.trim() : current.bio,
  }));
}

/** Saves just the professional's public bio, leaving every other field alone. */
export async function updateAccountBio(userId: string, bio: string) {
  const next = bio.trim();
  await api.patch<void>("/v1/me/professional", { body: { bio: next || null } });
  updateCached<AccountProfile>(accountKey(userId, "professional"), (current) => ({
    ...current,
    bio: next,
  }));
  return next;
}

/**
 * Deletes the account. Open bookings, payments, payouts or disputes refuse it
 * with a message written for the user (one sentence per blocker); a step that
 * fails part-way carries a support code in its message. Both are shown as-is.
 * The caller signs out afterwards: the session can no longer refresh.
 */
export async function deleteAccount() {
  try {
    await api.post<{ deleted: true }>("/v1/me/deletion", { body: { confirmation: "DELETE" } });
  } catch (error) {
    const code = errorCode(error);
    if ((code === "account_has_open_items" || code === "delete_incomplete") && error instanceof Error && error.message)
      throw new AppError(error.message, code);
    throw error;
  }
}

// The API acts on the signed-in user; the parameters keep the old signature.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function fetchWantsProfessionalAccount(_userId: string): Promise<boolean> {
  return Boolean((await fetchAccount()).wants_professional_account);
}

export async function setWantsProfessionalAccount(value: boolean) {
  await api.put<void>("/v1/me/professional-intent", { body: { value } });
  updateCached<Account>(ACCOUNT_DETAILS_KEY, (current) => ({ ...current, wants_professional_account: value }));
}

// The API acts on the signed-in user; the parameters keep the old signature.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function fetchOwnProfessionalId(_userId: string) {
  const account = await fetchAccount();
  if (!account.professional) throw new AppError("Finish setting up your business profile first.");
  return account.professional.id;
}

export type LocationTravelSettings = {
  address: string;
  latitude: number | null;
  longitude: number | null;
  showOnMap: boolean;
  offersMobile: boolean;
  travelFee: number;
};
type LocationTravelRow = {
  address: string;
  latitude: number | null;
  longitude: number | null;
  show_on_map: boolean;
  offers_mobile: boolean;
  travel_fee: number;
};
const toLocationTravel = (value: LocationTravelRow): LocationTravelSettings => ({
  address: value.address ?? "",
  latitude: value.latitude ?? null,
  longitude: value.longitude ?? null,
  showOnMap: value.show_on_map !== false,
  offersMobile: Boolean(value.offers_mobile),
  travelFee: Number(value.travel_fee ?? 0),
});

export async function fetchLocationTravelSettings(): Promise<LocationTravelSettings> {
  try {
    return toLocationTravel(await api.get<LocationTravelRow>("/v1/me/location-travel"));
  } catch (error) {
    if (errorCode(error) === "not_a_professional")
      throw new AppError("Your business profile could not be found.");
    throw error;
  }
}

/** Address, pin, travel fee and map visibility, saved in one transaction. */
export async function saveLocationTravelSettings(value: LocationTravelSettings) {
  if (value.latitude === null || value.longitude === null)
    throw new AppError("Drop a pin for your business location.");
  const saved = await api.put<LocationTravelRow>("/v1/me/location-travel", {
    body: {
      address: value.address.trim(),
      latitude: value.latitude,
      longitude: value.longitude,
      offers_mobile: value.offersMobile,
      travel_fee: value.offersMobile ? value.travelFee : 0,
      show_on_map: value.showOnMap,
    },
  });
  const userId = api.session.user()?.id;
  if (userId)
    updateCached<AccountProfile>(accountKey(userId, "professional"), (current) => ({
      ...current,
      location: saved.address.trim(),
    }));
}

/**
 * Uploads a new avatar and makes it the account's (and, for a professional,
 * the profile photo). The server removes the previous avatar upload.
 */
export async function uploadAccountAvatar(
  userId: string,
  role: "customer" | "professional",
  asset: MediaAsset,
) {
  const media = await uploadMedia("profile", asset);
  let url: string;
  try {
    ({ avatar_url: url } = await api.put<{ avatar_url: string }>("/v1/me/avatar", {
      body: { media_id: media.mediaId },
    }));
  } catch (error) {
    await deleteMedia(media).catch(() => undefined);
    throw error;
  }
  updateCached<AccountProfile>(accountKey(userId, role), (current) => ({
    ...current,
    avatar: url,
  }));
  return url;
}
