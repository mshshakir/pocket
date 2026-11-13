/**
 * LinkService — lets anyone connect their own Telegram chat to their own
 * Pocket account, with no one in between:
 *
 *   /link name@example.com  → Supabase emails that address the same 6-digit
 *                             sign-in code the Pocket app uses
 *   123456                  → the bot checks the code with Supabase and ties
 *                             this chat to the account it proves
 *
 * Only someone who can read that inbox can finish. No accounts are created,
 * and the replies never reveal whether an email has an account. The auth
 * calls run on their own client with the public (anon) key, like the app, so
 * a verified session can never leak into the bot's privileged client.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { LinkRequest, PocketStore } from './PocketStore.ts';
import type { TelegramClient } from './TelegramClient.ts';

export class LinkService {
  static readonly #EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  static readonly #CODE = /^\d{6,10}$/;
  static readonly #MAX_ATTEMPTS = 5;
  static readonly #RESEND_WAIT_MS = 60 * 1000;
  static readonly #CODE_TTL_MS = 60 * 60 * 1000; // Supabase codes last an hour

  readonly #store: PocketStore;
  readonly #telegram: TelegramClient;
  readonly #auth: SupabaseClient;

  constructor(store: PocketStore, telegram: TelegramClient, auth: SupabaseClient) {
    this.#store = store;
    this.#telegram = telegram;
    this.#auth = auth;
  }

  /** Whether a message looks like a sign-in code. */
  static isCode(text: string): boolean {
    return LinkService.#CODE.test(text.trim());
  }

  /** /link <email>: email a sign-in code to that address. */
  async start(chatId: number, rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    if (!LinkService.#EMAIL.test(email)) {
      return void await this.#telegram.reply(chatId, 'Send /link followed by the email you use for Pocket, e.g.\n/link name@gmail.com');
    }
    const previous = await this.#store.getLinkRequest(chatId);
    if (previous && Date.now() - Date.parse(previous.created_at) < LinkService.#RESEND_WAIT_MS) {
      return void await this.#telegram.reply(chatId, 'A code was just sent. Please wait a minute before asking for another.');
    }

    const { error } = await this.#auth.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    const msg = (error?.message || '').toLowerCase();
    if (error && (msg.includes('rate limit') || error.status === 429)) {
      return void await this.#telegram.reply(chatId,
        'Too many sign-in emails right now (Supabase sends at most 2 per hour for the whole app). Please try again in an hour.');
    }
    if (error && !msg.includes('signups not allowed') && !msg.includes('not found')) {
      console.error('[telegram-bot] signInWithOtp', error);
      return void await this.#telegram.reply(chatId, 'Couldn\'t send a code just now. Please try again later.');
    }
    // Same reply whether or not the email has an account, so nobody can probe for accounts.
    await this.#store.saveLinkRequest(chatId, email);
    await this.#telegram.reply(chatId,
      `If ${email} has a Pocket account, a sign-in code is on its way.\nSend the code here to connect this chat.`);
  }

  /** A code arrived for this chat's pending /link. */
  async verify(chatId: number, request: LinkRequest, code: string): Promise<void> {
    if (Date.now() - Date.parse(request.created_at) > LinkService.#CODE_TTL_MS) {
      await this.#store.deleteLinkRequest(chatId);
      return void await this.#telegram.reply(chatId, 'That code has expired. Send /link again for a new one.');
    }
    const { data, error } = await this.#auth.auth.verifyOtp({ email: request.email, token: code.trim(), type: 'email' });
    if (error || !data?.user?.id || (data.user.email || '').toLowerCase() !== request.email) {
      const attempts = request.attempts + 1;
      if (attempts >= LinkService.#MAX_ATTEMPTS) {
        await this.#store.deleteLinkRequest(chatId);
        return void await this.#telegram.reply(chatId, 'Too many wrong codes. Send /link again to start over.');
      }
      await this.#store.countLinkAttempt(chatId, attempts);
      return void await this.#telegram.reply(chatId, `That code didn't work. Check the latest email and try again (${LinkService.#MAX_ATTEMPTS - attempts} tries left).`);
    }

    await this.#store.saveLink(chatId, data.user.id, request.email);
    await this.#store.deleteLinkRequest(chatId);
    await this.#auth.auth.signOut().catch(() => {}); // the bot needs no session; end the one the code created
    await this.#telegram.reply(chatId,
      `✅ Connected to ${request.email}.\nYou can now log to your own accounts and any shared with you.\nSend /accounts to see them, or /help for how to record.`);
  }

  /** /unlink: disconnect this chat. */
  async unlink(chatId: number): Promise<void> {
    const had = await this.#store.removeLink(chatId);
    await this.#store.deleteLinkRequest(chatId);
    await this.#telegram.reply(chatId, had
      ? 'Disconnected. This chat can no longer add entries. Send /link to connect again.'
      : 'This chat isn\'t connected.');
  }
}
