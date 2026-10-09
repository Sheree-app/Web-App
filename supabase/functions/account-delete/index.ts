import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function removeFolder(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
) {
  const pending = [prefix];
  const paths: string[] = [];
  while (pending.length) {
    const folder = pending.pop()!;
    const { data, error } = await admin.storage
      .from(bucket)
      .list(folder, { limit: 1000 });
    if (error) throw error;
    for (const item of data ?? []) {
      const path = `${folder}/${item.name}`;
      if (item.id) paths.push(path);
      else pending.push(path);
    }
  }
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await admin.storage
      .from(bucket)
      .remove(paths.slice(index, index + 100));
    if (error) throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Authentication required" }, 401);
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return json({ error: "Authentication required" }, 401);
    const body = await request.json().catch(() => ({}));
    if (body.confirmation !== "DELETE")
      return json({ error: "Type DELETE to confirm" }, 400);
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: profile } = await admin
      .from("professional_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profile) {
      const cleanup = await Promise.all([
        admin
          .from("professional_social_links")
          .delete()
          .eq("professional_id", profile.id),
        admin
          .from("feed_posts")
          .update({ is_published: false, caption: "Removed" })
          .eq("professional_id", profile.id),
        admin
          .from("professional_services")
          .update({ is_active: false, description: "Unavailable" })
          .eq("professional_id", profile.id),
      ]);
      // Optional cleanup must never prevent the Auth account from being disabled.
      await admin
        .from("professional_profiles")
        .update({
          business_name: "Former professional",
          display_name: "Former professional",
          bio: null,
          location: null,
          business_address: null,
          profile_photo_url: null,
          cover_image_url: null,
        })
        .eq("id", profile.id);
    }
    const privateCleanup = await Promise.all(
      [
        "push_tokens",
        "notifications",
        "saved_collection_items",
        "saved_collections",
        "user_interests",
      ].map((table) => admin.from(table).delete().eq("user_id", user.id)),
    );
    await admin
      .from("users")
      .update({ username: "Deleted user", avatar_url: null, phone: null })
      .eq("id", user.id);
    await Promise.allSettled(
      ["avatars", "portfolio", "profile-media", "verification-documents"].map(
        (bucket) => removeFolder(admin, bucket, user.id),
      ),
    );
    const { error: deleteError } = await admin.auth.admin.deleteUser(
      user.id,
      true,
    );
    if (deleteError)
      return json({ error: "Account could not be deleted" }, 500);
    return json({ deleted: true });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "Unexpected deletion error",
      },
      500,
    );
  }
});
