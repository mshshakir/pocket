/**
 * GoogleOAuth — the two calls to Google that need Pocket's client secret:
 * swapping the code from Google's sign-in window for tokens, and getting a
 * fresh access token from a refresh token.
 */
export type TokenAnswer = {
  ok: boolean;
  /** Google's HTTP status, for telling "refused" (4xx) from "Google is down" (5xx). */
  status: number;
  accessToken?: string;
  expiresIn?: number;
  refreshToken?: string;
  scope?: string;
  /** Google's error code, e.g. invalid_grant (the permission was withdrawn or expired). */
  error?: string;
};

export class GoogleOAuth {
  static readonly #ENDPOINT = 'https://oauth2.googleapis.com/token';

  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #fetch: typeof fetch;

  constructor(clientId: string, clientSecret: string, fetcher: typeof fetch = fetch) {
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#fetch = fetcher;
  }

  /** The code from Google's pop-up sign-in window → tokens. */
  exchange(code: string): Promise<TokenAnswer> {
    return this.#ask({ grant_type: 'authorization_code', code, redirect_uri: 'postmessage' });
  }

  /** A refresh token → a new access token. */
  refresh(refreshToken: string): Promise<TokenAnswer> {
    return this.#ask({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async #ask(fields: Record<string, string>): Promise<TokenAnswer> {
    let res: Response;
    try {
      res = await this.#fetch(GoogleOAuth.#ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...fields, client_id: this.#clientId, client_secret: this.#clientSecret }),
      });
    } catch (_) {
      return { ok: false, status: 502, error: 'unreachable' };
    }
    let json: Record<string, unknown> = {};
    try { json = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok || typeof json.access_token !== 'string') {
      return { ok: false, status: res.status || 502, error: String(json.error ?? 'failed') };
    }
    return {
      ok: true,
      status: 200,
      accessToken: json.access_token,
      expiresIn: Number(json.expires_in) || 0,
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
      scope: typeof json.scope === 'string' ? json.scope : undefined,
    };
  }
}
