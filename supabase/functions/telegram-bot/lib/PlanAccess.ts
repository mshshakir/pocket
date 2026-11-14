/**
 * PlanAccess — what a linked person's plan lets them do by Telegram
 * (migrations 0018–0020; the same answer the web app gets).
 *
 * The bot writes with the service key, which the database's plan guard lets
 * through, so the bot applies the plan rules itself:
 *   • their own book: their plan includes Telegram and is active;
 *   • someone else's shared book: that owner's Family plan covers them and is active.
 * When neither holds, notice() is the reply to send instead of saving: when a
 * plan has just ended it tells them to download their data while it is still
 * readable (billing_settings.grace_days, 30 by default).
 */
import type { PocketStore } from './PocketStore.ts';

type Access = 'write' | 'read' | 'none';

interface Coverage {
  ownerId: string;
  ownerEmail: string;
  access: Access;
}

export class PlanAccess {
  static readonly #LEVELS: readonly Access[] = ['write', 'read', 'none'];

  readonly #state: string;
  readonly #telegram: Access;
  readonly #endsAt: Date | null;
  readonly #graceUntil: Date | null;
  readonly #coveredBy: Coverage[];

  private constructor(state: string, telegram: Access, endsAt: Date | null, graceUntil: Date | null, coveredBy: Coverage[]) {
    this.#state = state;
    this.#telegram = telegram;
    this.#endsAt = endsAt;
    this.#graceUntil = graceUntil;
    this.#coveredBy = coveredBy;
  }

  static async load(store: PocketStore, userId: string): Promise<PlanAccess> {
    return PlanAccess.from(await store.entitlements(userId));
  }

  /** Anything missing or unknown reads as no access, never as more. */
  static from(raw: unknown): PlanAccess {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const level = (v: unknown): Access => (PlanAccess.#LEVELS.includes(v as Access) ? v as Access : 'none');
    const date = (v: unknown): Date | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);
    const access = (r.access && typeof r.access === 'object' ? r.access : {}) as Record<string, unknown>;
    const covered = Array.isArray(r.coveredBy) ? r.coveredBy as Array<Record<string, unknown>> : [];
    return new PlanAccess(
      typeof r.state === 'string' ? r.state : 'free',
      level(access.telegram),
      date(r.endsAt),
      date(r.graceUntil),
      covered
        .filter((c) => typeof c?.ownerId === 'string')
        .map((c) => ({ ownerId: c.ownerId as string, ownerEmail: String(c.ownerEmail ?? ''), access: level(c.access) })),
    );
  }

  /** May log into their own book. */
  get ownBook(): boolean {
    return this.#telegram === 'write';
  }

  /** May log into this owner's shared space. */
  sharedBook(ownerId: string): boolean {
    return this.#coveredBy.some((c) => c.ownerId === ownerId && c.access === 'write');
  }

  /** May log anywhere at all. */
  get canLog(): boolean {
    return this.ownBook || this.#coveredBy.some((c) => c.access === 'write');
  }

  /** The reply instead of saving, or null when they may log. */
  notice(today: Date = new Date()): string | null {
    if (this.canLog) return null;
    if (this.#state === 'grace' && this.#graceUntil && this.#graceUntil > today) {
      const ended = this.#endsAt ? ` on ${PlanAccess.#day(this.#endsAt)}` : '';
      return `⏸ Your Pocket plan ended${ended}, so logging here is paused.\n\n`
        + `Your data in the cloud stays readable until ${PlanAccess.#day(this.#graceUntil)}. `
        + 'Please download a copy before then: open Pocket → Settings → Download my data.\n\n'
        + 'Renew your plan to keep logging here.';
    }
    if (this.#coveredBy.some((c) => c.access === 'read')) {
      return '⏸ The Family plan you log under has ended, so logging into that shared space is paused. '
        + 'You can still see it in the Pocket app for now.';
    }
    return 'Logging by Telegram is part of Pocket\'s Sync and Family plans.\n\n'
      + 'Pocket itself stays free on your device. Open the app → Settings → Your plan to upgrade.';
  }

  static #day(d: Date): string {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  }
}
