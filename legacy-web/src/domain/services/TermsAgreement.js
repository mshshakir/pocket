/**
 * TermsAgreement — agreeing to Pocket's Terms and Privacy Policy (migration 0061).
 *
 * The sign-in window says "By continuing, you agree…". Tapping Continue with
 * Google remembers that on this device (it has to survive Google's sign-in
 * round trip); once signed in, the agreement is recorded on the server as
 * 'sign_in'. Someone signed in without that (an earlier account, or a new
 * version of the Terms) is asked once in the app ('prompt').
 */
export class TermsAgreement {
  static #FLAG = 'pocket.termsAgreed';
  /** How long a "Continue with Google" tap counts for (the sign-in round trip). */
  static #FLAG_MS = 30 * 60 * 1000;

  #rpc;
  #storage;

  /**
   * @param {() => (((fn: string, args?: object) => Promise<{data: any, error: any}>)|null)} rpc  the signed-in person's rpc, or null
   * @param {Storage|null} storage  sessionStorage
   */
  constructor(rpc, storage) {
    this.#rpc = rpc;
    this.#storage = storage;
  }

  /** "Continue with Google" was tapped under the "By continuing, you agree" line. */
  agreedAtSignIn(now = Date.now()) {
    try { this.#storage?.setItem(TermsAgreement.#FLAG, String(now)); } catch (_) { /* private mode */ }
  }

  /**
   * After sign-in: records an agreement made on the sign-in window, or says
   * the person needs to be asked.
   * @returns {Promise<{status: 'ok'|'ask'|'unknown', version?: string}>}
   */
  async check(now = Date.now()) {
    const call = this.#rpc();
    if (!call) return { status: 'unknown' };
    const { data, error } = await call('pocket_terms_state').catch(() => ({ data: null, error: true }));
    if (error || !data?.version) return { status: 'unknown' };
    if (data.accepted) { this.#clearFlag(); return { status: 'ok', version: data.version }; }
    if (this.#flagFresh(now)) {
      const r = await this.accept(data.version, 'sign_in').catch(() => null);
      if (r) return { status: 'ok', version: data.version };
    }
    return { status: 'ask', version: data.version };
  }

  /** Records agreement to `version`. @throws {Error} with a message to show */
  async accept(version, via = 'prompt') {
    const call = this.#rpc();
    if (!call) throw new Error('Please sign in first.');
    const { data, error } = await call('pocket_terms_accept', { p_version: version, p_via: via });
    if (error) throw new Error(error.code === 'PG001' && error.message ? error.message : 'Pocket couldn\'t save that. Please try again.');
    this.#clearFlag();
    return data;
  }

  #flagFresh(now) {
    let at = null;
    try { at = Number(this.#storage?.getItem(TermsAgreement.#FLAG)); } catch (_) { return false; }
    return Number.isFinite(at) && at > 0 && now - at < TermsAgreement.#FLAG_MS;
  }

  #clearFlag() {
    try { this.#storage?.removeItem(TermsAgreement.#FLAG); } catch (_) { /* ignore */ }
  }
}
