import {
  EMPTY_SOCIAL_LINKS,
  normalizeSocialLink,
  type SocialLinks,
  type SocialPlatform,
} from "@/features/profile/socials";
import { deleteMedia, feedUrl, uploadMedia } from "@/lib/media";
import { identifyMedia } from "@/lib/media/urls";
import { cachedQuery, updateCached } from "@/lib/query-cache";
import { supabase } from "@/lib/supabase";
import type { MediaAsset } from "@/lib/media/types";

export type AccountProfile = {
  name: string;
  email: string;
  avatar: string | null;
  phone: string;
  business: string;
  verified: boolean;
  location: string;
  socials: SocialLinks;
};
const accountKey = (userId: string, role: "customer" | "professional") =>
  `account:${userId}:${role}`;
const ACCOUNT_TTL = 5 * 60 * 1000;

export async function fetchAccountProfile(
  userId: string,
  role: "customer" | "professional",
  email: string,
): Promise<AccountProfile> {
  return cachedQuery(accountKey(userId, role), ACCOUNT_TTL, async () => {
    const [{ data: user, error: userError }, businessResult, socialResult] =
      await Promise.all([
        supabase
          .from("users")
          .select("username,avatar_url,phone")
          .eq("id", userId)
          .maybeSingle(),
        role === "professional"
          ? supabase
              .from("professional_profiles")
              .select("business_name,profile_photo_url,is_verified,location")
              .eq("user_id", userId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        role === "professional"
          ? supabase
              .from("professional_social_links" as never)
              .select("platform,url,professional_profiles!inner(user_id)")
              .eq("professional_profiles.user_id", userId)
          : Promise.resolve({ data: [], error: null }),
      ]);
    if (userError) throw userError;
    if (businessResult.error) throw businessResult.error;
    if (socialResult.error) throw socialResult.error;
    const business = businessResult.data;
    const socials = { ...EMPTY_SOCIAL_LINKS };
    for (const row of (socialResult.data ?? []) as unknown as Array<{
      platform: string;
      url: string;
    }>) {
      if (row.platform in socials)
        socials[row.platform as SocialPlatform] = row.url;
    }
    return {
      name: user?.username ?? "Sheree member",
      email,
      avatar: business?.profile_photo_url ?? user?.avatar_url ?? null,
      phone: user?.phone ?? "",
      business: business?.business_name ?? "",
      verified: Boolean(business?.is_verified),
      location: business?.location ?? "",
      socials,
    };
  });
}
export async function saveProfessionalSocialLinks(
  userId: string,
  values: Record<SocialPlatform, string>,
) {
  const professionalId = await fetchOwnProfessionalId(userId);
  const normalized = { ...EMPTY_SOCIAL_LINKS };
  for (const [platform, value] of Object.entries(values) as Array<
    [SocialPlatform, string]
  >)
    normalized[platform] = normalizeSocialLink(platform, value);
  const table = supabase.from("professional_social_links" as never);
  const rows = (
    Object.entries(normalized) as Array<[SocialPlatform, string | null]>
  )
    .filter((entry): entry is [SocialPlatform, string] => Boolean(entry[1]))
    .map(([platform, url]) => ({
      professional_id: professionalId,
      platform,
      url,
    }));
  if (rows.length) {
    const { error } = await table.upsert(rows as never, {
      onConflict: "professional_id,platform",
    });
    if (error) throw error;
  }
  const removed = (
    Object.entries(normalized) as Array<[SocialPlatform, string | null]>
  )
    .filter(([, url]) => !url)
    .map(([platform]) => platform);
  if (removed.length) {
    const { error } = await table
      .delete()
      .eq("professional_id", professionalId)
      .in("platform", removed);
    if (error) throw error;
  }
  updateCached<AccountProfile>(
    accountKey(userId, "professional"),
    (current) => ({ ...current, socials: normalized }),
  );
  updateCached<{
    socials: SocialLinks & {
      whatsapp: string | null;
      telephone: string | null;
    };
  }>(`creator:${professionalId}`, (current) => ({
    ...current,
    socials: { ...current.socials, ...normalized },
  }));
  return normalized;
}

export async function updateAccountProfile(
  userId: string,
  role: "customer" | "professional",
  values: {
    username: string;
    phone: string;
    businessName?: string;
    location?: string;
  },
) {
  const userResult = await supabase
    .from("users")
    .update({
      username: values.username.trim(),
      phone: values.phone.trim() || null,
    })
    .eq("id", userId);
  if (userResult.error) throw userResult.error;
  if (role === "professional") {
    const result = await supabase
      .from("professional_profiles")
      .update({
        business_name: values.businessName?.trim(),
        location: values.location?.trim() || null,
      })
      .eq("user_id", userId);
    if (result.error) throw result.error;
  }
  const { error } = await supabase.auth.updateUser({
    data: { username: values.username.trim() },
  });
  if (error) throw error;
  updateCached<AccountProfile>(accountKey(userId, role), (current) => ({
    ...current,
    name: values.username.trim(),
    phone: values.phone.trim(),
    business:
      role === "professional"
        ? (values.businessName?.trim() ?? "")
        : current.business,
    location:
      role === "professional"
        ? (values.location?.trim() ?? "")
        : current.location,
  }));
}
export async function deleteAccount() {
  const { data, error } = await supabase.functions.invoke("account-delete", {
    body: { confirmation: "DELETE" },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}
export async function fetchWantsProfessionalAccount(
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("users")
    .select("wants_professional_account")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.wants_professional_account);
}
export async function setWantsProfessionalAccount(value: boolean) {
  const { error } = await supabase.rpc("set_my_professional_intent", { value });
  if (error) throw error;
}
export async function fetchOwnProfessionalId(userId: string) {
  const { data, error } = await supabase
    .from("professional_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Finish setting up your business profile first.");
  return data.id;
}
export type LocationTravelSettings = {
  address: string;
  latitude: number | null;
  longitude: number | null;
  showOnMap: boolean;
  offersMobile: boolean;
  travelFee: number;
};
export async function fetchLocationTravelSettings(): Promise<LocationTravelSettings> {
  const { data, error } = await supabase.rpc(
    "get_my_location_travel_settings" as never,
  );
  if (error) throw error;
  if (!data) throw new Error("Your business profile could not be found.");
  const value = data as unknown as {
    address?: string;
    latitude?: number | null;
    longitude?: number | null;
    show_on_map?: boolean;
    offers_mobile?: boolean;
    travel_fee?: number | string;
  };
  return {
    address: value.address ?? "",
    latitude: value.latitude ?? null,
    longitude: value.longitude ?? null,
    showOnMap: value.show_on_map !== false,
    offersMobile: Boolean(value.offers_mobile),
    travelFee: Number(value.travel_fee ?? 0),
  };
}
export async function saveLocationTravelSettings(
  value: LocationTravelSettings,
) {
  if (value.latitude === null || value.longitude === null)
    throw new Error("Drop a pin for your business location.");
  const { error } = await supabase.rpc(
    "save_my_location_travel_settings" as never,
    {
      address_value: value.address,
      latitude_value: value.latitude,
      longitude_value: value.longitude,
      offers_mobile_value: value.offersMobile,
      travel_fee_value: value.offersMobile ? value.travelFee : 0,
    } as never,
  );
  if (error) throw error;
  const { error: visibilityError } = await supabase.rpc(
    "set_my_map_visibility" as never,
    { visible: value.showOnMap } as never,
  );
  if (visibilityError) throw visibilityError;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user.id)
    updateCached<AccountProfile>(
      accountKey(session.user.id, "professional"),
      (current) => ({ ...current, location: value.address.trim() }),
    );
}
export async function uploadAccountAvatar(
  userId: string,
  role: "customer" | "professional",
  asset: MediaAsset,
) {
  const { data: existing } = await supabase
    .from("users")
    .select("avatar_url")
    .eq("id", userId)
    .maybeSingle();
  const media = await uploadMedia("profile", asset);
  // Avatars are rendered small; the 720px feed variant is crisp on high-DPI
  // screens without shipping the full-resolution original.
  const url = feedUrl(media);
  const userResult = await supabase
    .from("users")
    .update({ avatar_url: url })
    .eq("id", userId);
  if (userResult.error) {
    await deleteMedia(media).catch(() => undefined);
    throw userResult.error;
  }
  if (role === "professional") {
    const result = await supabase
      .from("professional_profiles")
      .update({ profile_photo_url: url })
      .eq("user_id", userId);
    if (result.error) throw result.error;
  }
  // Replace old avatar (R2 object or legacy Supabase object) best-effort.
  const previous = existing?.avatar_url
    ? identifyMedia(existing.avatar_url)
    : null;
  if (previous) void deleteMedia(previous).catch(() => undefined);
  updateCached<AccountProfile>(accountKey(userId, role), (current) => ({
    ...current,
    avatar: url,
  }));
  return url;
}
