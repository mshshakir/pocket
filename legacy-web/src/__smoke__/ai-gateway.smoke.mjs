/**
 * ai-gateway.smoke.mjs — the app's side of AI scans and voice (phase 4).
 *
 *   G1  A request goes to the `ai` server function with the book, a fresh
 *       request id and the parts; the answer's text comes back.
 *   G2  Signed out: refused before anything is sent.
 *   G3  The server's refusals arrive as AiError with their code and sentence
 *       (no credits, no access, not set up), and a network failure is named.
 *
 * Run: node src/__smoke__/ai-gateway.smoke.mjs
 */
import { AiGateway, AiError } from '../domain/services/AiGateway.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nAI gateway suite');

const parts = [{ inline_data: { mime_type: 'image/jpeg', data: 'AAAA' } }, { text: 'prompt' }];
{
  const sent = [];
  const g = new AiGateway(() => async (name, opts) => { sent.push({ name, ...opts }); return { data: { text: '{"total":5}', chargedTo: 'own' }, error: null }; });
  const text = await g.generate({ kind: 'receipt', book: 'b1', parts });
  ok('G1 the answer text comes back', text === '{"total":5}');
  ok('G1 sent to the ai function with book, kind, parts and a request id',
     sent[0]?.name === 'ai' && sent[0].body.book === 'b1' && sent[0].body.kind === 'receipt'
     && sent[0].body.parts === parts && typeof sent[0].body.ref === 'string' && sent[0].body.ref.length >= 8);
  await g.generate({ kind: 'receipt', book: 'b1', parts });
  ok('G1 each request gets its own id', sent[0].body.ref !== sent[1].body.ref);
}
{
  let called = false;
  const g = new AiGateway(() => null);
  const e = await g.generate({ kind: 'voice', book: 'b1', parts }).catch((x) => x);
  const g2 = new AiGateway(() => async () => { called = true; return {}; });
  const e2 = await g2.generate({ kind: 'voice', book: null, parts }).catch((x) => x);
  ok('G2 signed out: refused, nothing sent', e instanceof AiError && e.code === 'signed_out' && e2.code === 'signed_out' && !called);
}
{
  const refusing = (status, body) => new AiGateway(() => async () => ({
    data: null, error: { message: `Edge Function returned a non-2xx status code`, context: { json: async () => body, status } },
  }));
  const e1 = await refusing(402, { error: 'You have no AI credits left. Buy a pack in Settings → Your plan.', code: 'no_credits' })
    .generate({ kind: 'receipt', book: 'b1', parts }).catch((x) => x);
  ok('G3 no credits: code and the server\'s sentence', e1.code === 'no_credits' && /no AI credits/.test(e1.message));
  const e2 = await refusing(403, { error: 'You can\'t add entries to that shared space.', code: 'no_access' })
    .generate({ kind: 'receipt', book: 'b1', parts }).catch((x) => x);
  ok('G3 no access', e2.code === 'no_access');
  const e3 = await refusing(503, { error: 'AI scanning isn\'t set up yet.', code: 'not_set_up' })
    .generate({ kind: 'receipt', book: 'b1', parts }).catch((x) => x);
  ok('G3 not set up', e3.code === 'not_set_up');
  const e4 = await new AiGateway(() => async () => { throw new TypeError('Failed to fetch'); })
    .generate({ kind: 'receipt', book: 'b1', parts }).catch((x) => x);
  ok('G3 network failure is named', e4.code === 'network' && /Network/.test(e4.message));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
