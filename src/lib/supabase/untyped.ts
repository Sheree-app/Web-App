import { supabase } from "@/lib/supabase/client";

/**
 * Untyped handle to Supabase.
 *
 * The ported feature modules were written against tables and RPCs that predate
 * the generated `Database` types — the mobile code dealt with that by casting
 * each call site to `any`. Rather than repeat that hundreds of times, those
 * modules reach for this handle, and anything that *is* typed keeps using
 * `@/lib/supabase/client` directly.
 */
export type UntypedQuery = unknown;

export const db = supabase as unknown as {
  from: (table: string) => any;
  rpc: (name: string, args?: Record<string, any>) => Promise<{ data: any; error: any }>;
  storage: typeof supabase.storage;
  functions: typeof supabase.functions;
};
