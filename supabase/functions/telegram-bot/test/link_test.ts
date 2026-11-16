/**
 * A sign-in code sent again after connecting is not recorded as an amount.
 * Run: deno run --allow-all --import-map <map with a supabase-js stub> supabase/functions/telegram-bot/test/link_test.ts
 */
import { LinkService } from '../lib/LinkService.ts';

const now = Date.parse('2026-11-16T17:20:00Z');
const recent = { created_at: '2026-11-16T17:15:38Z' };
const checks: [string, boolean][] = [
  ['bare code soon after connecting', LinkService.isRecentCode('21968576', recent, now)],
  ['after an hour it is an amount', !LinkService.isRecentCode('21968576', { created_at: '2026-11-16T16:00:00Z' }, now)],
  ['words are never a code', !LinkService.isRecentCode('250 tea', recent, now)],
  ['5 digits are never a code', !LinkService.isRecentCode('25000', recent, now)],
  ['no link time, no guess', !LinkService.isRecentCode('21968576', {}, now)],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
if (failed.length) Deno.exit(1);
