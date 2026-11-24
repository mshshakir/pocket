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
  asked: { kind: string; seconds: number }[] = [];
  constructor(public answer: Charge) {}
  spend(_u: string, _b: string, ref: string, kind: string, seconds: number) { this.spent.push(ref); this.asked.push({ kind, seconds }); return Promise.resolve(this.answer); }
  refund(_u: string, ref: string) { this.refunded.push(ref); return Promise.resolve(); }
  texts: string[] = [];
  text(_u: string, ref: string) { this.texts.push(ref); return Promise.resolve({ ok: true, free: true } as Charge); }
  imports: { session: string; rows: number; ref: string }[] = [];
  importAnswer: Charge = { ok: true, free: true, cost: 0 };
  importUse(_u: string, session: string, rows: number, ref: string) { this.imports.push({ session, rows, ref }); return Promise.resolve(this.importAnswer); }
  importRefunds: { session: string; chargeRef?: string }[] = [];
  importRefund(_u: string, session: string, chargeRef?: string) { this.importRefunds.push({ session, chargeRef }); return Promise.resolve(); }
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
  const voice = (over: Record<string, unknown> = {}) => body({ kind: 'voice', parts: [{ inline_data: { mime_type: 'audio/webm', data: 'AAAA' } }, { text: 'parse' }], ...over });
  const c = new FakeCredits({ ok: true, chargedTo: 'own', cost: 5, remaining: 15 });
  const scan = await (await make(c).handle(post(body()))).json();
  await make(c).handle(post(voice({ seconds: 42 })));
  await make(c).handle(post(voice()));
  await make(c).handle(post(voice({ seconds: 99999 })));
  await make(c).handle(post(voice({ seconds: 1, parts: [{ inline_data: { mime_type: 'audio/webm', data: 'A'.repeat(1_280_000) } }, { text: 'parse' }] })));
  ok('C1 the database is told what kind of request it is; a scan has no length', c.asked[0].kind === 'receipt' && c.asked[0].seconds === 0 && scan.cost === 5 && scan.remaining === 15, JSON.stringify(c.asked[0]));
  ok('C2 a voice entry is charged by the length the app measured', c.asked[1].kind === 'voice' && c.asked[1].seconds === 42);
  ok('C3 no length given counts as the shortest; a silly length is capped at 10 minutes', c.asked[2].seconds === 1 && c.asked[3].seconds === 600, `${c.asked[2].seconds} ${c.asked[3].seconds}`);
  ok('C4 a length too short for the size of the recording is raised to what the size allows (960 KB ≥ 60 s)', c.asked[4].seconds === 60, String(c.asked[4].seconds));
  const short = new FakeCredits({ ok: false, reason: 'no_credits', cost: 5, remaining: 3 });
  const j = await (await make(short).handle(post(body()))).json();
  ok('C5 not enough credits for this request: says how many it needs and how many there are', j.code === 'no_credits' && /needs 5 AI credits and you have 3/.test(j.error), j.error);
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
// Setup suggestions: text only, the daily free allowance, no picture allowed.
{
  const c = new FakeCredits({ ok: true, chargedTo: 'own', remaining: 9 });
  const res = await make(c).handle(post(body({ kind: 'setup', parts: [{ text: 'suggest categories' }] })));
  ok('S1 setup: text only, uses the daily free allowance', res.status === 200 && c.texts.length === 1 && c.spent.length === 0, String(res.status));
  const bad = await make(new FakeCredits({ ok: true })).handle(post(body({ kind: 'setup' })));
  ok('S2 setup refuses a picture', bad.status === 400);
}

// Import with AI: text only, one session per import, JSON answers.
{
  const SESSION = '0b7f0c8e-3c1d-4a51-9b7e-2f5d6c7a8b90';
  const imp = (over: Record<string, unknown> = {}) => body({ kind: 'import', parts: [{ text: 'TABLE t1 …' }], session: SESSION, rows: 848, maxOutputTokens: 99999, ...over });
  const c = new FakeCredits({ ok: true });
  const res = await make(c).handle(post(imp()));
  const last = (gemini as unknown as { last: { sent: { generationConfig: { maxOutputTokens: number; responseMimeType?: string } } } }).last;
  ok('I1 import: charged through the import rule with its session and row count, never the scan price',
     res.status === 200 && c.imports.length === 1 && c.imports[0].session === SESSION && c.imports[0].rows === 848 && !c.spent.length && !c.texts.length);
  ok('I2 import: JSON answers, output capped at 8192 tokens', last.sent.generationConfig.responseMimeType === 'application/json' && last.sent.generationConfig.maxOutputTokens === 8192);
  const bad1 = await make(c).handle(post(imp({ session: 'nope' })));
  const bad2 = await make(c).handle(post(imp({ parts: [{ inline_data: { mime_type: 'image/png', data: 'AAAA' } }] })));
  const bad3 = await make(c).handle(post(imp({ parts: [{ text: 'x'.repeat(20_001) }] })));
  ok('I3 import: no session, a file, or too much text is refused before charging', [bad1, bad2, bad3].every((r) => r.status === 400) && c.imports.length === 1);
  const paid = new FakeCredits({ ok: true });
  paid.importAnswer = { ok: true, chargedTo: 'own', cost: 5, remaining: 95, chargeRef: 'import:req-0001-abcd' };
  const failed = await make(paid, gemini(500)).handle(post(imp()));
  ok('I4 import: the AI fails → the call is given back with the charge it made', failed.status === 502 && paid.importRefunds.length === 1 && paid.importRefunds[0].chargeRef === 'import:req-0001-abcd' && !paid.refunded.length);
  const many = new FakeCredits({ ok: true });
  many.importAnswer = { ok: false, reason: 'too_many' };
  const r = await make(many).handle(post(imp()));
  ok('I5 import: too many calls in one import → a clear message', r.status === 429 && (await r.json()).code === 'too_many');
  const broke = new FakeCredits({ ok: true });
  broke.importAnswer = { ok: false, reason: 'no_credits', cost: 5, remaining: 2 };
  const r2 = await (await make(broke).handle(post(imp()))).json();
  ok('I6 import: not enough credits says how many it needs', r2.code === 'no_credits' && /needs 5 AI credits and you have 2/.test(r2.error), r2.error);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
