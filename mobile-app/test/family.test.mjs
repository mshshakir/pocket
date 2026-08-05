/**
 * family.test.mjs — MobileSyncService family sharing under plain node.
 *
 * Same guarantees the web sharing suite enforces, now on the mobile port:
 *   - live round-trip: a member ADD and a member DELETE both reach the owner
 *   - H9: contributions authorised against the CURRENT permission map
 *   - H6: an edit replaces (no duplicate, account charged once)
 *   - H8: revoking deletes the family_shares row
 *
 * Run:  node test/family.test.mjs
 */
import { Repository } from '../src/core/Repository.js';
import { Store } from '../src/core/Store.js';
import { EventBus } from '../src/core/EventBus.js';
import { StateMigrator } from '../src/data/StateMigrator.js';
import { AccountService } from '../src/domain/services/AccountService.js';
import { MobileSyncService } from '../src/domain/services/MobileSyncService.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// In-memory AsyncStorage stand-in.
const mem = new Map();
Repository.setBackend({
  getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: async (k, v) => { mem.set(k, v); },
  removeItem: async (k) => { mem.delete(k); },
});
await Repository.prepare();

// ── Owner's seed: one shared account + a member with 'full' on it ──────────
const ownerState = {
  user: { homeCurrency: 'USD', defaultCurrency: 'USD', hijriOffset: 0,
          customPaymentTypes: [], hiddenPaymentTypes: [] },
  accounts: [
    { id: 'own1', name: 'Private', type: 'cash', currency: 'USD', openingBalance: 0, balance: 0 },
    { id: 'shared1', name: 'Joint', type: 'bank', currency: 'USD', openingBalance: 0, balance: 0 },
  ],
  categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#f97316', icon: 'tag' }],
  transactions: [], budgets: [], debts: [],
  family: [{ id: 'f1', name: 'Member', email: 'member@x.com',
             permissions: [{ accountId: 'shared1', access: 'full' }] }],
  regularItems: [], merchantCategories: {}, accountGroups: [],
};

const store = Store.getInstance();
const accounts = new AccountService();
store.setDeriveHook(() => accounts.recompute());
store.init(() => JSON.parse(JSON.stringify(ownerState)), (s) => StateMigrator.migrate(s));
accounts.recompute();

// ── Fake Supabase carrying user_data + family_contributions + family_shares ──
const cloud = { userRow: { id: 'owner1', data: null, version: 3 }, contributions: [], shares: [], deleted: [], synced: [] };
const fakeSb = {
  auth: {
    onAuthStateChange() {}, getSession: async () => ({ data: { session: null } }),
    signOut: async () => {}, signInWithOtp: async () => ({}), verifyOtp: async () => ({}),
  },
  removeChannel() {},
  channel() { const c = { on() { return c; }, subscribe(cb) { cb?.('SUBSCRIBED'); return c; }, send() {} }; return c; },
  from(table) {
    const q = {
      _eq: {}, _in: null, _patch: null, _delete: false,
      select() { return q; }, eq(k, v) { q._eq[k] = v; return q; },
      in(k, v) { q._in = { k, v }; return q; }, order() { return q; },
      delete() { q._delete = true; return q; }, update(p) { q._patch = p; return q; },
      async upsert(payload) {
        if (table === 'user_data')     cloud.userRow = { ...cloud.userRow, ...payload };
        if (table === 'family_shares') {
          cloud.shares = cloud.shares.filter((s) => s.member_email !== payload.member_email).concat([{ ...payload }]);
        }
        if (table === 'family_contributions') cloud.contributions.push({ id: payload.id || `c${cloud.contributions.length}`, ...payload });
        return { error: null };
      },
      async single() {
        return table === 'user_data' ? { data: cloud.userRow, error: null } : { data: null, error: { code: 'PGRST116' } };
      },
      then(res) {
        if (q._delete && table === 'family_shares') {
          cloud.deleted.push(q._eq.member_email);
          cloud.shares = cloud.shares.filter((s) => s.member_email !== q._eq.member_email);
          return res({ data: [], error: null });
        }
        if (q._patch && table === 'user_data') {
          const ok = q._eq.version === undefined || q._eq.version === cloud.userRow.version;
          if (ok) { cloud.userRow = { ...cloud.userRow, ...q._patch }; return res({ data: [{ version: q._patch.version }], error: null }); }
          return res({ data: [], error: null });
        }
        if (q._patch && table === 'family_contributions') {
          const ids = q._in?.v || [];
          cloud.synced.push(...ids);
          cloud.contributions.forEach((c) => { if (ids.includes(c.id)) c.synced = true; });
          return res({ data: [], error: null });
        }
        if (table === 'family_contributions') return res({ data: cloud.contributions.filter((c) => !c.synced), error: null });
        if (table === 'family_shares') return res({ data: cloud.shares, error: null });
        return res({ data: [], error: null });
      },
    };
    return q;
  },
};

// Boot the service as the OWNER.
const sync = new MobileSyncService();
// Inject the fake client + user without going through Supabase auth.
sync._testInject?.(fakeSb, { id: 'owner1', email: 'owner@x.com' });

console.log('\nmobile family suite');
ok('service exposes a test seam', typeof sync._testInject === 'function');

// Owner applies a member ADD.
cloud.contributions.push({
  id: 'add1', owner_id: 'owner1', member_email: 'member@x.com', account_id: 'shared1', synced: false,
  tx_data: { id: 'm1', accountId: 'shared1', categoryId: 'c1', amount: 2500, currency: 'USD',
             type: 'expense', date: '2026-06-01', paymentType: 'card', recordState: 'cleared', tags: [] },
});
await sync._testPullContribs();
await wait(20);
const saved = () => store.getState();
ok('SYNC member ADD lands in the owner ledger', saved().transactions.some((t) => t.id === 'm1'));
ok('SYNC shared account balance moved', accounts.balanceOf(saved().accounts.find((a) => a.id === 'shared1')) === -2500,
   String(accounts.balanceOf(saved().accounts.find((a) => a.id === 'shared1'))));

// H6: an edit replaces, not duplicates.
cloud.contributions.push({ id: 'rep1', owner_id: 'owner1', member_email: 'member@x.com', account_id: 'shared1', synced: false,
  tx_data: { _delete: true, _replace: true, id: 'r_m1', targetId: 'm1' } });
cloud.contributions.push({ id: 'add1b', owner_id: 'owner1', member_email: 'member@x.com', account_id: 'shared1', synced: false,
  tx_data: { id: 'm1', accountId: 'shared1', categoryId: 'c1', amount: 9000, currency: 'USD',
             type: 'expense', date: '2026-06-01', paymentType: 'card', recordState: 'cleared', tags: [] } });
await sync._testPullContribs();
await wait(20);
ok('H6 edit did not duplicate', saved().transactions.filter((t) => t.id === 'm1').length === 1,
   String(saved().transactions.filter((t) => t.id === 'm1').length));
ok('H6 edit applied (amount updated)', saved().transactions.find((t) => t.id === 'm1')?.amount === 9000);

// H9: a stranger, and a member touching a non-shared account, are rejected.
cloud.contributions.push({ id: 'evil1', owner_id: 'owner1', member_email: 'stranger@x.com', account_id: 'own1', synced: false,
  tx_data: { id: 'e1', accountId: 'own1', amount: 999, currency: 'USD', type: 'expense', date: '2026-06-02', paymentType: 'card', recordState: 'cleared', tags: [] } });
cloud.contributions.push({ id: 'wrong1', owner_id: 'owner1', member_email: 'member@x.com', account_id: 'own1', synced: false,
  tx_data: { id: 'w1', accountId: 'own1', amount: 500, currency: 'USD', type: 'expense', date: '2026-06-02', paymentType: 'card', recordState: 'cleared', tags: [] } });
await sync._testPullContribs();
await wait(20);
ok('H9 stranger rejected', !saved().transactions.some((t) => t.id === 'e1'));
ok('H9 member cannot write outside their grant', !saved().transactions.some((t) => t.id === 'w1'));

// member DELETE round-trips.
cloud.contributions.push({ id: 'del1', owner_id: 'owner1', member_email: 'member@x.com', account_id: 'shared1', synced: false,
  tx_data: { _delete: true, id: 'd_m1', targetId: 'm1' } });
await sync._testPullContribs();
await wait(20);
ok('SYNC member DELETE removes it', !saved().transactions.some((t) => t.id === 'm1'));
ok('SYNC balance reverted', accounts.balanceOf(saved().accounts.find((a) => a.id === 'shared1')) === 0,
   String(accounts.balanceOf(saved().accounts.find((a) => a.id === 'shared1'))));

// H8: revoking a member deletes their share row.
await sync.revokeMemberShare('member@x.com');
await wait(20);
ok('H8 revoke deleted the share row', cloud.deleted.includes('member@x.com'), JSON.stringify(cloud.deleted));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
