import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

let client: SupabaseClient | null = null;

/** Browser client. Uses only the publishable key; all access is decided by the database. */
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_KEY || 'missing', {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'sk.auth' },
    });
  }
  return client;
}
