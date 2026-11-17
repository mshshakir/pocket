/**
 * AccountClosure — deleting your own Pocket account (migrations 0055, 0056).
 *
 * Asking schedules the deletion for 7 days later; until then "Keep my
 * account" cancels it. On the day, the server deletes the sign-in, the cloud
 * book, Telegram links, plan and AI credits (payment records are kept).
 *
 * The book on this device isn't touched when asking. A note is kept on the
 * device (pocket.v1.closing) so that, once the account is gone, the next
 * start empties this device too — but only if the server can no longer find
 * the account, so a change of mind on another device never wipes this one.
 */
export class AccountClosure {
  static KEY = 'pocket.v1.closing';

  #rpc;
  #storage;

  /**
   * @param {() => (((fn: string, args?: object) => Promise<{data: any, error: any}>)|null)} rpc
   *   the signed-in person's database calls, or null when signed out
   * @param {Storage} storage
   */
  constructor(rpc, storage) {
    this.#rpc = rpc;
    this.#storage = storage;
  }

  /** {pending: boolean, deleteAfter: Date|null}; null when it can't be asked (signed out, offline). */
  async state() {
    return this.#call('pocket_account_deletion').catch(() => null);
  }

  /** Schedules the deletion; remembers it on this device for `owner`. */
  async request(owner) {
    const s = await this.#call('pocket_account_delete_request');
    if (s.pending && s.deleteAfter) this.#remember(owner, s.deleteAfter);
    return s;
  }

  /** Keeps the account. */
  async cancel() {
    const s = await this.#call('pocket_account_delete_cancel');
    this.forget();
    return s;
  }

  /** The note on this device: {owner, at: Date}, or null. */
  get note() {
    try {
      const raw = JSON.parse(this.#storage.getItem(AccountClosure.KEY) || 'null');
      return raw && typeof raw.owner === 'string' && !Number.isNaN(Date.parse(raw.at)) ? { owner: raw.owner, at: new Date(raw.at) } : null;
    } catch { return null; }
  }

  forget() {
    try { this.#storage.removeItem(AccountClosure.KEY); } catch { /* blocked storage */ }
  }

  /**
   * What to do with this device at start: 'wipe' (the account's date has
   * passed and nobody is signed in to it any more), 'keep' (the note is stale:
   * the deletion was cancelled), or 'wait'.
   * @param {string|null} storedOwner  the account the book on this device belongs to
   * @param {boolean} signedIn
   * @param {{pending: boolean}|null} serverState  pocket_account_deletion(), when signed in
   */
  decide(storedOwner, signedIn, serverState, now = new Date()) {
    const n = this.note;
    if (!n) return 'wait';
    if (storedOwner && n.owner !== storedOwner) return 'keep';
    if (signedIn) return serverState && serverState.pending === false ? 'keep' : 'wait';
    return n.at <= now ? 'wipe' : 'wait';
  }

  #remember(owner, at) {
    try { this.#storage.setItem(AccountClosure.KEY, JSON.stringify({ owner, at })); } catch { /* blocked storage */ }
  }

  async #call(fn) {
    const rpc = this.#rpc();
    if (!rpc) throw new Error('Sign in first.');
    const { data, error } = await rpc(fn);
    if (error) throw new Error('Pocket couldn\'t reach the server. Please try again.');
    return { pending: data?.pending === true, deleteAfter: data?.deleteAfter ? new Date(data.deleteAfter) : null };
  }
}
