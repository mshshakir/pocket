/**
 * ProgrammeBatches — what the website says about the habit programme's
 * batches, from pocket_programme_next() (migration 0041): each batch not yet
 * finished with its state (upcoming · open · full · closed · running), dates
 * and places left.
 *
 *   open      "Batch 3 is open · starts 1 Dec · 4 of 10 places left"
 *   full      "Batch 3 is full · join the waitlist for the next batch"
 *   upcoming  "Next batch starts 1 Dec · applications open 20 Nov"
 *   closed    "Applications for Batch 3 are closed · join the waitlist"
 *   running   "Batch 3 is running now · join the waitlist for the next one"
 *   none      "Join the waitlist and we'll tell you when the next batch opens"
 *
 * Pure apart from load(), which calls the public database function.
 */
import { APP_SUPABASE_URL, APP_SUPABASE_KEY } from '../data/constants.js';

export class ProgrammeBatches {
  /** @type {object[]} */ #list;

  /** @param {object[]} list  batches as pocket_programme_next returns them */
  constructor(list) {
    this.#list = Array.isArray(list) ? list : [];
  }

  /** Reads the batches (no sign-in needed). */
  static async load(fetcher = globalThis.fetch) {
    const res = await fetcher(`${APP_SUPABASE_URL}/rest/v1/rpc/pocket_programme_next`, {
      method: 'POST',
      headers: { apikey: APP_SUPABASE_KEY, Authorization: `Bearer ${APP_SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new ProgrammeBatches(await res.json());
  }

  /** The batch to talk about first: open, then full, then the next to open, then closed or running. */
  get headline() {
    for (const state of ['open', 'full', 'upcoming', 'closed', 'running']) {
      const b = this.#list.find((x) => x.state === state);
      if (b) return b;
    }
    return null;
  }

  /** The next batch that isn't open yet, after `b`. */
  #nextAfter(b) {
    return this.#list.find((x) => x !== b && x.state === 'upcoming') || null;
  }

  /** Whether applying now is for a batch with room (rather than the waitlist). */
  get open() {
    return this.headline?.state === 'open';
  }

  /**
   * The message: { state, title, detail, action }.
   * `action` is the button's words: "Apply now" or "Join the waitlist".
   */
  message() {
    const b = this.headline;
    if (!b) {
      return { state: 'none', title: 'Join the waitlist', detail: 'We\'ll tell you as soon as the next batch opens.', action: 'Join the waitlist' };
    }
    const d = ProgrammeBatches.day;
    const next = this.#nextAfter(b);
    const nextLine = next ? ` Next: ${next.name}, starts ${d(next.startsOn)}${next.opensOn ? ` (applications open ${d(next.opensOn)})` : ''}.` : '';
    switch (b.state) {
      case 'open':
        return {
          state: 'open', title: `${b.name} is open`,
          detail: `Starts ${d(b.startsOn)} · ${b.placesLeft} of ${b.capacity} place${b.capacity === 1 ? '' : 's'} left${b.closesOn ? ` · applications close ${d(b.closesOn)}` : ''}`,
          action: 'Apply now',
        };
      case 'full':
        return { state: 'full', title: `${b.name} is full`, detail: `Join the waitlist for the next batch.${nextLine}`, action: 'Join the waitlist' };
      case 'upcoming':
        return {
          state: 'upcoming', title: `Next batch starts ${d(b.startsOn)}`,
          detail: b.opensOn ? `Applications open ${d(b.opensOn)}. Join the waitlist and we'll tell you first.` : 'Join the waitlist and we\'ll tell you when applications open.',
          action: 'Join the waitlist',
        };
      case 'closed':
        return { state: 'closed', title: `Applications for ${b.name} are closed`, detail: `Join the waitlist for the next batch.${nextLine}`, action: 'Join the waitlist' };
      default:
        return { state: 'running', title: `${b.name} is running now`, detail: `Join the waitlist for the next one.${nextLine}`, action: 'Join the waitlist' };
    }
  }

  /** "1 Dec" (adds the year when it isn't this year). */
  static day(iso, now = new Date()) {
    if (!iso) return 'a date to be set';
    const [y, m, dd] = String(iso).slice(0, 10).split('-').map(Number);
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] || '';
    return y === now.getFullYear() ? `${dd} ${mon}` : `${dd} ${mon} ${y}`;
  }
}
