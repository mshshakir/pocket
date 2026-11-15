/**
 * Payback — the app's reimbursement rules (ReimbursementService), for the bot.
 *
 *   expected     reimbExpected when set (capped at the amount), else the amount
 *   outstanding  expected − paid back so far, 0 once closed
 *   share        Spread evenly (each item the same share of what it's owed)
 *                or Oldest first; the parts add up exactly
 *
 * Pure: works on app-shaped entries (`_paid` = paid back so far).
 */
import type { OwedTx } from './PocketStore.ts';

export interface OpenItem {
  tx: OwedTx;
  expected: number;     // own currency, minor
  paid: number;         // own currency, minor
  outstanding: number;  // own currency, minor
}

export interface Part { txId: string; amount: number }

export class Payback {
  static readonly TAG = 'reimbursement';

  static expected(tx: OwedTx): number {
    const full = Number(tx.amount) || 0;
    const e = Number(tx.reimbExpected);
    return Number.isFinite(e) && e > 0 ? Math.min(e, full) : full;
  }

  /** An item as it stands; `less` takes one payment's share back out (to re-share it). */
  static open(tx: OwedTx, less = 0): OpenItem {
    const expected = Payback.expected(tx);
    const paid = Math.max(0, (Number(tx._paid) || 0) - less);
    const outstanding = tx.reimbClosed === true ? 0 : Math.max(0, expected - paid);
    return { tx, expected, paid, outstanding };
  }

  /** "Star health" and "star  Health" are the same payer. */
  static key(name: string): string {
    return String(name || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
  }

  /**
   * Split `total` (in the items' units) across items, in date order.
   * @returns the parts and what's left over (more than owed)
   */
  static allocate(items: { id: string; outstanding: number }[], total: number, mode: 'spread' | 'oldest'): { parts: Part[]; extra: number } {
    const want = Math.max(0, Math.round(total));
    const open = items.filter((i) => i.outstanding > 0);
    const owed = open.reduce((n, i) => n + i.outstanding, 0);
    const share = Math.min(want, owed);
    const parts: Part[] = [];
    if (mode === 'oldest') {
      let left = share;
      for (const i of open) {
        if (left <= 0) break;
        const a = Math.min(left, i.outstanding);
        parts.push({ txId: i.id, amount: a });
        left -= a;
      }
    } else {
      let given = 0;
      open.forEach((i, k) => {
        const a = k === open.length - 1 ? share - given : Math.floor((share * i.outstanding) / (owed || 1));
        const capped = Math.max(0, Math.min(a, i.outstanding));
        if (capped > 0) { parts.push({ txId: i.id, amount: capped }); given += capped; }
      });
      let rest = share - given;
      for (const p of parts) {
        if (rest <= 0) break;
        const room = open.find((o) => o.id === p.txId)!.outstanding - p.amount;
        const add = Math.min(room, rest);
        p.amount += add; rest -= add;
      }
    }
    const used = parts.reduce((n, p) => n + p.amount, 0);
    return { parts, extra: Math.max(0, want - used) };
  }

  /** An entry without the bot-only read fields, ready to save. */
  static clean<T extends Record<string, unknown>>(row: T): T {
    const { _paid, ...rest } = row as Record<string, unknown>;
    void _paid;
    return rest as T;
  }
}
