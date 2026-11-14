/**
 * book-diff.smoke.mjs — the item-level change sets the cloud sync sends.
 *
 * The web app saves only what changed since the cloud last confirmed the
 * book, and replays unsaved edits onto a newer cloud copy after a reload.
 * Both depend on BookDiff being exact: replaying changes(a, b) onto a must
 * give b, and edits made elsewhere must survive the replay.
 *
 * Pure domain — no DOM, no network. Run: node src/__smoke__/book-diff.smoke.mjs
 */
import { BookDiff } from '../core/BookDiff.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, sortKeys(v[k])]));
  }
  return v;
}

const tx = (id, amount, over = {}) => ({ id, accountId: 'a1', amount, type: 'expense', date: '2026-11-01', ...over });
const base = () => ({
  user: { homeCurrency: 'USD', theme: 'light' },
  accounts: [{ id: 'a1', name: 'Cash' }, { id: 'a2', name: 'Bank' }],
  categories: [{ id: 'c1', name: 'Food' }],
  transactions: [tx('t1', 100), tx('t2', 200)],
  budgets: [], debts: [], family: [], regularItems: [], spaces: [], accountGroups: [],
  fxRates: { USD: 1, INR: 83 },
  merchantCategories: {},
});

console.log('\nbook diff suite');

{
  const b = base();
  ok('no change → nothing to send', BookDiff.changes(b, BookDiff.clone(b)) === null);
  const reordered = BookDiff.clone(b);
  reordered.user = { theme: 'light', homeCurrency: 'USD' };
  ok('key order alone is not a change', BookDiff.changes(b, reordered) === null);
}

{
  const b = base();
  const cur = BookDiff.clone(b);
  cur.transactions[1].amount = 250;
  cur.transactions.push(tx('t3', 300));
  cur.transactions.splice(0, 1);
  cur.accounts[0].name = 'Wallet';
  const ch = BookDiff.changes(b, cur);
  ok('only changed items are sent',
     ch.put.transactions.map((t) => t.id).join() === 't2,t3' && ch.put.accounts.length === 1,
     JSON.stringify(ch.put));
  ok('a removed item is sent as a remove', ch.remove.transactions.join() === 't1');
  ok('each put carries its list position', ch.put.transactions[0]._pos === 1 && ch.put.transactions[1]._pos === 2);
  ok('untouched settings are not sent', !('user' in ch) && !('fxRates' in ch));
  ok('replaying the changes reproduces the new state',
     same(BookDiff.apply(BookDiff.clone(b), ch), cur));
  ok('touched rows are reported for echo suppression',
     [...BookDiff.touchedKeys(ch)].sort().join() === 'accounts:a1,transactions:t1,transactions:t2,transactions:t3');
}

{
  const b = base();
  const cur = BookDiff.clone(b);
  cur.user.theme = 'dark';
  cur.fxRates.INR = 84;
  cur._transferDirBackfilled = true;
  cur.regularLogs = [{ legacy: true }];
  const ch = BookDiff.changes(b, cur);
  ok('a settings change sends the settings', ch.user?.theme === 'dark' && ch._transferDirBackfilled === true);
  ok('a changed map is sent whole', ch.fxRates?.INR === 84 && ch.fxRates?.USD === 1);
  ok('unknown top-level data travels as bookExtra', same(ch.bookExtra, { regularLogs: [{ legacy: true }] }));
  ok('…and replays exactly', same(BookDiff.apply(BookDiff.clone(b), ch), cur));
}

{
  // This device edited t2 and added t3 while offline; another device
  // meanwhile added t9 and renamed the category. Replaying our changes onto
  // the newer cloud copy must keep both.
  const synced = base();
  const local = BookDiff.clone(synced);
  local.transactions[1].amount = 222;
  local.transactions.push(tx('t3', 300));
  const pending = BookDiff.changes(synced, local);

  const cloud = BookDiff.clone(synced);
  cloud.transactions.push(tx('t9', 900));
  cloud.categories[0].name = 'Groceries';

  const merged = BookDiff.apply(BookDiff.clone(cloud), pending);
  ok('our edit wins on the item we changed', merged.transactions.find((t) => t.id === 't2').amount === 222);
  ok('our new item is kept', merged.transactions.some((t) => t.id === 't3'));
  ok('the other device\'s new item is kept', merged.transactions.some((t) => t.id === 't9'));
  ok('the other device\'s edit elsewhere is kept', merged.categories[0].name === 'Groceries');
}

{
  const ch = BookDiff.changes(null, base());
  ok('against no baseline, everything is new', ch.put.transactions.length === 2 && ch.put.accounts.length === 2);
  ok('…and nothing is removed', !ch.remove);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
