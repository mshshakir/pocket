/**
 * AiGateway — sends one AI request (receipt scan or voice entry) to Pocket's
 * `ai` server function, which charges one AI credit by the plan rules
 * (unlimited, the Family pool in a shared space, or the person's own credits),
 * asks Gemini with Pocket's key, and refunds when Gemini fails.
 *
 * The prompt is built by the caller (ReceiptScanService); the gateway only
 * carries it, with a fresh request id so a retried request is charged once.
 */
export class AiError extends Error {
  /**
   * @param {string} message  a sentence for the person
   * @param {'signed_out'|'no_credits'|'no_access'|'not_set_up'|'ai_failed'|'bad_request'|'network'} code
   */
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export class AiGateway {
  /** @type {() => (((name: string, opts: object) => Promise<{data: any, error: any}>)|null)} */
  #invoker;

  /**
   * @param {() => (((name: string, opts: object) => Promise<{data: any, error: any}>)|null)} invoker
   *   gives supabase.functions.invoke for the signed-in person, or null when signed out
   *   (asked at each request, so the gateway follows sign-in and sign-out)
   */
  constructor(invoker) {
    this.#invoker = invoker;
  }

  /**
   * @param {{kind: 'receipt'|'voice', book: string, parts: object[], maxOutputTokens?: number}} request
   * @returns {Promise<string>} the model's text answer
   * @throws {AiError}
   */
  async generate({ kind, book, parts, maxOutputTokens = 1024 }) {
    const invoke = this.#invoker();
    if (!invoke || !book) throw new AiError('Please sign in to use AI scanning and voice entry.', 'signed_out');
    let result;
    try {
      result = await invoke('ai', { body: { kind, book, ref: AiGateway.#ref(), parts, maxOutputTokens } });
    } catch (_) {
      throw new AiError('Network error — check your connection and try again.', 'network');
    }
    const { data, error } = result ?? {};
    if (error) throw await AiGateway.#explain(error);
    if (typeof data?.text !== 'string') throw new AiError('The AI returned nothing. Please try again.', 'ai_failed');
    return data.text;
  }

  /** A function error carries the server's JSON answer in its response. */
  static async #explain(error) {
    try {
      const body = await error.context?.json?.();
      if (body?.error) return new AiError(body.error, body.code || 'ai_failed');
    } catch (_) { /* not JSON */ }
    return new AiError(error.message || 'The AI request failed. Please try again.', 'ai_failed');
  }

  static #ref() {
    return globalThis.crypto?.randomUUID?.()
      ?? `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}
