/**
 * Budget alerts on Telegram, with a fake database and a fake Telegram.
 * Run: deno run -A supabase/functions/telegram-bot/test/budget_alerts_test.ts
 *
 *   L1  levels: over at 100%, near at 80%, fast when ahead (with fresh figures), none otherwise
 *   L2  nothing outside the period, or with broken figures
 *   M1  messages say the amounts, the % and the days left in plain words
 *   R1  from 9:00, to the owner's chats, once per budget, period and level
 *   R2  near then over both go; near after over doesn't
 *   R3  a new period alerts again
 *   R4  no plan with Telegram, no chats, or alerts before 9:00: nothing is sent
 */
import { BudgetAlertRunner } from '../lib/BudgetAlertRunner.ts';
import type { BudgetAlertCandidate, BudgetAlertLevel, BudgetAlertStatusRow, BudgetAlertStore } from '../lib/BudgetAlertStore.ts';
import { LocalClock } from '../lib/LocalClock.ts';
import type { PocketStore } from '../lib/PocketStore.ts';
import type { TelegramClient } from '../lib/TelegramClient.ts';

let passed = 0, failed = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nBudget alerts');

const OWNER = 'owner-1', OTHER = 'owner-2';
const status = (x: Partial<BudgetAlertStatusRow> = {}): BudgetAlertStatusRow => ({
  key: '2026-11-01…2026-11-30', from: '2026-11-01', to: '2026-11-30', label: 'November', name: 'Food',
  currency: 'INR', spent: 100000, limit: 400000, ahead: 0, at: '2026-11-16', ...x,
});

class FakeAlerts {
  rows: BudgetAlertCandidate[] = [];
  claimed = new Set<string>();
  candidates() { return Promise.resolve(this.rows); }
  sentLevels(o: string, b: string, k: string) {
    return Promise.resolve([...this.claimed].filter((c) => c.startsWith(`${o}|${b}|${k}|`)).map((c) => c.split('|')[3] as BudgetAlertLevel));
  }
  claim(o: string, b: string, k: string, l: BudgetAlertLevel) {
    const key = `${o}|${b}|${k}|${l}`;
    if (this.claimed.has(key)) return Promise.resolve(false);
    this.claimed.add(key);
    return Promise.resolve(true);
  }
}
class FakeStore {
  plans = new Map<string, unknown>([[OWNER, { state: 'active', access: { telegram: 'write' } }], [OTHER, { state: 'free', access: { telegram: 'none' } }]]);
  entitlements(u: string) { return Promise.resolve(this.plans.get(u) ?? null); }
}
class FakeTelegram {
  sent: { chat: number; text: string }[] = [];
  send(chat: number, text: string) { this.sent.push({ chat, text }); return Promise.resolve(1); }
}
const clockAt = (day: string, hhmm: string) => new LocalClock('Asia/Kolkata', () => Date.parse(`${day}T${hhmm}:00+05:30`));
const make = (alerts: FakeAlerts, tg: FakeTelegram, day = '2026-11-16', hhmm = '09:10', store = new FakeStore()) =>
  new BudgetAlertRunner(store as unknown as PocketStore, alerts as unknown as BudgetAlertStore, tg as unknown as TelegramClient, clockAt(day, hhmm));

// ── L, M ────────────────────────────────────────────────────────────────
{
  const T = '2026-11-16';
  ok('L1 over at 100%', BudgetAlertRunner.level(status({ spent: 400000 }), T) === 'over');
  ok('L1 near at 80%', BudgetAlertRunner.level(status({ spent: 320000 }), T) === 'near');
  ok('L1 fast when ahead with today\'s or yesterday\'s figures', BudgetAlertRunner.level(status({ ahead: 5000 }), T) === 'fast' && BudgetAlertRunner.level(status({ ahead: 5000, at: '2026-11-15' }), T) === 'fast');
  ok('L1 not fast on older figures', BudgetAlertRunner.level(status({ ahead: 5000, at: '2026-11-13' }), T) === null);
  ok('L1 nothing when calm', BudgetAlertRunner.level(status(), T) === null);
  ok('L2 nothing after the period or before it', BudgetAlertRunner.level(status({ spent: 999999 }), '2026-12-01') === null && BudgetAlertRunner.level(status({ spent: 999999 }), '2026-10-31') === null);
  ok('L2 nothing with broken figures', BudgetAlertRunner.level(status({ limit: 0, spent: 5 }), T) === null && BudgetAlertRunner.level(status({ from: 'x' }), T) === null);

  const near = BudgetAlertRunner.text(status({ spent: 340000 }), 'near', T);
  ok('M1 near: amounts, % and days left', near.includes('₹3,400 of ₹4,000 used (85%)') && near.includes('₹600 left for 15 days') && near.includes('November'), near);
  const over = BudgetAlertRunner.text(status({ spent: 430000 }), 'over', T);
  ok('M1 over: by how much', over.includes('Food budget is over: ₹4,300 spent of ₹4,000 (₹300 over)'), over);
  const fast = BudgetAlertRunner.text(status({ spent: 200000, ahead: 50000 }), 'fast', '2026-11-30');
  ok('M1 fast: by how much, and "today" on the last day', fast.includes('faster than planned by ₹500') && fast.includes('left for today'), fast);
  ok('M1 other currencies', BudgetAlertRunner.money(12345, 'USD') === '123.45 USD');
}

// ── R ───────────────────────────────────────────────────────────────────
{
  const alerts = new FakeAlerts(), tg = new FakeTelegram();
  alerts.rows = [
    { ownerId: OWNER, budgetId: 'b1', status: status({ spent: 330000 }), chats: [101, 101, 102] },
    { ownerId: OWNER, budgetId: 'b2', status: status({ name: 'Home' }), chats: [101] },
  ];
  const early = await make(alerts, tg, '2026-11-16', '08:59').run();
  ok('R4 nothing before 9:00', early.budgetAlerts === 0 && tg.sent.length === 0);
  const r = await make(alerts, tg).run();
  ok('R1 one alert, to each of the owner\'s chats once', r.budgetAlerts === 1 && tg.sent.length === 2 && tg.sent.every((s) => s.text.startsWith('🟡 Food')), JSON.stringify(tg.sent));
  await make(alerts, tg, '2026-11-16', '09:20').run();
  ok('R1 the next run sends nothing more', tg.sent.length === 2);

  alerts.rows[0].status = status({ spent: 410000 });
  await make(alerts, tg).run();
  ok('R2 going over after near is sent', tg.sent.length === 4 && tg.sent[2].text.startsWith('🔴 Food budget is over'));
  alerts.rows[0].status = status({ spent: 330000 }); // e.g. a refund brought it back under
  await make(alerts, tg).run();
  ok('R2 near is not sent again after over', tg.sent.length === 4);

  alerts.rows[0].status = status({ key: '2026-12-01…2026-12-31', from: '2026-12-01', to: '2026-12-31', label: 'December', spent: 330000, at: '2026-12-02' });
  await make(alerts, tg, '2026-12-02').run();
  ok('R3 a new month alerts again', tg.sent.length === 6 && tg.sent[4].text.includes('December'));
}
{
  const alerts = new FakeAlerts(), tg = new FakeTelegram();
  alerts.rows = [
    { ownerId: OTHER, budgetId: 'b1', status: status({ spent: 500000 }), chats: [303] },
    { ownerId: OWNER, budgetId: 'b9', status: status({ spent: 500000 }), chats: [] },
  ];
  const r = await make(alerts, tg).run();
  ok('R4 no plan with Telegram, or no linked chat: nothing sent and nothing claimed', r.budgetAlerts === 0 && tg.sent.length === 0 && alerts.claimed.size === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
