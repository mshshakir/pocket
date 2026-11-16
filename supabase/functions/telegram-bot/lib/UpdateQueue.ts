/**
 * UpdateQueue — every Telegram update is handled once, and none is lost:
 *
 *   receive  stores the update (with its content) before Telegram is told it
 *            arrived; a re-send of one already stored is skipped
 *   handle   routes it to the BotController, then marks it done
 *   sweep    picks up updates whose handling never finished (the function
 *            stopped midway) and handles them again — up to 3 tries, within
 *            the hour. Saving entries is safe to repeat: an entry's ids come
 *            from its message, so a repeat never records it twice.
 *
 * Once done, the stored content is cleared; only the id is kept (3 days).
 */
import type { BotController, TelegramCallback, TelegramMessage } from './BotController.ts';
import type { PocketStore } from './PocketStore.ts';

export type TelegramUpdate = Record<string, unknown>;

export class UpdateQueue {
  readonly #store: PocketStore;
  readonly #controller: BotController;

  constructor(store: PocketStore, controller: BotController) {
    this.#store = store;
    this.#controller = controller;
  }

  /** True when this update is new and should be handled. Throws if it can't be stored. */
  async receive(update: TelegramUpdate): Promise<boolean> {
    const id = UpdateQueue.#id(update);
    if (id === null) return true;
    return await this.#store.receiveUpdate(id, update);
  }

  /** Handles one update and marks it done, even when handling fails (its error is kept). */
  async handle(update: TelegramUpdate): Promise<void> {
    let failure: string | undefined;
    try {
      const message = update.message as TelegramMessage | undefined;
      const callback = update.callback_query as TelegramCallback | undefined;
      if (message?.chat?.id) await this.#controller.handleMessage(message);
      else if (callback?.id) await this.#controller.handleCallback(callback);
    } catch (err) {
      console.error('[telegram-bot] update failed', err);
      failure = err instanceof Error ? err.message : String(err);
    }
    const id = UpdateQueue.#id(update);
    if (id !== null) await this.#store.finishUpdate(id, failure);
  }

  /** Handles again any update left unfinished; returns how many. */
  async sweep(): Promise<number> {
    const stale = await this.#store.staleUpdates();
    for (const row of stale) {
      console.warn('[telegram-bot] handling unfinished update again', row.update_id);
      await this.handle(row.payload);
    }
    return stale.length;
  }

  static #id(update: TelegramUpdate): number | null {
    return typeof update.update_id === 'number' ? update.update_id : null;
  }
}
