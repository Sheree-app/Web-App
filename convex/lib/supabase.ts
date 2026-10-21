/**
 * Server-to-server access to the existing Sheree (Supabase) backend.
 *
 * Messaging owns conversations, messages and price cards, but bookings,
 * profiles, services and notifications stay in Postgres. This module is how
 * Convex reaches them — always with the service role key, so *no* trust is
 * placed in anything the client sends. Every value read here is re-checked
 * against the caller's identity before it is used.
 *
 * Required Convex deployment env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set on this Convex deployment. Messaging cannot reach the booking backend without it.`,
    );
  }
  return value;
}

function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/**
 * Both identities of one account, kept separate.
 *
 * A user who owns a professional profile still has a personal name and avatar —
 * those are what the other side of a conversation must see when this account is
 * the *customer*. Collapsing them into one field is what made customers who own
 * a business render under their business name.
 */
export type ProfileSnapshot = {
  userId: string;
  /** Personal/customer-facing name (`users.username`). Never a business name. */
  username: string;
  /** Personal avatar (`users.avatar_url`). */
  personalAvatarUrl: string | null;
  /** Business name from the professional profile, or null when there is none. */
  professionalName: string | null;
  /** Professional profile photo, or null when there is no professional profile. */
  professionalAvatarUrl: string | null;
  /** Account-level role: informational, never the conversation role. */
  role: "customer" | "professional";
};

export type BookingSnapshot = {
  id: string;
  customerId: string;
  professionalProfileId: string;
  professionalUserId: string | null;
  serviceId: string | null;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  paymentStatus: string;
  price: number;
  priceCardId: string | null;
};

function quote(value: string): string {
  // PostgREST `in.(...)` list values are quoted so uuids and ids are safe.
  return `"${value.replace(/"/g, "")}"`;
}

/**
 * Reads the identity fields messaging renders in the thread header and list.
 *
 * Both identities are returned, and neither is chosen here: which one is shown
 * depends on the role the account occupies in the conversation being rendered
 * (see `lib/roles.ts`). Postgres stays the source of truth for both.
 */
export async function fetchProfileSnapshots(
  externalIds: string[],
): Promise<ProfileSnapshot[]> {
  if (externalIds.length === 0) return [];
  const list = externalIds.map(quote).join(",");

  const users = await fetch(
    `${requireEnv("SUPABASE_URL")}/rest/v1/users?select=id,username,avatar_url,role&id=in.(${list})`,
    { headers: serviceHeaders({ "Content-Type": "application/json" }) },
  );
  if (!users.ok) throw new Error(`Supabase profile lookup failed (${users.status})`);
  const userRows = (await users.json()) as Array<{
    id: string;
    username: string | null;
    avatar_url: string | null;
    role: "customer" | "professional" | null;
  }>;

  const profiles = await fetch(
    `${requireEnv("SUPABASE_URL")}/rest/v1/professional_profiles?select=user_id,business_name,display_name,profile_photo_url&user_id=in.(${list})`,
    { headers: serviceHeaders({ "Content-Type": "application/json" }) },
  );
  if (!profiles.ok) throw new Error(`Supabase professional lookup failed (${profiles.status})`);
  const profileRows = (await profiles.json()) as Array<{
    user_id: string;
    business_name: string | null;
    display_name: string | null;
    profile_photo_url: string | null;
  }>;
  const byUser = new Map(profileRows.map((row) => [row.user_id, row]));

  return userRows.map((row) => {
    const profile = byUser.get(row.id);
    const username = row.username ?? "Sheree member";
    // A business name is preferred for the professional identity, falling back
    // to the professional profile's personal display name and then the username.
    const professionalName =
      profile?.business_name?.trim() || profile?.display_name?.trim() || null;
    return {
      userId: row.id,
      username,
      personalAvatarUrl: row.avatar_url ?? null,
      professionalName,
      professionalAvatarUrl: profile?.profile_photo_url ?? null,
      role: row.role === "professional" ? "professional" : "customer",
    };
  });
}

/**
 * Reads a single booking, including the `professional_profiles → users` hop
 * needed to prove *who* the professional is for this specific booking. That
 * relationship — not the global role on anyone's account — is what decides who
 * is the customer and who is the provider.
 */
export async function fetchBooking(bookingId: string): Promise<BookingSnapshot | null> {
  const response = await fetch(
    `${requireEnv("SUPABASE_URL")}/rest/v1/bookings?select=id,customer_id,professional_id,service_id,service_name,starts_at,ends_at,status,payment_status,price,price_card_id,professional_profiles(user_id)&id=eq.${encodeURIComponent(bookingId)}`,
    { headers: serviceHeaders() },
  );
  if (!response.ok) throw new Error(`Supabase booking lookup failed (${response.status})`);
  const rows = (await response.json()) as Array<{
    id: string;
    customer_id: string;
    professional_id: string;
    service_id: string | null;
    service_name: string;
    starts_at: string;
    ends_at: string;
    status: string;
    payment_status: string;
    price: number | string;
    price_card_id: string | null;
    professional_profiles: { user_id: string } | Array<{ user_id: string }> | null;
  }>;
  const row = rows[0];
  if (!row) return null;
  const joined = Array.isArray(row.professional_profiles)
    ? row.professional_profiles[0]
    : row.professional_profiles;
  return {
    id: row.id,
    customerId: row.customer_id,
    professionalProfileId: row.professional_id,
    professionalUserId: joined?.user_id ?? null,
    serviceId: row.service_id,
    serviceName: row.service_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    paymentStatus: row.payment_status,
    price: Number(row.price ?? 0),
    priceCardId: row.price_card_id,
  };
}

/**
 * Delivers a message notification through Sheree's *existing* pipeline.
 *
 * `notify_user` is the established dispatcher: it writes the in-app
 * notification row and pushes to the recipient's registered devices, gated by
 * `notification_push_allowed` so the user's own preference for message
 * notifications (and quiet handling) still applies. Audience is `all` on
 * purpose — the recipient is a Sheree user, not a "customer" or "professional"
 * context, and they should hear about it whichever mode they are browsing in.
 */
export async function sendMessageNotification(input: {
  recipientId: string;
  conversationId: string;
  senderName: string;
  preview: string;
}): Promise<void> {
  const destination = `/messages/${input.conversationId}`;
  const response = await fetch(`${requireEnv("SUPABASE_URL")}/rest/v1/rpc/notify_user`, {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      target_user: input.recipientId,
      notification_kind: "message",
      notification_title: input.senderName,
      notification_body: input.preview,
      notification_url: destination,
      // `route` is what the app's notification router reads.
      notification_data: {
        event: "message_received",
        conversationId: input.conversationId,
        route: destination,
      },
      notification_audience: "all",
    }),
  });
  if (!response.ok) {
    throw new Error(`Notification dispatch failed (${response.status})`);
  }
}

/**
 * Mirrors a price card into Postgres.
 *
 * This is what makes the agreed price trustworthy on the booking side: the
 * custom-booking RPC reads this row rather than accepting a price from the
 * client, so a tampered app cannot book a GH₵220 proposal for GH₵1.
 */
export type PlatformPriceCardInput = {
  id: string;
  conversationRef: string;
  professionalUserId: string;
  customerUserId: string;
  serviceName: string;
  description: string | null;
  price: number;
  currency: string;
  durationMinutes: number;
  status: string;
  expiresAt: number | null;
};

export async function upsertConversationPriceCard(
  input: PlatformPriceCardInput,
): Promise<void> {
  const response = await fetch(
    `${requireEnv("SUPABASE_URL")}/rest/v1/conversation_price_cards?on_conflict=id`,
    {
      method: "POST",
      headers: serviceHeaders({
        Prefer: "resolution=merge-duplicates,return=minimal",
      }),
      body: JSON.stringify({
        id: input.id,
        conversation_ref: input.conversationRef,
        professional_user_id: input.professionalUserId,
        customer_user_id: input.customerUserId,
        service_name: input.serviceName,
        description: input.description,
        price: input.price,
        currency: input.currency,
        duration_minutes: input.durationMinutes,
        status: input.status,
        expires_at: input.expiresAt === null ? null : new Date(input.expiresAt).toISOString(),
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Price card publish failed (${response.status})`);
  }
}

export async function updateConversationPriceCardStatus(input: {
  id: string;
  status: string;
  bookingId: string | null;
}): Promise<void> {
  const response = await fetch(
    `${requireEnv("SUPABASE_URL")}/rest/v1/conversation_price_cards?id=eq.${encodeURIComponent(input.id)}`,
    {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        status: input.status,
        booking_id: input.bookingId,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Price card status update failed (${response.status})`);
  }
}
