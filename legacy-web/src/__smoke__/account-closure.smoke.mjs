/**
 * account-closure.smoke.mjs — deleting your own account (migrations 0055, 0056).
 * The server side is dry-run in the database.
 *
 *   D1  Asking schedules it and leaves a note on this device; keeping the
 *       account cancels it and drops the note.
 *   D2  At start: the note is acted on only when the date has passed and no
 *       one is signed in to that account; a cancelled deletion (seen from
 *       another device) drops the note; a different book is never wiped.
 *   D3  Signed out or offline: no answer, never an error.
 *
 * Run: node src/__smoke__/account-closure.smoke.mjs
 */
import { AccountClosure } from '../domain/services/AccountClosure.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

class MemoryStorage {
  #m = new Map();
  getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; }
  setItem(k, v) { this.#m.set(k, String(v)); }
  removeItem(k) { this.#m.delete(k); }
}

console.log('\nAccount closure suite');
const later = new Date(Date.now() + 7 * 864e5).toISOString();
{
  const calls = [];
  let pending = false;
  const rpc = () => async (fn) => {
    calls.push(fn);
    if (fn === 'pocket_account_delete_request') pending = true;
    if (fn === 'pocket_account_delete_cancel') pending = false;
    return { data: pending ? { pending: true, deleteAfter: later } : { pending: false }, error: null };
  };
  const store = new MemoryStorage();
  const c = new AccountClosure(rpc, store);
  const s = await c.request('user-1');
  ok('D1 asking schedules the deletion 7 days out', s.pending && Math.round((s.deleteAfter - Date.now()) / 864e5) === 7);
  ok('D1 a note is left on this device for that account', c.note?.owner === 'user-1');
  const kept = await c.cancel();
  ok('D1 keeping the account cancels it and drops the note', !kept.pending && c.note === null && calls.includes('pocket_account_delete_cancel'));
}
{
  const store = new MemoryStorage();
  const c = new AccountClosure(() => null, store);
  store.setItem(AccountClosure.KEY, JSON.stringify({ owner: 'user-1', at: new Date(Date.now() - 1000).toISOString() }));
  ok('D2 date passed, nobody signed in, same book: empty the device', c.decide('user-1', false, null) === 'wipe');
  ok('D2 a different account\'s book is never emptied (note dropped)', c.decide('user-2', false, null) === 'keep');
  ok('D2 still signed in and the server says it was cancelled: drop the note', c.decide('user-1', true, { pending: false }) === 'keep');
  ok('D2 still signed in and it\'s still pending: wait for the server', c.decide('user-1', true, { pending: true }) === 'wait');
  ok('D2 signed in but offline (no answer): wait', c.decide('user-1', true, null) === 'wait');
  store.setItem(AccountClosure.KEY, JSON.stringify({ owner: 'user-1', at: later }));
  ok('D2 before the date: wait', c.decide('user-1', false, null) === 'wait');
  store.setItem(AccountClosure.KEY, 'not json');
  ok('D2 a broken note is ignored', c.note === null && c.decide('user-1', false, null) === 'wait');
}
{
  const c = new AccountClosure(() => null, new MemoryStorage());
  ok('D3 signed out: no answer, no error', (await c.state()) === null);
  const off = new AccountClosure(() => async () => ({ data: null, error: { message: 'offline' } }), new MemoryStorage());
  ok('D3 offline: no answer, no error', (await off.state()) === null);
  let threw = false;
  try { await off.request('u'); } catch (e) { threw = /couldn't reach/.test(e.message); }
  ok('D3 asking while offline says so', threw);
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
