/**
 * SyncJournal — durable record of "local state holds edits the cloud has not
 * accepted yet".
 *
 * SyncService already tracks that with an in-memory `#dirty` flag, but a flag
 * that lives in a field dies with the page. That is precisely the window the
 * user lost three transactions in: each save armed a 1s debounce, the tab was
 * refreshed before it fired, and on the next boot nothing remembered that the
 * cloud row was now STALE — so the boot pull adopted it and overwrote the local
 * copy that still held all three entries.
 *
 * Writing one tiny record to localStorage alongside the state itself lets a
 * cold start answer the only question that matters: "is the cloud row a fair
 * representation of what this device knows, or is it behind?"
 *
 * The record is scoped to a user id so that signing in as someone else on the
 * same browser can never make their boot adopt the previous user's verdict.
 */
export class SyncJournal {
  static #KEY = 'pocket.v1.pending';

  /**
   * Record that local state has edits which have not been committed to the
   * cloud. Cheap and idempotent — called on every local save, so it must stay
   * a single small synchronous write.
   *
   * `baseVersion` is the cloud row version those edits were made ON TOP OF, and
   * it is what makes recovery safe in both directions. On the next boot:
   *   row.version === baseVersion  → nobody else wrote; local is strictly ahead
   *                                  and may be committed over the row.
   *   row.version !== baseVersion  → another device wrote while this one was
   *                                  away; overwriting would destroy THEIR work,
   *                                  so the local copy is stashed instead.
   * Without it, "recover my unsynced edits" degenerates into "last device to
   * open the app wins", which just moves the data loss somewhere else.
   *
   * @param {string} userId        the signed-in user the pending edits belong to
   * @param {number|null} baseVersion  cloud version the edits were made against
   */
  mark(userId, baseVersion = null) {
    if (!userId) return;
    const existing = this.read();
    // Preserve the original timestamp across a burst of edits so `since`
    // measures how long work has been at risk, not how long since the last key
    // press. The baseline, by contrast, always tracks the newest known version.
    const since = existing?.userId === userId ? existing.since : new Date().toISOString();
    this.#write({ userId, since, baseVersion });
  }

  /** Record that local state matches the cloud — nothing outstanding. */
  clear() {
    try { localStorage.removeItem(SyncJournal.#KEY); } catch (_) { /* private mode */ }
  }

  /**
   * @returns {{userId: string, since: string, baseVersion: number|null}|null}
   */
  read() {
    try {
      const raw = localStorage.getItem(SyncJournal.#KEY);
      if (!raw) return null;
      const rec = JSON.parse(raw);
      return rec && rec.userId ? rec : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * True when THIS user left uncommitted work behind.
   * @param {string} userId
   * @returns {boolean}
   */
  isPendingFor(userId) {
    if (!userId) return false;
    return this.read()?.userId === userId;
  }

  /** @param {{userId: string, since: string}} rec */
  #write(rec) {
    try { localStorage.setItem(SyncJournal.#KEY, JSON.stringify(rec)); } catch (_) {
      // Quota or private mode. Losing the journal only costs us the cold-start
      // recovery; it must never break the save itself.
    }
  }
}
