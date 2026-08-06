/**
 * AccountRef — an account id plus the book it lives in.
 *
 * Most of the app only needs an account id, because every account belongs to
 * the signed-in user. Once shared accounts enter a form (regular purchases,
 * contributions) an id alone is ambiguous: it may belong to the local book or
 * to a family member's. A plain <select> can only carry a string, so this class
 * owns the one encoding both sides agree on:
 *
 *   local   → "acc_123"
 *   shared  → "shared:<ownerId>:acc_123"
 *
 * Owner ids are Supabase UUIDs and account ids are `acc_…`, so neither contains
 * a colon and the split is unambiguous.
 */
export class AccountRef {
  /** @type {string} */      #accountId;
  /** @type {string|null} */ #ownerId;

  /**
   * @param {string} accountId
   * @param {string|null} [ownerId=null]  null → the local book
   */
  constructor(accountId, ownerId = null) {
    this.#accountId = accountId || '';
    this.#ownerId   = ownerId || null;
  }

  get accountId() { return this.#accountId; }
  get ownerId()   { return this.#ownerId; }
  get isShared()  { return !!this.#ownerId && !!this.#accountId; }

  /** The string a <select> / hidden input carries. @returns {string} */
  toValue() {
    if (!this.#accountId) return '';
    return this.#ownerId ? `shared:${this.#ownerId}:${this.#accountId}` : this.#accountId;
  }

  /**
   * Parse a form value back into a ref. Anything that isn't the shared form is
   * treated as a plain local account id, so existing saved values keep working.
   * @param {string} value
   * @returns {AccountRef}
   */
  static parse(value) {
    const raw = (value ?? '').toString();
    if (!raw.startsWith('shared:')) return new AccountRef(raw, null);
    const rest  = raw.slice('shared:'.length);
    const sep   = rest.indexOf(':');
    if (sep < 0) return new AccountRef(rest, null);
    return new AccountRef(rest.slice(sep + 1), rest.slice(0, sep));
  }

  /**
   * Build a ref from a stored record that carries `accountId` + `sharedOwnerId`
   * (regular items, and anything else that persists the pair).
   * @param {{accountId?:string, sharedOwnerId?:string|null}} record
   * @returns {AccountRef}
   */
  static fromRecord(record) {
    return new AccountRef(record?.accountId || '', record?.sharedOwnerId || null);
  }
}
