/**
 * entitlements.smoke.mjs — reading the server's answer about plans (0018).
 * The server rules themselves are tested in the database (see CONTEXT.md, 0018).
 *
 * Run: node src/__smoke__/entitlements.smoke.mjs
 */
import { Entitlements } from '../domain/billing/Entitlements.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

console.log('\nentitlements suite');

// Shapes copied from pocket_entitlements_for() in the database tests.
const lifetimeFamily = {
  plan: 'family', planName: 'Family', paidPlan: 'family', term: 'lifetime', source: 'comp',
  state: 'active', endsAt: null, graceUntil: null, autoRenew: false,
  access: { sync: 'write', telegram: 'write', sharing: 'write' },
  seats: 5, seatsUsed: 2, aiCredits: 0, trialAvailable: true,
  coveredBy: [{ ownerId: 'owner-1', ownerEmail: 'mshshakir@gmail.com', plan: 'family', access: 'write' }],
};
const grace = {
  ...lifetimeFamily, term: 'month', source: 'razorpay', state: 'grace',
  endsAt: '2026-11-14T10:00:00Z', graceUntil: '2026-12-14T10:00:00Z',
  access: { sync: 'read', telegram: 'read', sharing: 'read' }, coveredBy: [],
};
const lapsed = { ...grace, plan: 'free', planName: 'Free', state: 'lapsed', access: { sync: 'none', telegram: 'none', sharing: 'none' } };

{
  const e = Entitlements.free();
  ok('E1 not signed in = Free: nothing in the cloud, local use untouched', e.plan === 'free' && !e.can('sync') && !e.canSee('telegram') && !e.isPaid);
}
{
  const e = Entitlements.from(lifetimeFamily);
  ok('E2 family for life: everything writable', e.can('sync') && e.can('telegram') && e.can('sharing') && e.isLifetime && !e.isReadOnly);
  ok('E2 seats: 5 people, 2 used, 3 left', e.seats === 5 && e.seatsUsed === 2 && e.seatsLeft === 3);
  ok('E3 covered by another person\'s family plan', e.sharedAccess('owner-1') === 'write' && e.sharedAccess('someone-else') === 'none');
}
{
  const e = Entitlements.from(grace);
  ok('E4 grace: can see, cannot change', e.isReadOnly && e.canSee('sync') && !e.can('sync'));
  ok('E4 dates come back as dates', e.endsAt instanceof Date && e.graceUntil > e.endsAt);
}
{
  const e = Entitlements.from(lapsed);
  ok('E5 lapsed: back to Free', !e.isPaid && !e.canSee('sync'));
}
{
  const e = Entitlements.from({ plan: 'family', state: 'weird', access: { sync: 'admin', telegram: 'write' }, coveredBy: [{ ownerEmail: 'x' }] });
  ok('E6 unknown values never grant more', e.state === 'free' && e.access('sync') === 'none' && e.access('telegram') === 'write' && e.access('sharing') === 'none' && e.coveredBy.length === 0);
  ok('E6 empty answer = Free', Entitlements.from(null).plan === 'free' && Entitlements.from('nope').access('sync') === 'none');
  let threw = false; try { e.access('payments'); } catch { threw = true; }
  ok('E6 asking about an unknown feature is a mistake', threw);
}
{
  const e = Entitlements.from({ ...lifetimeFamily, aiCredits: 3 });
  ok('E7 AI credits: 3 uses left', e.canUseAi() && e.canUseAi(3) && !e.canUseAi(4));
  const copy = e.toJSON(); copy.access.sync = 'none'; copy.coveredBy.length = 0;
  ok('E8 the object cannot be changed from outside', e.can('sync') && e.coveredBy.length === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
