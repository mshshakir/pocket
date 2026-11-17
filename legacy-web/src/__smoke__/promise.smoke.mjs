/**
 * promise.smoke.mjs — the ₹30-a-month promise and asking to use Pocket free
 * (migrations 0047, 0048). The server rules are dry-run in the database.
 *
 *   P1  EntryAccess: rule off allows everything; a plan, family cover or an
 *       approved request allow; a waiting request allows up to its limit;
 *       nothing yet, or signed out, is refused with the right reason.
 *   P2  Entitlements carry `entries` and the next credits to expire.
 *   P3  PromiseModal: the promise, the request form and "sent" pages.
 *   P4  The homepage shows the ₹30 wording only when the rule is on.
 *   P5  In the app: rule off, a new entry opens as usual; rule on and signed
 *       out, the promise opens instead and asks to sign in; the sample book
 *       never asks.
 *
 * Run: node src/__smoke__/promise.smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { EntryAccess } from '../domain/billing/EntryAccess.js';
import { Entitlements } from '../domain/billing/Entitlements.js';
import { PromiseModal } from '../ui/modals/PromiseModal.js';
import { PromiseSection } from '../web/PromiseSection.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

console.log('\nPromise suite');

// ── P1 EntryAccess ─────────────────────────────────────────────────────────
{
  const tx = (n) => Array.from({ length: n }, () => ({ createdAt: iso(0) }));
  ok('P1 rule off (or no answer): allowed', EntryAccess.from(null).check([]).ok && EntryAccess.from({ required: false, why: 'none' }).check([]).ok);
  for (const why of ['plan', 'family', 'free']) {
    ok(`P1 ${why}: allowed`, EntryAccess.from({ required: true, why }).check(tx(500)).ok);
  }
  const waiting = EntryAccess.from({ required: true, why: 'waiting', waitLimit: 20, waitingSince: iso(60_000) });
  const old = [{ createdAt: iso(3_600_000) }];
  ok('P1 waiting: entries from before the request don\'t count', waiting.addedWhileWaiting([...old, ...tx(3)]) === 3);
  ok('P1 waiting: 19 added, one more allowed', waiting.check(tx(19)).ok);
  ok('P1 waiting: 20 added, the next is refused', waiting.check(tx(20)).reason === 'wait_full');
  ok('P1 waiting: an import of 5 with 17 added is refused', waiting.check(tx(17), 5).reason === 'wait_full');
  ok('P1 nothing yet: refused', EntryAccess.from({ required: true, why: 'none' }).check([]).reason === 'none');
  ok('P1 an unknown answer counts as nothing yet, never more', EntryAccess.from({ required: true, why: 'gold' }).check([]).reason === 'none');
  ok('P1 signed out with the rule on: asked to sign in', EntryAccess.signedOut({ promisePaise: 3000 }).check([]).reason === 'signed_out');
  ok('P1 price and credits from the server', EntryAccess.from({ required: true, why: 'none', promisePaise: 3000, promiseCredits: 150 }).promiseRupees === 30);
}

// ── P2 Entitlements ────────────────────────────────────────────────────────
{
  const e = Entitlements.from({ plan: 'free', state: 'free', entries: { required: true, why: 'free', freeUntil: '2027-05-16T10:00:00Z' },
                                aiExpiring: { credits: 150, at: '2026-12-16T10:00:00Z' } });
  ok('P2 entries come through', e.entries.why === 'free' && e.entries.freeUntil.getUTCFullYear() === 2027);
  ok('P2 the next credits to expire', e.aiExpiring.credits === 150 && e.aiExpiring.at.getUTCMonth() === 11);
  ok('P2 Free before the server answers: nothing required, nothing expiring', !Entitlements.free().entries.required && Entitlements.free().aiExpiring === null);
  ok('P2 an odd expiry is ignored', Entitlements.from({ aiExpiring: { credits: 'x' } }).aiExpiring === null);
}

// ── P3 PromiseModal ────────────────────────────────────────────────────────
{
  let access = EntryAccess.from({ required: true, why: 'none', waitLimit: 20, promisePaise: 3000, promiseCredits: 150 });
  const m = new PromiseModal({ access: () => access, person: () => ({ name: 'Aliasgar <b>' }), redraw: () => {} });
  m.open({ reason: 'none' });
  let html = m.render();
  ok('P3 the promise: pay ₹30, get it all back', /Pay ₹30\. Get it all back\./.test(html));
  ok('P3 ₹30 returns as 150 credits: 30 scans or 150 voice entries', /Each month your ₹30 returns as 150 AI credits: about 30 receipt scans or 150 voice entries\./.test(html));
  ok('P3 the habit, and ₹1 a day', /What you really get is the habit\. People who put something in keep going\. Think of it as ₹1 a day to show up and record your expenses\./.test(html));
  ok('P3 keep-my-promise button and the request link', /promise-keep/.test(html) && /Ask to use Pocket free/.test(html));
  m.show('request');
  html = m.render();
  ok('P3 the form: name prefilled and escaped, reason, send', /value="Aliasgar &lt;b&gt;"/.test(html) && /name="reason"/.test(html) && /Send request/.test(html));
  ok('P3 the form says free use has no monthly credits, and 20 entries while waiting', /doesn't include the monthly 150 AI credits/.test(html) && /up to 20 entries/.test(html));
  m.show('request', 'Your request is already with us');
  ok('P3 a refusal shows on the form', /Your request is already with us/.test(m.render()));
  m.show('sent');
  ok('P3 sent: up to 20 entries while we read it', /Request sent/.test(m.render()) && /up to 20 entries/.test(m.render()));
  m.show('processing');
  ok('P3 while sending: Processing your request…', /Processing your request…/.test(m.render()) && !/Send request/.test(m.render()));
  m.approved('2027-05-17T07:48:37Z');
  html = m.render();
  ok('P3 approved straight away: until the date, start recording', /You're approved/.test(html) && /until <b[^>]*>17 May 2027<\/b>/.test(html) && /Start recording/.test(html), html.match(/Use Pocket free[^<]*/)?.[0]);
  m.open({ reason: 'signed_out' });
  html = m.render();
  ok('P3 signed out: sign in, no request link', /Sign in to start/.test(html) && !/promise-ask/.test(html));
  access = EntryAccess.from({ required: true, why: 'waiting', waitLimit: 20, waitingSince: iso(0) });
  m.open({ reason: 'wait_full' });
  ok('P3 request waiting and limit reached: says so', /You(&#39;|&#x27;|')ve added 20 entries while we read your request/.test(m.render()));
  access = EntryAccess.from({ required: true, why: 'none', request: { status: 'declined', at: iso(0) } });
  m.open({ reason: 'none' });
  ok('P3 a declined request is mentioned', /couldn(&#39;|&#x27;|')t approve your request/.test(m.render()));
}

// ── P4 Homepage ────────────────────────────────────────────────────────────
{
  const page = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(page);
  const doc = dom.window.document;
  const s = new PromiseSection(doc, async () => ({ ok: true, json: async () => ({ required: false }) }));
  await s.start();
  ok('P4 rule off: the promise section is hidden and Free says ₹0', doc.getElementById('promise').hidden
     && [...doc.querySelectorAll('[data-promise="off"]')].every((el) => !el.hidden));
  new PromiseSection(doc, async () => ({ ok: true, json: async () => ({ required: true, promisePaise: 3000, promiseCredits: 150 }) })).apply({ required: true, promisePaise: 3000, promiseCredits: 150 });
  ok('P4 rule on: the section shows and ₹0 is hidden', !doc.getElementById('promise').hidden
     && [...doc.querySelectorAll('[data-promise="off"]')].every((el) => el.hidden));
  ok('P4 the section explains both parts', /Every rupee comes back to you/.test(doc.getElementById('promise').textContent)
     && /A promise to yourself/.test(doc.getElementById('promise').textContent));
  const failing = new JSDOM(page).window.document;
  await new PromiseSection(failing, async () => { throw new Error('offline'); }).start();
  ok('P4 the rule can\'t be read: page stays as it is', failing.getElementById('promise').hidden);
}

// ── P5 In the app ──────────────────────────────────────────────────────────
const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
function boot({ rule = null, url = 'https://local.test/app.html' } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="viewContent"></div><div id="sidebarNav"></div>
       <div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
     </body></html>`,
    { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  if (rule) window.localStorage.setItem('pocket.v1.promise', JSON.stringify(rule));
  window.lucide = { createIcons() {} };
  window.Chart  = function () { return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch   = () => Promise.reject(new Error('offline'));
  window.confirm = () => true;
  window.alert   = () => {};
  window.eval(bundleSrc);
  return window;
}
{
  const w = boot();
  await wait(800);
  w.__app.openModal('transaction', {});
  await wait(50);
  const text = w.document.body.textContent;
  ok('P5 rule off: a new entry opens as usual', !/Sign in to start/.test(text) && !/Get it all back/.test(text));
}
{
  const w = boot({ rule: { required: true, promisePaise: 3000, promiseCredits: 150 } });
  await wait(800);
  w.__app.openModal('transaction', {});
  await wait(50);
  const text = w.document.body.textContent;
  ok('P5 rule on, signed out: the promise opens and asks to sign in', /Get it all back/.test(text) && /Sign in to start/.test(text));
  w.__app.closeModal();
  w.__app.openModal('trade', { id: 'x', mode: 'buy' });
  await wait(50);
  ok('P5 rule on: noting a purchase asks too', /Sign in to start/.test(w.document.body.textContent));
}
{
  const w = boot({ rule: { required: true }, url: 'https://local.test/app.html?demo' });
  await wait(800);
  w.__app.openModal('transaction', {});
  await wait(50);
  ok('P5 the sample book never asks', !/Sign in to start/.test(w.document.body.textContent));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
