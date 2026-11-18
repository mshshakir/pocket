/**
 * AiAssistant — AI on Telegram (owner, 18 Nov 2026):
 *
 *   🎙 a voice note        → entries   (1 credit per 30 seconds, as in the app)
 *   📷 a receipt photo, or a PDF bill sent as a file → entries (5 credits, as a scan in the app)
 *   💬 a typed message the bot couldn't read → entries: 20 a day free, then 1 credit
 *   ❓ a question about your own money → an answer (1 credit), only after the
 *      person agrees, once per chat, to send totals (never entries) to the AI
 *
 * Credits are charged by the database (pocket_ai_charge): unlimited accounts,
 * the family pool when the default account is in a shared space, then the
 * person's own credits. If the AI service fails, the credits are given back;
 * a misheard note is still charged, as in the app.
 *
 * Entries come back as lines in the bot's own format and are recorded by the
 * caller exactly like a typed message.
 */
import { AiModel, AiModelError } from './AiModel.ts';
import { AiPrompts, type AiSource } from './AiPrompts.ts';
import type { TelegramCallback, TelegramMessage } from './BotController.ts';
import type { LocalClock } from './LocalClock.ts';
import type { AiCharge, PocketStore, TelegramLink } from './PocketStore.ts';
import type { TelegramClient } from './TelegramClient.ts';
import type { Workspace } from './Workspace.ts';

/** Records lines in the bot's format, as if the person had typed them. */
export type RecordText = (text: string) => Promise<void>;

/** A file the person sent that the AI can read. */
export interface AiMedia {
  source: 'voice' | 'receipt';
  fileId: string;
  mime: string;
  seconds: number;
  size: number;
}

export class AiAssistant {
  /** Largest file sent to the AI (Gemini's inline limit, with room for the prompt). */
  static readonly MAX_BYTES = 4_500_000;
  static readonly MAX_SECONDS = 600;
  static readonly #BUTTONS = /^aiq:(yes|no)$/;

  readonly #store: PocketStore;
  readonly #telegram: TelegramClient;
  readonly #model: AiModel | null;
  readonly #clock: LocalClock;

  /** @param model null when the server has no Gemini key */
  constructor(store: PocketStore, telegram: TelegramClient, model: AiModel | null, clock: LocalClock) {
    this.#store = store;
    this.#telegram = telegram;
    this.#model = model;
    this.#clock = clock;
  }

  /** The voice note, audio, photo or receipt file in a message, if any. */
  static mediaOf(m: TelegramMessage): AiMedia | null {
    if (m.voice) return { source: 'voice', fileId: m.voice.file_id, mime: m.voice.mime_type || 'audio/ogg', seconds: m.voice.duration ?? 0, size: m.voice.file_size ?? 0 };
    if (m.audio) return { source: 'voice', fileId: m.audio.file_id, mime: m.audio.mime_type || 'audio/mpeg', seconds: m.audio.duration ?? 0, size: m.audio.file_size ?? 0 };
    if (m.photo?.length) {
      // The largest size Telegram made that still fits.
      const fits = m.photo.filter((p) => (p.file_size ?? 0) <= AiAssistant.MAX_BYTES);
      const best = (fits.length ? fits : m.photo)[(fits.length ? fits : m.photo).length - 1];
      return { source: 'receipt', fileId: best.file_id, mime: 'image/jpeg', seconds: 0, size: best.file_size ?? 0 };
    }
    // A receipt sent as a file: a PDF (bills, e-receipts, statements) or a picture
    // sent uncompressed. Some apps send files without a type, so the name counts too.
    const doc = m.document;
    if (doc) {
      const byName: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };
      const ext = (doc.file_name ?? '').toLowerCase().split('.').pop() ?? '';
      const type = (doc.mime_type ?? '').toLowerCase();
      const mime = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(type) ? type : byName[ext];
      if (mime) return { source: 'receipt', fileId: doc.file_id, mime, seconds: 0, size: doc.file_size ?? 0 };
    }
    return null;
  }

  static isButton(data?: string): boolean {
    return AiAssistant.#BUTTONS.test(data ?? '');
  }

  /** A voice note or receipt: charge, read it, record what it says. */
  async handleMedia(link: TelegramLink, chatId: number, message: TelegramMessage, media: AiMedia, ws: Workspace, record: RecordText): Promise<void> {
    const replyTo = message.message_id;
    if (!this.#model) return void await this.#telegram.reply(chatId, 'Voice notes and receipt photos aren\'t set up yet. Please type the entry for now.', replyTo);
    if (media.source === 'voice' && media.seconds > AiAssistant.MAX_SECONDS) {
      return void await this.#telegram.reply(chatId, 'That voice note is too long. Please keep it under 10 minutes.', replyTo);
    }
    if (media.size > AiAssistant.MAX_BYTES) {
      return void await this.#telegram.reply(chatId, 'That file is too large. Try a smaller photo or a shorter voice note.', replyTo);
    }

    const ref = `tg:${chatId}:${replyTo}`;
    const charge = await this.#charge(link, ws, ref, media.source, Math.max(1, media.seconds));
    if (!charge.ok) return void await this.#telegram.reply(chatId, AiAssistant.#noCredits(charge), replyTo);

    let text: string;
    try {
      const bytes = await this.#telegram.download(media.fileId);
      if (!bytes) throw new AiModelError('Telegram didn\'t let me download that file. Please send it again.');
      if (bytes.length > AiAssistant.MAX_BYTES) throw new AiModelError('That file is too large. Try a smaller photo or a shorter voice note.');
      const caption = (message.caption ?? '').trim();
      const prompt = this.#entriesPrompt(media.source, ws, link, caption ? `The person also wrote: "${caption.slice(0, 300)}" — use it for the note, account or category.` : '');
      text = await this.#model.generate([{ inline_data: { mime_type: media.mime, data: AiModel.base64(bytes) } }, { text: prompt }]);
    } catch (e) {
      await this.#store.aiRefund(link.user_id, ref);
      const why = e instanceof AiModelError ? e.message : 'The AI service failed. Please try again.';
      if (!(e instanceof AiModelError)) console.error('[telegram-bot] ai', e);
      return void await this.#telegram.reply(chatId, `⚠️ ${why} You weren't charged.`, replyTo);
    }

    const reading = AiPrompts.readEntries(text);
    const icon = media.source === 'voice' ? '🎙' : '📷';
    if (reading.kind !== 'entries') {
      const heard = reading.heard ? `${icon} ${media.source === 'voice' ? 'Heard' : 'Read'}: “${reading.heard}”\n` : '';
      return void await this.#telegram.reply(chatId,
        `${heard}I couldn't find an amount to record.${media.source === 'voice' ? ' Please speak clearly and say the amount, e.g. "450 for groceries".' : ' Make sure the total is clear in the photo.'}${AiAssistant.#cost(charge)}`, replyTo);
    }
    await this.#telegram.reply(chatId,
      `${icon} ${media.source === 'voice' ? 'Heard' : 'Read'}${reading.heard ? `: “${reading.heard}”` : ''}\nRecording:\n${reading.lines.map((l) => `• ${l}`).join('\n')}${AiAssistant.#cost(charge)}`, replyTo);
    await record(reading.lines.join('\n'));
  }

  /**
   * A typed message with no amount the bot could read. Returns false when the
   * AI isn't set up, so the caller shows its usual message instead.
   */
  async interpret(link: TelegramLink, chatId: number, messageId: number, text: string, ws: Workspace, record: RecordText): Promise<boolean> {
    if (!this.#model) return false;
    const ref = `tgt:${chatId}:${messageId}`;
    const charge = await this.#store.aiText(link.user_id, ref);
    if (!charge.ok) {
      await this.#telegram.reply(chatId,
        'I couldn\'t find an amount. Start with the amount, e.g. 500 lunch @food\n(Today\'s free AI readings are used up and you have no AI credits left. Send /help for all the ways to record.)', messageId);
      return true;
    }
    let answer: string;
    try {
      answer = await this.#model.generate([{ text: `${this.#entriesPrompt('text', ws, link)}\nMESSAGE: ${text.slice(0, 1000)}` }], 600);
    } catch (e) {
      if (!charge.free) await this.#store.aiRefund(link.user_id, ref);
      console.error('[telegram-bot] ai interpret', e);
      return false;
    }
    const reading = AiPrompts.readEntries(answer);
    if (reading.kind === 'question') {
      if (link.ai_questions) await this.answer(link, chatId, messageId, text);
      else await this.#askConsent(chatId, messageId);
      return true;
    }
    if (reading.kind !== 'entries') return false;
    const note = charge.free ? (charge.freeLeft === 0 ? '\n· That was today\'s last free one; after this, 1 AI credit each.' : '') : AiAssistant.#cost(charge);
    await this.#telegram.reply(chatId, `💬 Understood as:\n${reading.lines.map((l) => `• ${l}`).join('\n')}${note}`, messageId);
    await record(reading.lines.join('\n'));
    return true;
  }

  /** Answers a question from the person's own totals (1 credit). */
  async answer(link: TelegramLink, chatId: number, messageId: number, question: string): Promise<void> {
    if (!this.#model) return;
    const ref = `tgq:${chatId}:${messageId}`;
    // Questions are about the person's own book, so their own credits (or unlimited) pay.
    const charge = await this.#store.aiCharge(link.user_id, link.user_id, ref, 'question', 0);
    if (!charge.ok) return void await this.#telegram.reply(chatId, AiAssistant.#noCredits(charge), messageId);
    try {
      const data = await this.#store.insights(link.user_id, this.#clock.isoDate());
      const reply = await this.#model.generate([{ text: AiPrompts.question(question, data) }], 400);
      await this.#telegram.reply(chatId, `${reply.slice(0, 3500)}${AiAssistant.#cost(charge)}`, messageId);
    } catch (e) {
      await this.#store.aiRefund(link.user_id, ref);
      const why = e instanceof AiModelError ? e.message : 'Something went wrong. Please try again.';
      if (!(e instanceof AiModelError)) console.error('[telegram-bot] ai answer', e);
      await this.#telegram.reply(chatId, `⚠️ ${why} You weren't charged.`, messageId);
    }
  }

  /** "Allow" / "Not now" under the consent question. */
  async handleCallback(cb: TelegramCallback, link: TelegramLink): Promise<void> {
    const msg = cb.message!;
    const chatId = msg.chat.id;
    if (cb.data === 'aiq:no') {
      await this.#telegram.answer(cb.id);
      return void await this.#telegram.edit(chatId, msg.message_id, 'OK — questions stay off. You can still record by text, voice note or receipt photo.');
    }
    await this.#store.allowAiQuestions(chatId);
    await this.#telegram.answer(cb.id, 'Allowed');
    await this.#telegram.edit(chatId, msg.message_id, '✅ Questions are on for this chat. Each answer uses 1 AI credit.');
    const question = msg.reply_to_message?.text?.trim();
    if (question) await this.answer({ ...link, ai_questions: true }, chatId, msg.reply_to_message!.message_id, question);
  }

  async #askConsent(chatId: number, messageId: number): Promise<void> {
    await this.#telegram.send(chatId,
      'To answer questions, Pocket sends Google\'s AI your totals from your own book: this month and last month by category, and your budgets. Never single entries, notes or account details. Each answer uses 1 AI credit.\n\nAllow questions in this chat?',
      { replyTo: messageId, keyboard: [[{ text: '✅ Allow', callback_data: 'aiq:yes' }, { text: 'Not now', callback_data: 'aiq:no' }]] });
  }

  #entriesPrompt(source: AiSource, ws: Workspace, link: TelegramLink, extra = ''): string {
    const current = ws.resolve(null, { ownerId: link.default_owner_id, accountId: link.default_account_id });
    const book = current.ok ? current.value.access.book : (ws.accesses[0]?.book ?? null);
    return AiPrompts.entries(source, ws, book, current.ok ? ws.label(current.value) : null, this.#clock.isoDate(), extra);
  }

  /**
   * Charges against the book of the default account, so a family member in a
   * shared space uses the family's pool; falls back to their own credits.
   */
  async #charge(link: TelegramLink, ws: Workspace, ref: string, kind: 'voice' | 'receipt', seconds: number): Promise<AiCharge> {
    const owner = link.default_owner_id && ws.access(link.default_owner_id) ? link.default_owner_id : link.user_id;
    const first = await this.#store.aiCharge(link.user_id, owner, ref, kind, seconds);
    if (first.ok || first.reason !== 'no_access' || owner === link.user_id) return first;
    return await this.#store.aiCharge(link.user_id, link.user_id, ref, kind, seconds);
  }

  static #noCredits(c: AiCharge): string {
    const need = c.cost ?? 1, have = c.remaining ?? 0;
    return have > 0
      ? `This needs ${need} AI credit${need === 1 ? '' : 's'} and you have ${have}. Buy a pack in the Pocket app: Settings → Your plan.`
      : 'You have no AI credits left. Buy a pack in the Pocket app: Settings → Your plan. You can still type entries as usual.';
  }

  /** "· 1 credit, 148 left", or nothing for unlimited accounts. */
  static #cost(c: AiCharge): string {
    if (!c.cost || c.chargedTo === 'unlimited') return '';
    const left = c.remaining != null ? `, ${c.remaining} left${c.chargedTo === 'family' ? ' in the family pool' : ''}` : '';
    return `\n· ${c.cost} AI credit${c.cost === 1 ? '' : 's'}${left}`;
  }
}

