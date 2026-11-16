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
 *
 * Automatic mode (opt-in): authorizeOffline() asks Google, through Pocket's
 * drive-auth function (DriveAuthBroker), for a refresh token. While one is
 * set, token() gets a fresh access token from it with no window and no tap.
 * The caller keeps the refresh token (on the device) and passes it in.
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
  /** @type {import('./DriveAuthBroker.js').DriveAuthBroker|null} */
  #broker;
  /** Set while automatic backups are on: lets token() work without a window. */
  #refreshToken = '';
  /** @type {Promise<void>|null} */
  #loading = null;

  /**
   * @param {object} deps
   * @param {string} deps.clientId  the OAuth client ID (public; empty = not set up)
   * @param {string} deps.scope
   * @param {Window} [deps.win]
   * @param {import('./DriveAuthBroker.js').DriveAuthBroker|null} [deps.broker]  for automatic mode
   */
  constructor({ clientId, scope, win = globalThis, broker = null }) {
    this.#clientId = (clientId || '').trim();
    this.#scope = scope;
    this.#win = win;
    this.#broker = broker;
  }

  /** @param {string} token  the device's refresh token, or '' when automatic backups are off */
  set refreshToken(token) {
    if ((token || '') !== this.#refreshToken) this.forget();
    this.#refreshToken = token || '';
  }

  /** Whether token() can work with nobody there to tap. */
  get unattended() { return !!this.#refreshToken && !!this.#broker; }

  /** Whether the server offers automatic mode. @returns {Promise<boolean>} */
  automaticOffered() {
    return this.configured && this.#broker ? this.#broker.available() : Promise.resolve(false);
  }

  /**
   * Ask Google for lasting permission, for automatic backups. Opens Google's
   * window (call from a tap).
   * @returns {Promise<string>} the refresh token to keep on the device
   */
  async authorizeOffline() {
    if (!this.configured || !this.#broker) throw new GoogleAuthError('not_configured', 'Automatic backups aren\'t available right now.');
    await this.#load();
    const oauth = this.#win.google?.accounts?.oauth2;
    if (!oauth?.initCodeClient) throw new GoogleAuthError('unavailable', 'Could not reach Google. Check your connection and try again.');
    const code = await new Promise((resolve, reject) => {
      oauth.initCodeClient({
        client_id: this.#clientId,
        scope: this.#scope,
        ux_mode: 'popup',
        ...(this.#account ? { login_hint: this.#account } : {}),
        callback: (res) => (res?.code ? resolve(res.code) : reject(GoogleAuthError.from(res))),
        error_callback: (err) => reject(GoogleAuthError.from(err)),
      }).requestCode();
    });
    const answer = await this.#broker.exchange(code);
    if (!answer.refreshToken) {
      throw new GoogleAuthError('no_refresh_token', 'Google didn\'t give lasting permission. Remove Pocket at myaccount.google.com/permissions, then try again.');
    }
    this.#refreshToken = answer.refreshToken;
    this.#keep(answer.accessToken, answer.expiresIn);
    return answer.refreshToken;
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
    if (this.unattended) {
      const fresh = await this.#broker.refresh(this.#refreshToken);
      this.#keep(fresh.accessToken, fresh.expiresIn);
      return this.#token;
    }
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
    this.#keep(answer.access_token, answer.expires_in);
    return this.#token;
  }

  #keep(token, expiresIn) {
    this.#token = token;
    this.#expiresAt = Date.now() + Math.max(0, Number(expiresIn) || 0) * 1000 - GoogleTokenClient.#MARGIN_MS;
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
