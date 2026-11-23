import { api } from "@/lib/api";
import { uploadPresignedImage, type MediaAsset, type UploadOptions } from "@/lib/media";
import { UPKEEP_KEY } from "@/features/upkeep/api";
import { invalidateCached, removeCached, setCached, updateCached } from "@/lib/query-cache";

/** `sheree-backend/docs/api/looks.md`. */
export type LookPhoto = {
  id: string;
  width: number;
  height: number;
  thumbnail: string;
  feed: string;
  original: string;
};

/** One entry in her look diary. */
export type Look = {
  id: string;
  title: string;
  category: string;
  category_name: string;
  done_on: string; // YYYY-MM-DD
  booking_id: string | null;
  /** Set for looks from a Sheree booking: "Book this again" opens their services. */
  professional_id: string | null;
  professional_name: string | null;
  price: number | null;
  rating: number | null;
  note: string | null;
  photos: LookPhoto[];
  created_at: string;
};

/** A finished Sheree booking she hasn't added a look for yet. */
export type LookPrompt = {
  booking_id: string;
  service_name: string;
  category: string;
  date: string;
  price: number | null;
  professional_id: string;
  professional_name: string | null;
  avatar_url: string | null;
};

/** A photo uploaded to R2, ready to be sent with a new look. */
export type UploadedLookPhoto = {
  id: string;
  variants: Array<{ name: string; width: number; height: number }>;
};

export type LookDetails = {
  title: string;
  category: string;
  done_on: string;
  professional_name: string | null;
  price: number | null;
  rating: number | null;
  note: string | null;
};

export type LooksPage = { items: Look[]; next_cursor: string | null };

export const fetchLooks = (cursor?: string | null) =>
  api.get<LooksPage>("/v1/me/looks", { query: cursor ? { cursor } : undefined });

export const fetchLook = (id: string) => api.get<Look>(`/v1/me/looks/${encodeURIComponent(id)}`);

export const fetchLookPrompts = () => api.get<LookPrompt[]>("/v1/me/looks/prompts");

// The Me page's card keeps the first page and the prompts for a minute, so
// moving around the app doesn't refetch them; any look change drops both.
export const LOOKS_TTL_MS = 5 * 60_000;
/** Cache keys (per signed-in person). The first page of looks, and the prompts. */
export const LOOKS_KEY = "me:looks";
export const PROMPTS_KEY = "me:look-prompts";
export const lookKey = (id: string) => `me:look:${id}`;


/**
 * After any look change: the first page and the prompts refetch (a look can
 * answer a prompt), and so does the beauty calendar, which counts looks as
 * "last done".
 */
function changedLooks() {
  invalidateCached(LOOKS_KEY);
  invalidateCached(PROMPTS_KEY);
  invalidateCached(UPKEEP_KEY);
}

/** A saved look is already the new state of its own page. */
async function savesLook(request: Promise<Look>): Promise<Look> {
  const look = await request;
  setCached(lookKey(look.id), look, LOOKS_TTL_MS);
  updateCached<LooksPage>(LOOKS_KEY, (page) => ({
    ...page,
    items: page.items.map((item) => (item.id === look.id ? look : item)),
  }));
  changedLooks();
  return look;
}

/** Resizes, uploads straight to R2, and returns what `createLook` needs. */
export async function uploadLookPhoto(asset: MediaAsset, options?: UploadOptions): Promise<UploadedLookPhoto> {
  const { ticket, variants } = await uploadPresignedImage(
    asset,
    (payload) =>
      api.post<{ photoId: string; variants: Array<{ name: string; uploadUrl: string }> }>(
        "/v1/me/looks/photo-uploads",
        { body: { variants: payload } },
      ),
    options,
  );
  return {
    id: ticket.photoId,
    variants: variants.map((v) => ({ name: v.name, width: v.width, height: v.height })),
  };
}

export const createLook = (input: LookDetails & { booking_id: string | null; photos: UploadedLookPhoto[] }) =>
  savesLook(api.post<Look>("/v1/me/looks", { body: input }));

export const updateLook = (id: string, changes: Partial<LookDetails>) =>
  savesLook(api.patch<Look>(`/v1/me/looks/${encodeURIComponent(id)}`, { body: changes }));

export async function deleteLook(id: string) {
  const result = await api.delete<{ deleted: true }>(`/v1/me/looks/${encodeURIComponent(id)}`);
  // Dropped, not invalidated: a refetch of a deleted look would only fail.
  removeCached(lookKey(id));
  updateCached<LooksPage>(LOOKS_KEY, (page) => ({ ...page, items: page.items.filter((item) => item.id !== id) }));
  changedLooks();
  return result;
}
