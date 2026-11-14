/**
 * GeminiClient — sends one request to Gemini with the server's key.
 * The key never leaves the server; the model is fixed here, not by the app.
 */
import type { AiRequest } from './AiRequest.ts';

export class GeminiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class GeminiClient {
  // gemini-2.0-flash(-lite) were shut down in June 2026; 2.5-flash-lite is the
  // lowest-cost current model that reads images and audio.
  static readonly MODEL = 'gemini-2.5-flash-lite';
  static readonly #ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GeminiClient.MODEL}:generateContent`;

  readonly #key: string;
  readonly #fetch: typeof fetch;

  constructor(key: string, fetcher: typeof fetch = fetch) {
    this.#key = key;
    this.#fetch = fetcher;
  }

  /** The model's text answer. @throws GeminiError */
  async generate(req: AiRequest): Promise<string> {
    let res: Response;
    try {
      res = await this.#fetch(GeminiClient.#ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.#key },
        body: JSON.stringify({
          contents: [{ parts: req.parts }],
          generationConfig: { temperature: 0.1, maxOutputTokens: req.maxOutputTokens },
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (_) {
      throw new GeminiError('The AI service could not be reached. Please try again.', 503);
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error?.message ?? ''; } catch (_) { /* not JSON */ }
      console.error('[ai] Gemini', res.status, detail);
      // 429 is Google's quota for Pocket's key (per minute, per day, or none on the
      // free tier) — not something the person can fix, so don't call it "busy".
      throw new GeminiError(res.status === 429 ? 'AI scanning has reached its limit for now. Please try again later.'
        : 'The AI service could not read that. Please try again.', res.status);
    }
    const body = await res.json();
    const text = String(body?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    if (!text) throw new GeminiError('The AI returned nothing. Please try again.', 502);
    return text;
  }
}
