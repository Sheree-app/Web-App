"use client";

import { env, isSupabaseConfigured } from "@/lib/env";
import type { Database } from "@/types/database";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export { isSupabaseConfigured };

let cached: SupabaseClient<Database> | null = null;

function createClient() {
  if (cached) return cached;
  cached = createBrowserClient<Database>(
    env.supabaseUrl || "https://placeholder.supabase.co",
    env.supabaseAnonKey || "placeholder",
    {
      auth: {
        // The mobile app stored the session in AsyncStorage with
        // `detectSessionInUrl` off. On the web the session lives in cookies so
        // the proxy and server components can see it, and recovery / magic-link
        // redirects carry a `?code=` that must be exchanged on load.
        detectSessionInUrl: true,
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
      },
    },
  );
  return cached;
}

/**
 * Lazily-resolved Supabase client.
 *
 * Ported feature modules call `supabase.from(...)` at their own module scope in
 * some cases, so this forwards every property access to a client created on
 * first use — never at import time, which keeps server rendering side-effect
 * free.
 */
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, property, receiver) {
    const client = createClient();
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
