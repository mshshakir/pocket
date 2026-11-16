/**
 * DriveAuthBroker — talks to Pocket's drive-auth server function, which is
 * what makes automatic Google Drive backups possible.
 *
 * Google only hands a long-lived permission (a refresh token) to a server
 * that holds the client secret. The function swaps the code from Google's
 * sign-in window for tokens, and later swaps the refresh token for a fresh
 * access token. It stores nothing; the refresh token lives on this device.
 */
import { GoogleAuthError } from './GoogleTokenClient.js';

export class DriveAuthBroker {
  #url;
  #apiKey;
  #fetch;
  /** @type {Promise<boolean>|null} */
  #offered = null;

  /**
   * @param {object} deps
   * @param {string} deps.url      the function's address (…/functions/v1/drive-auth); empty = none
   * @param {string} [deps.apiKey] the project's publishable key
   * @param {typeof fetch} [deps.fetch]
   */
  constructor({ url, apiKey = '', fetch = (...a) => globalThis.fetch(...a) }) {
    this.#url = url || '';
    this.#apiKey = apiKey;
    this.#fetch = fetch;
  }

  /**
   * Whether the server can do automatic backups (the function is deployed and
   * its secret is set). Asked once per visit; "no" on any failure.
   * @returns {Promise<boolean>}
   */
  available() {
    if (!this.#url) return Promise.resolve(false);
    if (!this.#offered) {
      this.#offered = this.#post({ action: 'status' }).then((r) => r.automatic === true, () => false);
      this.#offered.then((yes) => { if (!yes) this.#offered = null; }); // ask again next time
    }
    return this.#offered;
  }

  /**
   * The code from Google's sign-in window → tokens.
   * @param {string} code
   * @returns {Promise<{accessToken: string, expiresIn: number, refreshToken: string|null}>}
   */
  exchange(code) {
    return this.#post({ action: 'exchange', code });
  }

  /**
   * A refresh token → a fresh access token.
   * @param {string} refreshToken
   * @returns {Promise<{accessToken: string, expiresIn: number}>}
   */
  refresh(refreshToken) {
    return this.#post({ action: 'refresh', refreshToken });
  }

  async #post(body) {
    let res;
    try {
      res = await this.#fetch(this.#url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.#apiKey ? { apikey: this.#apiKey } : {}) },
        body: JSON.stringify(body),
      });
    } catch (_) {
      throw new GoogleAuthError('unavailable', 'Could not reach Pocket\'s server. Check your connection and try again.');
    }
    let json = {};
    try { json = await res.json(); } catch (_) { /* no details */ }
    if (res.ok) return json;
    if (res.status === 401 && json.error === 'scope_denied') {
      throw new GoogleAuthError('scope_denied', 'Pocket needs permission to save files to your Google Drive. Please tick that box and try again.');
    }
    if (res.status === 401) {
      throw new GoogleAuthError('reconnect', 'Google no longer allows automatic backups for this device. Turn them on again in Settings.');
    }
    throw new GoogleAuthError('unavailable', 'Automatic backups aren\'t available right now. Please try again later.');
  }
}
