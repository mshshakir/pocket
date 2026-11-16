/**
 * DriveAuthHandler — the requests the app makes for automatic Google Drive
 * backups. It passes tokens between Google and the person's device and keeps
 * nothing: no database, no logs of tokens, no book data.
 *
 *   POST { action: 'status' }                    → { automatic: boolean }
 *   POST { action: 'exchange', code }            → { accessToken, expiresIn, refreshToken?, scope }
 *   POST { action: 'refresh', refreshToken }     → { accessToken, expiresIn }
 *
 * Errors: { error: code } with 400 (bad request), 401 (Google refused: the
 * permission was withdrawn — connect again), 403 (not from Pocket's site),
 * 502 (Google unreachable), 503 (the secret isn't set).
 *
 * Only pages on the allowed origins may call it (browsers send Origin on
 * every cross-site POST), so another website can't use Pocket's Google client.
 */
import type { GoogleOAuth, TokenAnswer } from './GoogleOAuth.ts';

export class DriveAuthHandler {
  static readonly SCOPE = 'https://www.googleapis.com/auth/drive.file';
  static readonly #MAX_FIELD = 4096;

  readonly #google: GoogleOAuth | null;
  readonly #origins: Set<string>;

  /**
   * @param google   null when the client secret isn't set
   * @param origins  site addresses allowed to call, e.g. https://mshshakir.github.io
   */
  constructor(google: GoogleOAuth | null, origins: string[]) {
    this.#google = google;
    this.#origins = new Set(origins.map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean));
  }

  async handle(req: Request): Promise<Response> {
    const origin = req.headers.get('Origin') ?? '';
    const allowed = this.#allowed(origin);
    if (req.method === 'OPTIONS') return new Response('ok', { status: allowed ? 200 : 403, headers: this.#cors(origin, allowed) });
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {
      status, headers: { ...this.#cors(origin, allowed), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
    if (!allowed) return reply(403, { error: 'origin_not_allowed' });
    if (req.method !== 'POST') return reply(400, { error: 'post_only' });

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch (_) { return reply(400, { error: 'bad_json' }); }
    const action = String(body?.action ?? '');

    if (action === 'status') return reply(200, { automatic: !!this.#google });
    if (!this.#google) return reply(503, { error: 'not_configured' });

    if (action === 'exchange') {
      const code = DriveAuthHandler.#field(body.code);
      if (!code) return reply(400, { error: 'code_needed' });
      const answer = await this.#google.exchange(code);
      if (!answer.ok) return reply(DriveAuthHandler.#statusOf(answer), { error: answer.error });
      if (!String(answer.scope ?? '').split(' ').includes(DriveAuthHandler.SCOPE)) return reply(401, { error: 'scope_denied' });
      return reply(200, { accessToken: answer.accessToken, expiresIn: answer.expiresIn, refreshToken: answer.refreshToken ?? null, scope: answer.scope });
    }

    if (action === 'refresh') {
      const refreshToken = DriveAuthHandler.#field(body.refreshToken);
      if (!refreshToken) return reply(400, { error: 'refresh_token_needed' });
      const answer = await this.#google.refresh(refreshToken);
      if (!answer.ok) return reply(DriveAuthHandler.#statusOf(answer), { error: answer.error });
      return reply(200, { accessToken: answer.accessToken, expiresIn: answer.expiresIn });
    }

    return reply(400, { error: 'unknown_action' });
  }

  /** Google said no (4xx) → 401 so the app asks the person to connect again; anything else → 502. */
  static #statusOf(answer: TokenAnswer): number {
    return answer.status >= 400 && answer.status < 500 ? 401 : 502;
  }

  static #field(value: unknown): string {
    return typeof value === 'string' && value.length <= DriveAuthHandler.#MAX_FIELD ? value.trim() : '';
  }

  #allowed(origin: string): boolean {
    return this.#origins.has(origin.replace(/\/+$/, ''));
  }

  #cors(origin: string, allowed: boolean): Record<string, string> {
    return {
      ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    };
  }
}
