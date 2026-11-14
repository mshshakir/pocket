/**
 * AiHandler with fakes for sign-in, credits and Gemini.
 * Run: deno run --import-map <map with a supabase-js stub> supabase/functions/ai/test/handler_test.ts
 */
import { AiHandler } from '../lib/AiHandler.ts';
import type { AiCredits, Charge } from '../lib/AiCredits.ts';
import { GeminiClient } from '../lib/GeminiClient.ts';

let passed = 0, failed = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
const BOOK = '5778076a-844b-48f2-b29e-f37e3c746a18';
const body = (over: Record<string, unknown> = {}) => ({
  kind: 'receipt', book: BOOK, ref: 'req-0001-abcd',
  parts: [{ inline_data: { mime_type: 'image/jpeg', data: 'AAAA' } }, { text: 'read this receipt' }], ...over,
});
const post = (b: unknown, auth = 'Bearer good') =>
  new Request('https://x/ai', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

class FakeCredits {
  spent: string[] = []; refunded: string[] = [];
  constructor(public answer: Charge) {}
  spend(_u: string, _b: string, ref: string) { this.spent.push(ref); return Promise.resolve(this.answer); }
  refund(_u: string, ref: string) { this.refunded.push(ref); return Promise.resolve(); }
}
const gemini = (status: number, text = '{"total": 12}') => new GeminiClient('server-key', ((_u: unknown, init?: RequestInit) => {
  const sent = JSON.parse(String(init?.body));
  (gemini as unknown as { last: unknown }).last = { headers: init?.headers, sent };
  return Promise.resolve(new Response(JSON.stringify(status === 200 ? { candidates: [{ content: { parts: [{ text }] } }] } : { error: { message: 'x' } }), { status }));
}) as typeof fetch);
const userOf = (a: string) => Promise.resolve(a === 'Bearer good' ? 'user-1' : null);
const make = (credits: FakeCredits, g: GeminiClient | null = gemini(200)) => new AiHandler(userOf, credits as unknown as AiCredits, g);

console.log('\nai function');
{
  const c = new FakeCredits({ ok: true, chargedTo: 'family', remaining: 9 });
  const res = await make(c).handle(post(body()));
  const j = await res.json();
  ok('A1 a scan is charged once and answered', res.status === 200 && j.text === '{"total": 12}' && j.chargedTo === 'family' && c.spent.length === 1 && !c.refunded.length, JSON.stringify(j));
  const last = (gemini as unknown as { last: { headers: Record<string, string>; sent: { generationConfig: { maxOutputTokens: number } } } }).last;
  ok('A2 Gemini gets the server key and a capped output length', last.headers['x-goog-api-key'] === 'server-key' && last.sent.generationConfig.maxOutputTokens <= 1024);
}
{
  const c = new FakeCredits({ ok: true, chargedTo: 'own' });
  const res = await make(c).handle(post(body(), 'Bearer bad'));
  ok('A3 not signed in: refused, nothing charged', res.status === 401 && (await res.json()).code === 'signed_out' && !c.spent.length);
}
{
  const c = new FakeCredits({ ok: false, reason: 'no_credits' });
  const res = await make(c).handle(post(body()));
  const j = await res.json();
  ok('A4 no credits: 402 with a way out', res.status === 402 && j.code === 'no_credits' && /Your plan/.test(j.error), JSON.stringify(j));
}
{
  const c = new FakeCredits({ ok: false, reason: 'no_access' });
  const res = await make(c).handle(post(body()));
  ok('A5 someone else\'s space they are not part of: refused', res.status === 403 && (await res.json()).code === 'no_access');
}
{
  const c = new FakeCredits({ ok: true, chargedTo: 'own', remaining: 3 });
  const res = await make(c, gemini(500)).handle(post(body()));
  const j = await res.json();
  ok('A6 Gemini fails: the credit is refunded and they are told', res.status === 502 && c.refunded[0] === 'req-0001-abcd' && /weren't charged/.test(j.error), JSON.stringify(j));
}
{
  const c = new FakeCredits({ ok: true, chargedTo: 'own' });
  const r1 = await make(c).handle(post(body({ parts: [{ inline_data: { mime_type: 'application/x-msdownload', data: 'AA' } }] })));
  const r2 = await make(c).handle(post(body({ parts: [{ text: 'just text, no file' }] })));
  const r3 = await make(c).handle(post(body({ book: 'not-a-uuid' })));
  const r4 = await make(c).handle(post(body({ parts: [{ inline_data: { mime_type: 'image/png', data: 'A'.repeat(6_000_001) } }] })));
  ok('A7 odd files, no file, a bad book and huge uploads are refused before charging',
     [r1, r2, r3, r4].every((r) => r.status === 400) && !c.spent.length);
}
{
  const c = new FakeCredits({ ok: true, chargedTo: 'own' });
  const res = await make(c, null).handle(post(body()));
  ok('A8 no Gemini key on the server yet: a clear message, nothing charged', res.status === 503 && (await res.json()).code === 'not_set_up' && !c.spent.length);
}
{
  const res = await make(new FakeCredits({ ok: true })).handle(new Request('https://x/ai', { method: 'OPTIONS' }));
  ok('A9 the browser\'s pre-flight check is answered', res.status === 200 && res.headers.get('Access-Control-Allow-Origin') === '*');
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
