/**
 * AiHandler — one AI request from the app, start to finish:
 *   who is asking (their sign-in) → is the request acceptable → charge one
 *   credit (or unlimited / the family pool) → ask Gemini → refund if Gemini
 *   failed → answer.
 *
 * Answers are JSON: { text, chargedTo, remaining? } or { error, code } where
 * code is one of: signed_out, bad_request, no_credits, no_access, not_set_up,
 * ai_failed.
 */
import { AiRequest, AiRequestError } from './AiRequest.ts';
import type { AiCredits } from './AiCredits.ts';
import { GeminiError, type GeminiClient } from './GeminiClient.ts';

export type UserLookup = (authorization: string) => Promise<string | null>;

export class AiHandler {
  static readonly #CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  readonly #userOf: UserLookup;
  readonly #credits: AiCredits;
  readonly #gemini: GeminiClient | null;

  /** @param gemini null when the server has no Gemini key yet */
  constructor(userOf: UserLookup, credits: AiCredits, gemini: GeminiClient | null) {
    this.#userOf = userOf;
    this.#credits = credits;
    this.#gemini = gemini;
  }

  async handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: AiHandler.#CORS });
    if (req.method !== 'POST') return this.#fail(405, 'bad_request', 'Use POST.');

    const userId = await this.#userOf(req.headers.get('Authorization') ?? '');
    if (!userId) return this.#fail(401, 'signed_out', 'Please sign in to use AI scanning and voice entry.');

    let request: AiRequest;
    try {
      request = AiRequest.parse(await req.json());
    } catch (e) {
      return this.#fail(400, 'bad_request', e instanceof AiRequestError ? e.message : 'Unreadable request.');
    }

    if (!this.#gemini) return this.#fail(503, 'not_set_up', 'AI scanning isn\'t set up yet. Please try again later.');

    const charge = await this.#credits.spend(userId, request.book, request.ref);
    if (!charge.ok) {
      return charge.reason === 'no_access'
        ? this.#fail(403, 'no_access', 'You can\'t add entries to that shared space.')
        : this.#fail(402, 'no_credits', 'You have no AI credits left. Buy a pack in Settings → Your plan.');
    }

    try {
      const text = await this.#gemini.generate(request);
      return this.#json(200, { text, chargedTo: charge.chargedTo, remaining: charge.remaining ?? null });
    } catch (e) {
      await this.#credits.refund(userId, request.ref);
      const message = e instanceof GeminiError ? e.message : 'The AI service failed. Please try again.';
      if (!(e instanceof GeminiError)) console.error('[ai]', e);
      return this.#fail(502, 'ai_failed', `${message} You weren't charged.`);
    }
  }

  #fail(status: number, code: string, error: string): Response {
    return this.#json(status, { error, code });
  }

  #json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...AiHandler.#CORS, 'Content-Type': 'application/json' },
    });
  }
}
