/**
 * free-auto.smoke.mjs — free requests approved straight away (migration 0060), admin side.
 *
 *   F1  The admin sees how much of the allowance is used, and can change the
 *       limit or reset the count.
 *   F2  Automatic approvals are marked and can be revoked; waiting ones keep
 *       Approve / Decline.
 *
 * Run: node src/__smoke__/free-auto.smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { FreeRequestsView } from '../admin/views/FreeRequestsView.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nFree requests: automatic approval');

const calls = [];
const api = {
  freeRequests: async () => ({
    counts: { approved: 1, pending: 1 }, auto: { limit: 50, used: 12 },
    items: [
      { id: 1, email: 'a@x.in', name: 'A', reason: 'student', status: 'approved', auto: true, at: '2026-11-17T08:00:00Z', validUntil: '2027-05-17T08:00:00Z' },
      { id: 2, email: 'b@x.in', name: 'B', reason: 'later', status: 'pending', auto: false, at: '2026-11-17T09:00:00Z' },
    ],
  }),
  setFreeAuto: async (limit, reset) => { calls.push({ limit, reset }); return { limit: limit ?? 50, used: reset ? 0 : 12 }; },
  setFreeRequest: async (id, status) => ({ id, status, validUntil: null }),
};
const toasts = [];
const v = new FreeRequestsView(api, { toast: (m) => toasts.push(m), refresh: async () => {} });
await v.load();
const doc = new JSDOM('<!doctype html><body></body>').window.document;
const draw = (filter) => { doc.body.innerHTML = v.html(); return doc; };

let d = draw();
ok('F1 shows 12 of 50 used, 38 left', /12 of 50 used · 38 left/.test(d.querySelector('.fr-auto')?.textContent || ''));
d.querySelector('[data-fr-limit]').value = '80';
await v.act('fr-auto-save', d.querySelector('[data-action="fr-auto-save"]'));
ok('F1 Save sets the new limit', calls[0]?.limit === 80 && calls[0]?.reset === false && /Limit set to 80/.test(toasts.at(-1)));
d = draw();
await v.act('fr-auto-reset', d.querySelector('[data-action="fr-auto-reset"]'));
ok('F1 Reset count starts again from 0', calls[1]?.reset === true && calls[1]?.limit === null && /0 of/.test(draw().querySelector('.fr-auto').textContent));

await v.act('fr-filter', { dataset: { status: 'approved' } });
d = draw();
ok('F2 an automatic approval is marked and can be revoked', /automatic/.test(d.body.textContent) && !!d.querySelector('[data-action="fr-set"][data-status="declined"]') && /Revoke/.test(d.body.textContent));
await v.act('fr-filter', { dataset: { status: 'pending' } });
d = draw();
ok('F2 a waiting request keeps Approve and Decline', /Approve for 6 months/.test(d.body.textContent) && /Decline/.test(d.body.textContent));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
