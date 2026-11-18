/**
 * AiModel — one request to Gemini with the server's key (GEMINI_API_KEY, the
 * same key the app's `ai` function uses). The model and output length are
 * fixed here. Throws AiModelError with a sentence for the person.
 */
export type AiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

export class AiModelError extends Error {}

export class AiModel {
  // The lowest-cost current model that reads images and audio (as in functions/ai).
  static readonly MODEL = 'gemini-2.5-flash-lite';
  static readonly #ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${AiModel.MODEL}:generateContent`;

  readonly #key: string;
  readonly #fetch: typeof fetch;

  constructor(key: string, fetcher: typeof fetch = fetch) {
    this.#key = key;
    this.#fetch = fetcher;
  }

  /** The model's text answer. @throws AiModelError */
  async generate(parts: AiPart[], maxOutputTokens = 1024): Promise<string> {
    let res: Response;
    try {
      res = await this.#fetch(AiModel.#ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.#key },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.1, maxOutputTokens },
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (_) {
      throw new AiModelError('The AI service could not be reached. Please try again.');
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error?.message ?? ''; } catch (_) { /* not JSON */ }
      console.error('[telegram-bot] Gemini', res.status, detail);
      throw new AiModelError(res.status === 429 ? 'AI has reached its limit for now. Please try again later.'
        : 'The AI service could not read that. Please try again.');
    }
    const body = await res.json();
    const text = String(body?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    if (!text) throw new AiModelError('The AI returned nothing. Please try again.');
    return text;
  }

  /** Bytes as base64, in chunks so a large photo doesn't overflow the call stack. */
  static base64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }
}
