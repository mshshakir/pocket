/**
 * terms.smoke.mjs — agreeing to the Terms and Privacy Policy (migration 0061).
 *
 *   T1  Tapping Continue with Google under "By continuing, you agree…" is
 *       recorded as 'sign_in' once signed in; nobody is asked again.
 *   T2  Without that tap (an older account), the person is asked; agreeing
 *       records 'prompt'.
 *   T3  Already agreed to this version: nothing to do. An old tap (over 30
 *       minutes) doesn't count. Signed out or a server error: unknown, no prompt.
 *   T4  The sign-in window shows the line with both links; the Terms window
 *       links both and has one button.
 *
 * Run: node src/__smoke__/terms.smoke.mjs
 */
import { TermsAgreement } from '../domain/services/TermsAgreement.js';
import { TermsModal } from '../ui/modals/TermsModal.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nTerms suite');

class Mem { #m = new Map(); getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; } setItem(k, v) { this.#m.set(k, String(v)); } removeItem(k) { this.#m.delete(k); } }
const server = ({ accepted = false, fail = false } = {}) => {
  const calls = [];
  const rpc = async (fn, args) => {
    calls.push({ fn, args });
    if (fail) return { data: null, error: { message: 'down' } };
    if (fn === 'pocket_terms_state') return { data: { version: '2026-11-17', accepted }, error: null };
    if (fn === 'pocket_terms_accept') { accepted = true; return { data: { version: '2026-11-17', accepted: true }, error: null }; }
    return { data: null, error: { message: 'unknown' } };
  };
  return { calls, rpc };
};

{
  const s = server(), store = new Mem();
  const t = new TermsAgreement(() => s.rpc, store);
  t.agreedAtSignIn();
  const r = await t.check();
  ok('T1 agreed on the sign-in window: recorded as sign_in, no prompt', r.status === 'ok'
     && s.calls.some((c) => c.fn === 'pocket_terms_accept' && c.args.p_via === 'sign_in' && c.args.p_version === '2026-11-17'));
  ok('T1 the tap is forgotten once recorded', store.getItem('pocket.termsAgreed') === null);
}
{
  const s = server(), t = new TermsAgreement(() => s.rpc, new Mem());
  const r = await t.check();
  ok('T2 an older account is asked', r.status === 'ask' && r.version === '2026-11-17' && !s.calls.some((c) => c.fn === 'pocket_terms_accept'));
  await t.accept(r.version);
  ok('T2 agreeing records prompt', s.calls.some((c) => c.fn === 'pocket_terms_accept' && c.args.p_via === 'prompt'));
  ok('T2 and then nothing more is asked', (await t.check()).status === 'ok');
}
{
  const s = server({ accepted: true }), t = new TermsAgreement(() => s.rpc, new Mem());
  ok('T3 already agreed: ok, nothing written', (await t.check()).status === 'ok' && !s.calls.some((c) => c.fn === 'pocket_terms_accept'));
  const s2 = server(), store = new Mem(), t2 = new TermsAgreement(() => s2.rpc, store);
  t2.agreedAtSignIn(Date.now() - 31 * 60 * 1000);
  ok('T3 a tap from over 30 minutes ago doesn\'t count', (await t2.check()).status === 'ask');
  ok('T3 signed out: unknown', (await new TermsAgreement(() => null, new Mem()).check()).status === 'unknown');
  ok('T3 server down: unknown, no prompt', (await new TermsAgreement(() => server({ fail: true }).rpc, new Mem()).check()).status === 'unknown');
}
{
  const m = new TermsModal();
  m.open();
  const h = m.render();
  ok('T4 the Terms window links both and has one button', /terms\.html/.test(h) && /privacy\.html/.test(h) && (h.match(/<button/g) || []).length === 1 && /I agree, continue/.test(h));
  m.error = 'The Terms have changed. Please read them again.';
  ok('T4 a refusal shows', /terms-error/.test(m.render()));
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../ui/modals/AuthModal.js', import.meta.url), 'utf8');
  ok('T4 the sign-in window says "By continuing, you agree" with both links', /By continuing, you agree to Pocket's/.test(src) && /href="terms\.html"/.test(src) && /href="privacy\.html"/.test(src));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
