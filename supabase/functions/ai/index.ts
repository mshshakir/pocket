/**
 * ai — receipt scans and voice entries with the server's Gemini key
 * (paid plans, phase 4).
 *
 * The app sends the picture or recording with its prompt; this function checks
 * who is asking, charges one AI credit by the plan rules in the database
 * (unlimited, the Family pool in a shared space, or their own credits), asks
 * Gemini, and refunds the credit if Gemini fails.
 *
 * Secrets (Supabase → Edge Functions → Secrets):
 *   GEMINI_API_KEY             the Gemini key Pocket pays for
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (provided by Supabase)
 *
 * Deployed with JWT verification on: only signed-in users reach it.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AiCredits } from './lib/AiCredits.ts';
import { AiHandler } from './lib/AiHandler.ts';
import { GeminiClient } from './lib/GeminiClient.ts';

const env = Deno.env.toObject();
const url = env.SUPABASE_URL;

const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/** The signed-in user's id from the request's Authorization header, or null. */
async function userOf(authorization: string): Promise<string | null> {
  if (!authorization.startsWith('Bearer ')) return null;
  const client = createClient(url, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user?.id ?? null;
}

const key = (env.GEMINI_API_KEY ?? '').trim();
const handler = new AiHandler(userOf, new AiCredits(admin), key ? new GeminiClient(key) : null);

Deno.serve((req) => handler.handle(req));
