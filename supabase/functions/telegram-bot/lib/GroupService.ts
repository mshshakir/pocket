/**
 * GroupService — the bot in a Telegram group. It never reads ordinary group
 * messages (Telegram only passes commands to bots in groups), never records
 * entries there, and only answers /summary and /help.
 *
 *   /summary on [space]   tie this group to one of your shared spaces (Family plan)
 *   /summary off          stop
 *   /summary daily|weekly|names on|off
 *   /summary now          today's summary so far
 *   /summary              what this group gets
 *
 * Only entries in that space's own accounts are summarised, never personal
 * accounts. Changing the settings is for the person who turned it on.
 *
 * In a group with topics, summaries go to the topic /summary on was sent in
 * (sending it again from another topic moves them); otherwise, and from the
 * General topic, to the group itself. Replies go to the topic they came from.
 */
import type { GroupSummaries } from './GroupSummaries.ts';
import type { LocalClock } from './LocalClock.ts';
import { PlanAccess } from './PlanAccess.ts';
import { PocketBook } from './PocketBook.ts';
import type { GroupLink, PocketStore, SharedSpace, TelegramLink } from './PocketStore.ts';
import { SummaryReport } from './SummaryReport.ts';
import type { TelegramClient } from './TelegramClient.ts';

export interface GroupMessage {
  message_id: number;
  chat: { id: number; type?: string; title?: string };
  from?: { id: number };
  text?: string;
  message_thread_id?: number;
  is_topic_message?: boolean;
}

/** Where to answer: the group, and the topic the command came from (if any). */
interface Place {
  chatId: number;
  threadId: number | null;
  replyTo: number;
}

export class GroupService {
  static readonly GUIDE = [
    '<b>Pocket in this group</b>',
    'I post a summary of one shared space here: every evening at 9 pm, and a weekly one on Sunday evenings.',
    'Only entries in that space\'s accounts are included. Personal accounts never are, and I don\'t read this group\'s messages.',
    '',
    'Entries are still sent to me in a private chat.',
    '',
    '/summary on  start (for the space\'s owner, on the Family plan)',
    '/summary  what this group gets',
    '/summary now  today so far',
    '/summary daily off · /summary weekly off · /summary names off',
    '/summary off  stop',
  ].join('\n');

  readonly #store: PocketStore;
  readonly #telegram: TelegramClient;
  readonly #summaries: GroupSummaries;
  readonly #clock: LocalClock;

  constructor(store: PocketStore, telegram: TelegramClient, summaries: GroupSummaries, clock: LocalClock) {
    this.#store = store;
    this.#telegram = telegram;
    this.#summaries = summaries;
    this.#clock = clock;
  }

  async handle(message: GroupMessage): Promise<void> {
    const text = (message.text || '').trim();
    if (!text.startsWith('/')) return; // not for the bot
    const chatId = message.chat.id;
    // Only a real topic counts: in ordinary groups a reply chain also carries a thread id.
    const at: Place = { chatId, threadId: message.is_topic_message ? message.message_thread_id ?? null : null, replyTo: message.message_id };
    const command = text.split(/[\s@]/)[0].toLowerCase();
    const args = text.split(/\s+/).slice(1).map((a) => a.toLowerCase());

    if (command === '/help' || command === '/start') return void await this.#say(at, GroupService.GUIDE, true);
    if (command !== '/summary') {
      return void await this.#say(at, 'In groups I only post summaries of a shared space (/summary). Send entries to me in a private chat.');
    }

    const group = await this.#store.findGroup(chatId);
    const [action = '', value = ''] = args;
    if (action === '') return void await this.#status(at, group);
    if (action === 'now') return void await this.#now(at, group);

    const link = message.from ? await this.#store.findLink(message.from.id) : null;
    if (!link) {
      return void await this.#say(at, 'First connect your Pocket account: message me privately and send /link your@email. Then send /summary on here.');
    }
    if (action === 'on') {
      const hint = text.split(/\s+/).slice(2).join(' ');
      return void await this.#on(at, message.chat.title ?? null, link, group, hint);
    }
    if (!group) return void await this.#status(at, null);
    if (group.owner_id !== link.user_id) return void await this.#say(at, 'Only the person who turned summaries on can change them.');
    if (action === 'off') {
      await this.#store.removeGroup(chatId);
      return void await this.#say(at, 'Summaries are off for this group. Send /summary on to start again.');
    }
    if ((action === 'daily' || action === 'weekly' || action === 'names') && (value === 'on' || value === 'off')) {
      await this.#store.updateGroup(chatId, { [action]: value === 'on' });
      return void await this.#status(at, { ...group, [action]: value === 'on' });
    }
    await this.#say(at, GroupService.GUIDE, true);
  }

  async #on(at: Place, title: string | null, link: TelegramLink, group: GroupLink | null, hint: string): Promise<void> {
    if (group && group.owner_id !== link.user_id) {
      return void await this.#say(at, 'This group already gets summaries from another Pocket account. They can turn them off with /summary off.');
    }
    if (!(await PlanAccess.load(this.#store, link.user_id)).canShare) {
      return void await this.#say(at, 'Group summaries come with the Family plan. Open Pocket → Settings → Your plan.');
    }
    const spaces = (await this.#store.spacesOf(link.user_id)).filter((s) => s.accounts > 0);
    if (!spaces.length) {
      return void await this.#say(at,
        'You don\'t share a space with accounts yet. In Pocket, create a shared space and add accounts to it, then send /summary on again.');
    }
    const chosen = GroupService.#pick(spaces, hint);
    if (!chosen) {
      const list = spaces.map((s) => `• ${s.name}`).join('\n');
      const ask = hint ? `No shared space matches "${hint}".` : 'Which shared space should this group follow?';
      return void await this.#say(at, `${ask}\n${list}\nSend /summary on <name>, e.g. /summary on ${PocketBook.squash(spaces[0].name)}`);
    }
    await this.#store.saveGroup(at.chatId, link.user_id, chosen.id, title, at.threadId);
    const name = SummaryReport.esc(chosen.name);
    await this.#say(at, [
      `✅ ${at.threadId ? 'This topic' : 'This group'} will get summaries of <b>${name}</b> (${chosen.accounts} ${chosen.accounts === 1 ? 'account' : 'accounts'}):`,
      'every evening at 9 pm, and a weekly one on Sunday evenings.',
      `Only entries in ${name}'s accounts are included; personal accounts never are.`,
      '',
      'Settings: /summary · Today so far: /summary now',
    ].join('\n'), true);
  }

  async #now(at: Place, group: GroupLink | null): Promise<void> {
    if (!group) return void await this.#status(at, null);
    const text = await this.#summaries.daily(group, this.#clock.isoDate());
    if (!text) return void await this.#say(at, 'The shared space this group followed no longer exists. Send /summary on to choose another.');
    await this.#say(at, text, true);
  }

  async #status(at: Place, group: GroupLink | null): Promise<void> {
    if (!group) {
      return void await this.#say(at,
        'This group doesn\'t get Pocket summaries yet. The owner of a shared space (on the Family plan) can send /summary on here.');
    }
    const space = (await this.#store.spacesOf(group.owner_id)).find((s) => s.id === group.space_id);
    const onOff = (b: boolean) => (b ? 'on' : 'off');
    const where = group.thread_id
      ? (group.thread_id === at.threadId ? 'Posted in this topic.' : 'Posted in another topic; send /summary on here to move them.')
      : 'Posted in the group (General).';
    await this.#say(at, [
      `📊 Summaries of <b>${SummaryReport.esc(space?.name ?? 'a space that no longer exists')}</b>`,
      `Daily at 9 pm: ${onOff(group.daily)} · Weekly on Sundays: ${onOff(group.weekly)} · Names: ${onOff(group.names)}`,
      where,
      '',
      'Change with e.g. /summary weekly off · Stop with /summary off',
    ].join('\n'), true);
  }

  /** Answers in the topic the command came from. */
  async #say(at: Place, text: string, html = false): Promise<void> {
    await this.#telegram.send(at.chatId, text, { html, threadId: at.threadId, replyTo: at.replyTo });
  }

  static #pick(spaces: SharedSpace[], hint: string): SharedSpace | null {
    if (!hint) return spaces.length === 1 ? spaces[0] : null;
    const key = PocketBook.squash(hint);
    const exact = spaces.filter((s) => PocketBook.squash(s.name) === key);
    const prefix = spaces.filter((s) => PocketBook.squash(s.name).startsWith(key));
    const hits = exact.length ? exact : prefix;
    return hits.length === 1 ? hits[0] : null;
  }
}
