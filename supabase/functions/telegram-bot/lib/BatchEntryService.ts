/**
 * BatchEntryService — records a message with several lines, one entry per
 * line (see EntryBatch for the format).
 *
 * Every line that is complete is saved straight away, each with its own
 * confirmation and ✏️ Edit / 🗑 Delete buttons. Lines that still need a
 * category are then asked about one at a time, in order; a shared category
 * that needs choosing (e.g. @food, a main category) is asked once and used
 * for every line that relies on it.
 */
import { EntryBatch } from './EntryBatch.ts';
import { EntryService } from './EntryService.ts';
import type { PocketStore, QueuedEntry, TelegramLink } from './PocketStore.ts';
import type { TelegramClient } from './TelegramClient.ts';
import { Workspace } from './Workspace.ts';

export class BatchEntryService {
  readonly #store: PocketStore;
  readonly #telegram: TelegramClient;
  readonly #entries: EntryService;

  constructor(store: PocketStore, telegram: TelegramClient, entries: EntryService) {
    this.#store = store;
    this.#telegram = telegram;
    this.#entries = entries;
  }

  async record(link: TelegramLink, chatId: number, messageId: number, text: string): Promise<void> {
    const ws = await Workspace.load(this.#store, link);
    const plan = new EntryBatch(ws.paymentTypes).plan(text, messageId);
    if (!plan.ok) return void await this.#telegram.reply(chatId, plan.reason, messageId);

    if (plan.invalid.length) {
      await this.#telegram.reply(chatId,
        `⚠️ Not saved:\n${plan.invalid.map((x) => `• “${x.line}” — ${x.reason}`).join('\n')}`, messageId);
    }
    if (!plan.items.length) {
      if (!plan.invalid.length) {
        await this.#telegram.reply(chatId, 'No entries found. Start each line with an amount, e.g.\n200 fruits\n80 clips\n@groceries', messageId);
      }
      return;
    }

    // First pass: save every line that needs no question.
    const waiting: QueuedEntry[] = [];
    for (const item of plan.items) {
      try {
        const outcome = await this.#entries.record({
          link, chatId, seed: item.seed, text: item.text, replace: false,
          replyTo: messageId, label: item.line, defer: true,
        });
        if (outcome === 'deferred') waiting.push({ seed: item.seed, line: item.line, text: item.text, shared: item.shared });
      } catch (err) {
        await this.#telegram.reply(chatId, `⚠️ Not saved: “${item.line}” — ${EntryService.reason(err)}`, messageId);
      }
    }
    if (!waiting.length) return;

    // Then ask about the rest, one at a time.
    const [first, ...rest] = waiting;
    try {
      await this.#entries.record({
        link, chatId, seed: first.seed, text: first.text, replace: false,
        replyTo: messageId, label: first.line, queue: rest, shared: first.shared,
      });
    } catch (err) {
      await this.#telegram.reply(chatId, `⚠️ Not saved: “${first.line}” — ${EntryService.reason(err)}`, messageId);
    }
  }
}
