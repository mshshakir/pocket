/**
 * GoogleTokenClient — permission to use one Google API from the browser.
 *
 * Uses Google Identity Services' token flow: the person approves once in a
 * Google window, and Google hands this page a short-lived access token (about
 * an hour). Nothing is sent to Pocket's server and no password or long-lived
 * key is ever stored — only the token, in memory, until the page closes.
 *
 * Because Google shows a window, token() must be called from a tap (a button
 * handler). Once approved, later windows close by themselves in a moment.
 */
export class GoogleTokenClient {
  static #SCRIPT = 'https://accounts.google.com/gsi/client';
  /** Treat a token as used up this long before Google does. */
  static #MARGIN_MS = 60_000;

  #clientId;
  #scope;
  #win;
  #token = null;
  #expiresAt = 0;
  /** The Google account to pre-select in Google's window (an email). */
  #account = '';
  /** @type {Promise<void>|null} */
  #loading = null;

  /**
   * @param {object} deps
   * @param {string} deps.clientId  the OAuth client ID (public; empty = not set up)
   * @param {string} deps.scope
   * @param {Window} [deps.win]
   */
  constructor({ clientId, scope, win = globalThis }) {
    this.#clientId = (clientId || '').trim();
    this.#scope = scope;
    this.#win = win;
  }

  /** Whether a client ID has been set, i.e. the feature can be offered. */
  get configured() { return !!this.#clientId; }

  /** Whether a token is in hand, so the next call needs no Google window. */
  get ready() { return !!this.#token && Date.now() < this.#expiresAt; }

  /** @param {string} email  the Google account to pre-select next time */
  set account(email) { this.#account = email || ''; }

  /**
   * An access token; opens Google's window when none is in hand.
   * @returns {Promise<string>}
   */
  async token() {
    const hint = this.#account;
    if (this.ready) return this.#token;
    if (!this.configured) throw new GoogleAuthError('not_configured', 'Google Drive backup is not set up yet');
    await this.#load();
    const oauth = this.#win.google?.accounts?.oauth2;
    if (!oauth) throw new GoogleAuthError('unavailable', 'Could not reach Google. Check your connection and try again.');
    const answer = await new Promise((resolve, reject) => {
      const client = oauth.initTokenClient({
        client_id: this.#clientId,
        scope: this.#scope,
        prompt: '',
        ...(hint ? { hint } : {}),
        callback: (res) => (res?.access_token ? resolve(res) : reject(GoogleAuthError.from(res))),
        error_callback: (err) => reject(GoogleAuthError.from(err)),
      });
      client.requestAccessToken();
    });
    if (!String(answer.scope || this.#scope).split(' ').includes(this.#scope)) {
      throw new GoogleAuthError('scope_denied', 'Pocket needs permission to save files to your Google Drive. Please tick that box and try again.');
    }
    this.#token = answer.access_token;
    this.#expiresAt = Date.now() + Math.max(0, Number(answer.expires_in) || 0) * 1000 - GoogleTokenClient.#MARGIN_MS;
    return this.#token;
  }

  /**
   * Fetch Google's sign-in library ahead of the tap that will need it, so its
   * window opens at once (browsers only allow a new window right after a tap).
   */
  warm() {
    if (this.configured) this.#load().catch(() => null);
  }

  /** Drop the token in hand (e.g. Google said it's no longer valid). */
  forget() {
    this.#token = null;
    this.#expiresAt = 0;
  }

  /** Withdraw the permission at Google, as far as this token allows, and forget it. */
  async revoke() {
    const token = this.#token;
    this.forget();
    if (!token) return;
    await new Promise((resolve) => {
      try { this.#win.google?.accounts?.oauth2?.revoke?.(token, () => resolve()); } catch (_) { /* best effort */ }
      setTimeout(resolve, 1500);
    });
  }

  #load() {
    if (this.#win.google?.accounts?.oauth2) return Promise.resolve();
    if (!this.#loading) {
      this.#loading = new Promise((resolve, reject) => {
        const doc = this.#win.document;
        const el = doc.createElement('script');
        el.src = GoogleTokenClient.#SCRIPT;
        el.async = true;
        el.onload = () => resolve();
        el.onerror = () => {
          this.#loading = null;
          reject(new GoogleAuthError('unavailable', 'Could not reach Google. Check your connection and try again.'));
        };
        doc.head.appendChild(el);
      });
    }
    return this.#loading;
  }
}

/** Why Google gave no token; `code` is stable, `message` is for the person. */
export class GoogleAuthError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'GoogleAuthError';
    this.code = code;
  }

  /** @param {{type?: string, error?: string}|undefined} raw  what Google's library reported */
  static from(raw) {
    const type = raw?.type || raw?.error || 'unknown';
    if (type === 'popup_closed' || type === 'access_denied') {
      return new GoogleAuthError('cancelled', 'Google sign-in was closed before it finished.');
    }
    if (type === 'popup_failed_to_open') {
      return new GoogleAuthError('blocked', 'Your browser blocked the Google window. Allow pop-ups for Pocket and try again.');
    }
    return new GoogleAuthError(type, 'Google sign-in did not finish. Please try again.');
  }
}
