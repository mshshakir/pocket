/**
 * AiRequest — one receipt scan or voice entry sent by the app, checked before
 * anything is charged or sent to Gemini.
 *
 * The app builds the prompt (it knows the person's categories); the server
 * fixes everything that costs money: the model, the output length, and a size
 * limit on what is sent. Only a picture, a PDF or a recording plus text parts
 * are accepted.
 */
export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export class AiRequestError extends Error {}

export class AiRequest {
  /** Largest upload accepted (base64 characters ≈ 4.5 MB of image/audio). */
  static readonly MAX_INLINE_CHARS = 6_000_000;
  static readonly MAX_TEXT_CHARS = 20_000;
  static readonly MAX_SETUP_CHARS = 8_000;
  static readonly MAX_OUTPUT_TOKENS = 1024;
  /** Longest recording billed for; also the most a voice entry can be said to last. */
  static readonly MAX_SECONDS = 600;
  /**
   * A recording can't be shorter than its size allows: no browser records
   * speech above about 128 kbit/s (16,000 bytes a second). Stops an app that
   * under-reports the length to pay less.
   */
  static readonly #MAX_BYTES_PER_SECOND = 16_000;
  static readonly #UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  static readonly #MEDIA = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf|audio\/(webm|ogg|mp4|mpeg|mp3|wav|aac|m4a|x-m4a|3gpp))(;.*)?$/i;

  private constructor(
    readonly kind: 'receipt' | 'voice' | 'setup',
    readonly book: string,
    readonly ref: string,
    readonly parts: Part[],
    readonly maxOutputTokens: number,
    /** Length of the recording in seconds (voice only; 0 for a scan). Voice is charged by this. */
    readonly seconds: number,
  ) {}

  /** @throws AiRequestError with a sentence for the person */
  static parse(body: unknown): AiRequest {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    // 'setup': suggesting categories while a new person sets up their book —
    // text only, no picture or recording.
    const kind = b.kind === 'voice' ? 'voice' : b.kind === 'receipt' ? 'receipt' : b.kind === 'setup' ? 'setup' : null;
    if (!kind) throw new AiRequestError('Unknown request.');
    if (typeof b.book !== 'string' || !AiRequest.#UUID.test(b.book)) throw new AiRequestError('Unknown book.');
    if (typeof b.ref !== 'string' || b.ref.length < 8 || b.ref.length > 80) throw new AiRequestError('Missing request id.');
    if (!Array.isArray(b.parts) || !b.parts.length || b.parts.length > 4) throw new AiRequestError('Nothing to read.');

    let inline = 0, text = 0, media = 0;
    const parts: Part[] = b.parts.map((p) => {
      const part = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
      if (typeof part.text === 'string') {
        text += part.text.length;
        return { text: part.text };
      }
      const d = part.inline_data as Record<string, unknown> | undefined;
      if (d && typeof d.mime_type === 'string' && typeof d.data === 'string' && AiRequest.#MEDIA.test(d.mime_type)) {
        inline += d.data.length;
        media++;
        return { inline_data: { mime_type: d.mime_type, data: d.data } };
      }
      throw new AiRequestError('That file type can\'t be read.');
    });
    if (kind === 'setup' ? media !== 0 : media !== 1) throw new AiRequestError(kind === 'setup' ? 'Nothing to read.' : 'Send one picture or recording at a time.');
    if (kind === 'setup' && text > AiRequest.MAX_SETUP_CHARS) throw new AiRequestError('Request too long.');
    if (inline > AiRequest.MAX_INLINE_CHARS) throw new AiRequestError('That file is too large. Try a smaller photo or a shorter recording.');
    if (text > AiRequest.MAX_TEXT_CHARS) throw new AiRequestError('Request too long.');

    const out = Number(b.maxOutputTokens);
    const cap = kind === 'setup' ? 600 : AiRequest.MAX_OUTPUT_TOKENS;
    const max = Number.isInteger(out) && out > 0 ? Math.min(out, cap) : cap;
    return new AiRequest(kind, b.book, b.ref, parts, max, kind === 'voice' ? AiRequest.#seconds(b.seconds, inline) : 0);
  }

  /** The recording's length: what the app measured, but never less than its size makes possible. */
  static #seconds(reported: unknown, base64Chars: number): number {
    const said = Number(reported);
    const atLeast = Math.ceil((base64Chars * 3 / 4) / AiRequest.#MAX_BYTES_PER_SECOND);
    const secs = Math.max(Number.isFinite(said) && said > 0 ? said : 1, atLeast, 1);
    return Math.min(Math.ceil(secs), AiRequest.MAX_SECONDS);
  }
}
