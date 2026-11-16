/**
 * UpdateQueue: each Telegram update handled once; unfinished ones handled again.
 * Run: deno run --allow-all --import-map <map with a supabase-js stub> supabase/functions/telegram-bot/test/queue_test.ts
 */
import { UpdateQueue } from '../lib/UpdateQueue.ts';

class FakeStore {
  rows = new Map<number, { payload: unknown; done: boolean; error?: string }>();
  fail = false;
  async receiveUpdate(id: number, payload: unknown) {
    if (this.fail) throw new Error('db down');
    if (this.rows.has(id)) return false;
    this.rows.set(id, { payload, done: false });
    return true;
  }
  async finishUpdate(id: number, error?: string) { const r = this.rows.get(id)!; r.done = true; r.error = error; }
  async staleUpdates() {
    return [...this.rows.entries()].filter(([, r]) => !r.done)
      .map(([update_id, r]) => ({ update_id, payload: r.payload as Record<string, unknown> }));
  }
}
class FakeController {
  handled: number[] = [];
  throwOn = -1;
  async handleMessage(m: { message_id: number }) {
    this.handled.push(m.message_id);
    if (m.message_id === this.throwOn) throw new Error('boom');
  }
  async handleCallback() {}
}

const store = new FakeStore();
const ctl = new FakeController();
// deno-lint-ignore no-explicit-any
const q = new UpdateQueue(store as any, ctl as any);
const upd = (id: number) => ({ update_id: id, message: { message_id: id, chat: { id: 1 }, text: 'x' } });
const checks: [string, boolean][] = [];

checks.push(['new update is accepted', await q.receive(upd(1))]);
checks.push(['a re-send is skipped', !(await q.receive(upd(1)))]);
await q.handle(upd(1));
checks.push(['handled once and marked done', ctl.handled.join() === '1' && store.rows.get(1)!.done]);

ctl.throwOn = 2;
await q.receive(upd(2)); await q.handle(upd(2));
checks.push(['a failure is still marked done, with its error', store.rows.get(2)!.done && store.rows.get(2)!.error === 'boom']);

await q.receive(upd(3)); // stored, but the function "stopped" before handling it
checks.push(['sweep handles the unfinished one', (await q.sweep()) === 1 && ctl.handled.includes(3) && store.rows.get(3)!.done]);
checks.push(['nothing left to sweep', (await q.sweep()) === 0]);

store.fail = true;
let threw = false;
try { await q.receive(upd(4)); } catch { threw = true; }
checks.push(['cannot store → throws so Telegram retries', threw]);

for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
if (checks.some(([, ok]) => !ok)) Deno.exit(1);
