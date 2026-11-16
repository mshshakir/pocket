/**
 * WebhookRegion: the webhook is re-pointed once, only when not already pinned.
 * Run: deno run --allow-all --import-map <map with a supabase-js stub> supabase/functions/telegram-bot/test/region_test.ts
 */
import { WebhookRegion } from '../lib/WebhookRegion.ts';

const calls: Array<[string, string]> = [];
// deno-lint-ignore no-explicit-any
const tg = { setWebhook: async (url: string, s: string) => { calls.push([url, s]); return true; } } as any;
const r = new WebhookRegion(tg, 'https://x.supabase.co/', '', 'sek');
const pinned = 'https://x.supabase.co/functions/v1/telegram-bot?forceFunctionRegion=ap-southeast-2';
const checks: [string, boolean][] = [];
checks.push(['pinned url', r.pinnedUrl === pinned]);
await r.ensure(pinned);
checks.push(['already pinned: nothing', calls.length === 0]);
await r.ensure('https://x.supabase.co/functions/v1/telegram-bot');
checks.push(['not pinned: set once with secret', calls.length === 1 && calls[0][0] === pinned && calls[0][1] === 'sek']);
await r.ensure('https://x.supabase.co/functions/v1/telegram-bot');
checks.push(['only once per instance', calls.length === 1]);
for (const [n, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`);
if (checks.some(([, ok]) => !ok)) Deno.exit(1);
