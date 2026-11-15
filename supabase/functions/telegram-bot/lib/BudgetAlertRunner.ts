/**
 * BudgetAlertRunner — Telegram alerts for budgets, from 9:00 in the bot's
 * time zone:
 *   over  spent reached the limit
 *   near  spent reached 80% of it
 *   fast  spending is ahead of an even spread (figures from today or yesterday)
 * Only the most urgent level that holds is sent, once per budget and period
 * (claimed in budget_alerts). An alert at a lower level never follows a
 * higher one in the same period.
 *
 * Works only from the totals the app stamped on the budget (alertStatus);
 * it never reads transactions. Goes to the book owner's own chat(s), and only
 * while the owner's plan includes Telegram.
 */
import type { BudgetAlertCandidate, BudgetAlertLevel, BudgetAlertStatusRow, BudgetAlertStore } from './BudgetAlertStore.ts';
import { LocalClock } from './LocalClock.ts';
import { Money } from './Money.ts';
import { PlanAccess } from './PlanAccess.ts';
import type { PocketStore } from './PocketStore.ts';
import type { TelegramClient } from './TelegramClient.ts';

export class BudgetAlertRunner {
  static readonly FROM_MINUTE = 540;
  static readonly NEAR = 0.8;
  static readonly #RANK: Record<BudgetAlertLevel, number> = { fast: 1, near: 2, over: 3 };

  readonly #store: PocketStore;
  readonly #alerts: BudgetAlertStore;
  readonly #telegram: TelegramClient;
  readonly #clock: LocalClock;

  constructor(store: PocketStore, alerts: BudgetAlertStore, telegram: TelegramClient, clock: LocalClock) {
    this.#store = store;
    this.#alerts = alerts;
    this.#telegram = telegram;
    this.#clock = clock;
  }

  /** The most urgent level that holds today, or null (also when the figures don't apply). */
  static level(s: BudgetAlertStatusRow, today: string): BudgetAlertLevel | null {
    if (!BudgetAlertRunner.#valid(s) || today < s.from || today > s.to) return null;
    if (s.spent >= s.limit) return 'over';
    if (s.spent >= s.limit * BudgetAlertRunner.NEAR) return 'near';
    if (s.ahead > 0 && s.at >= LocalClock.shift(today, -1)) return 'fast';
    return null;
  }

  static text(s: BudgetAlertStatusRow, level: BudgetAlertLevel, today: string): string {
    const m = (minor: number) => BudgetAlertRunner.money(minor, s.currency);
    const daysLeft = Math.max(0, Math.round((Date.parse(`${s.to}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) + 1);
    const left = `${m(Math.max(0, s.limit - s.spent))} left for ${daysLeft === 1 ? 'today' : `${daysLeft} days`}`;
    const pct = Math.round((100 * s.spent) / s.limit);
    switch (level) {
      case 'over':
        return `🔴 ${s.name} budget is over: ${m(s.spent)} spent of ${m(s.limit)} (${m(s.spent - s.limit)} over) · ${s.label}`;
      case 'near':
        return `🟡 ${s.name} budget: ${m(s.spent)} of ${m(s.limit)} used (${pct}%) · ${left} · ${s.label}`;
      default:
        return `🟠 ${s.name} budget: spending faster than planned by ${m(s.ahead)} · ${m(s.spent)} of ${m(s.limit)} used · ${left} · ${s.label}`;
    }
  }

  static money(minor: number, currency: string): string {
    const major = minor / new Money({}).factor(currency);
    const n = major.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return currency === 'INR' ? `₹${n}` : `${n} ${currency}`;
  }

  async run(): Promise<{ budgetAlerts: number }> {
    if (this.#clock.minuteOfDay() < BudgetAlertRunner.FROM_MINUTE) return { budgetAlerts: 0 };
    const today = this.#clock.isoDate();
    const plans = new Map<string, PlanAccess>();
    let sent = 0;
    for (const c of await this.#alerts.candidates()) {
      try {
        if (await this.#send(c, today, plans)) sent++;
      } catch (e) {
        console.error('[budget alerts]', c.ownerId, c.budgetId, e);
      }
    }
    return { budgetAlerts: sent };
  }

  async #send(c: BudgetAlertCandidate, today: string, plans: Map<string, PlanAccess>): Promise<boolean> {
    const level = BudgetAlertRunner.level(c.status, today);
    const chats = [...new Set((c.chats || []).map(Number).filter(Number.isFinite))];
    if (!level || !chats.length) return false;
    if (!plans.has(c.ownerId)) plans.set(c.ownerId, await PlanAccess.load(this.#store, c.ownerId));
    if (!plans.get(c.ownerId)!.ownBook) return false;
    // A lower level after a higher one in the same period says nothing new.
    const done = await this.#alerts.sentLevels(c.ownerId, c.budgetId, c.status.key);
    if (done.some((l) => BudgetAlertRunner.#RANK[l] >= BudgetAlertRunner.#RANK[level])) return false;
    if (!(await this.#alerts.claim(c.ownerId, c.budgetId, c.status.key, level))) return false;
    const text = BudgetAlertRunner.text(c.status, level, today);
    for (const chat of chats) await this.#telegram.send(chat, text);
    return true;
  }

  static #valid(s: BudgetAlertStatusRow): boolean {
    const iso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    return !!s && iso(s.from) && iso(s.to) && iso(s.at) && typeof s.key === 'string'
      && Number.isFinite(s.spent) && Number.isFinite(s.limit) && s.limit > 0 && Number.isFinite(s.ahead ?? 0);
  }
}
