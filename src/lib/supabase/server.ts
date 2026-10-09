import "server-only";

import { env, isSupabaseConfigured } from "@/lib/env";
import type { Database } from "@/types/database";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Request-scoped Supabase client backed by the auth cookies the browser client
 * writes. Use it in server components, route handlers and server actions.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.supabaseUrl || "https://placeholder.supabase.co",
    env.supabaseAnonKey || "placeholder",
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server components cannot write cookies. The proxy refreshes the
            // session instead, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * Current user, or `null`. Prefer this over `getSession()` on the server: it
 * validates the token against Supabase rather than trusting the cookie.
 */
export async function getServerUser(): Promise<User | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user ?? null;
  } catch {
    return null;
  }
}

export async function isAuthenticated() {
  return Boolean(await getServerUser());
}
