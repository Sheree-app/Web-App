/**
 * Barrel for the Supabase helpers.
 *
 * The ported feature modules import `@/lib/supabase`, matching the mobile
 * codebase. Browser-safe exports live here; server-only helpers stay in
 * `@/lib/supabase/server` so they never end up in a client bundle.
 */
export { isSupabaseConfigured, supabase } from "./client";
export { db } from "./untyped";
