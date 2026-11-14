/**
 * payments — one-time payments with Razorpay (paid plans, phase 5).
 *
 * The app asks for an order, opens Razorpay Checkout, then sends the result
 * back to be checked and applied. Razorpay's webhook (POST /payments/webhook)
 * applies the same payment if the app never got back (closed tab, lost
 * connection). Prices and rules come from the database (migration 0021).
 *
 * Secrets (Supabase → Edge Functions → Secrets):
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   Razorpay → Account & Settings → API keys
 *   RAZORPAY_WEBHOOK_SECRET                the secret typed when adding the webhook
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (provided by Supabase)
 *
 * Deployed with --no-verify-jwt because Razorpay can't send a Supabase sign-in.
 * App requests are still checked for a signed-in user here; webhooks are
 * checked by their signature.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { PaymentHandler } from './lib/PaymentHandler.ts';
import { PaymentStore } from './lib/PaymentStore.ts';
import { RazorpayClient } from './lib/RazorpayClient.ts';

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

const keyId = (env.RAZORPAY_KEY_ID ?? '').trim();
const keySecret = (env.RAZORPAY_KEY_SECRET ?? '').trim();
const razorpay = keyId && keySecret ? new RazorpayClient(keyId, keySecret) : null;
const handler = new PaymentHandler(userOf, new PaymentStore(admin), razorpay, keySecret, (env.RAZORPAY_WEBHOOK_SECRET ?? '').trim());

Deno.serve((req) => handler.handle(req));
