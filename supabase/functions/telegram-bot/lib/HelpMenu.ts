/**
 * HelpMenu — the bot's guide (/help, /start) as a menu of topic pages with
 * buttons, and the command lists Telegram shows in the menu button.
 */
import type { Keyboard } from './TelegramClient.ts';

export interface BotCommand {
  command: string;
  description: string;
}

export class HelpMenu {
  static readonly COMMANDS: BotCommand[] = [
    { command: 'help', description: 'How to record expenses, income and transfers' },
    { command: 'accounts', description: 'List the accounts you can add to' },
    { command: 'categories', description: 'List expense categories and subcategories' },
    { command: 'default', description: 'Show or change your default account' },
    { command: 'deliveries', description: 'Today\'s milk, newspaper… with − / + buttons' },
    { command: 'dues', description: 'What you owe vendors, and record paying them' },
    { command: 'toget', description: 'Money to get back: claims and loans owed to you' },
    { command: 'cancel', description: 'Drop the entry or edit in progress' },
    { command: 'link', description: 'Connect this chat to your Pocket account' },
    { command: 'unlink', description: 'Disconnect this chat' },
  ];

  /** The menu in groups, where the bot only does summaries. */
  static readonly GROUP_COMMANDS: BotCommand[] = [
    { command: 'summary', description: 'Summary settings (on, off, now, time, weekly, yearly, zone, calendar)' },
    { command: 'help', description: 'What I do in this group' },
  ];

  /**
   * The guide as pages. /help shows the first one with a button per topic;
   * tapping a topic replaces the message with that page (and a Back button).
   * Telegram HTML: only <b>, <i>, <code>; < and > are escaped.
   */
  static readonly #PAGES: Record<string, { button: string; text: string }> = {
    home: {
      button: '« All topics',
      text: [
        '<b>📒 Pocket bot</b>',
        'Send what you spent: the amount, what it was, and the category with @.',
        '<code>70 auto to station @taxi</code>',
        '<code>+45000 salary @wazifa</code>  (+ for income)',
        '',
        'Pick a topic to learn more:',
      ].join('\n'),
    },
    record: {
      button: '💸 Expenses & income',
      text: [
        '<b>💸 Expense</b>',
        '<code>70 marol to modi street @taxi</code>',
        '<code>511 mcdonalds abba amma @restaurant</code>',
        'Saved in your default account with your default payment type.',
        '',
        '<b>💰 Income</b> — put + before the amount',
        '<code>+45000 salary @wazifa</code>',
        '',
        '<i>The word "to" in a note never makes a transfer — only &gt; or two #accounts do.</i>',
      ].join('\n'),
    },
    categories: {
      button: '🏷 Categories',
      text: [
        '<b>🏷 Categories</b> — a subcategory is needed for every expense and income',
        'The start of the name is enough: <code>@rest</code> finds Restaurant/Fast food.',
        '<code>@travel</code> opens Travel so you can tap Taxi, Train, Bus…',
        'Forgot it? I\'ll show the main categories as buttons, then their subcategories. Nothing is saved until you choose one.',
        'Same name under two parents? Add the parent: <code>@childrentoiletries</code>',
        'Names with spaces: join them, e.g. <code>@airtimemufaddal</code>',
        '/categories lists them all; <code>/categories travel</code> shows one.',
      ].join('\n'),
    },
    transfers: {
      button: '🔁 Transfers',
      text: [
        '<b>🔁 Transfer</b> — use &gt; between two accounts (no category needed)',
        '<code>5000 #boi &gt; #inrm</code>  from BOI to INR (Mufaddal)',
        '<code>5000 &gt; #mpesa</code>  from your default account',
        '<code>5000 #boi &gt; #mpesa =7750</code>  different currencies: 7,750 arrived',
        'Without =, today\'s exchange rate is used. → and -&gt; also work.',
      ].join('\n'),
    },
    batch: {
      button: '📝 Several at once',
      text: [
        '<b>📝 Several entries at once</b> — one per line',
        '<code>200 fruits</code>',
        '<code>80 clips</code>',
        '<code>1351 oct 2026 bill @electricity #boi</code>',
        '<code>#mpesa @groceries</code>',
        'A line with no amount sets the account, category, payment type or date for every line that doesn\'t name its own. Here fruits and clips go to MPesa as Groceries; the bill keeps BOI and Electricity.',
        'Each line is saved with its own ✏️ Edit and 🗑 Delete buttons. Lines still missing a category are asked one at a time.',
      ].join('\n'),
    },
    extras: {
      button: '➕ Account, date, payment',
      text: [
        '<b>➕ Add to any entry</b>',
        '<code>cash</code>, <code>card</code>, <code>online</code>, <code>cheque</code>  payment type',
        '<code>#name</code>  account, e.g. <code>#mpesa</code> (the start of its name is enough). Accounts shared with you work too.',
        '<code>yesterday</code>  dates it yesterday',
        '<code>8/11</code>  dates it 8 November (day first; add the year if needed: <code>8/11/2025</code>). Future dates aren\'t allowed.',
        'Example: <code>250 lunch cash #mpesa @restaurant yesterday</code>',
        '',
        '<i>If a name matches several accounts, I\'ll list them; type a bit more (e.g. #inrm).</i>',
      ].join('\n'),
    },
    fix: {
      button: '✏️ Fixing mistakes',
      text: [
        '<b>✏️ Fixing mistakes</b>',
        'Every saved entry gets two buttons:',
        '✏️ <b>Edit</b> — send the corrected entry and it replaces the old one.',
        '🗑 <b>Delete</b> — removes the entry.',
        '/cancel drops an entry still waiting for a category, or an edit.',
      ].join('\n'),
    },
    commands: {
      button: '⚙️ Commands',
      text: [
        '<b>⚙️ Commands</b>',
        '/accounts  your accounts and those shared with you',
        '/categories  list expense categories and subcategories',
        '<code>/categories deeni</code>  just one main category',
        '/default  show the default account',
        '/deliveries  today\'s deliveries with − / + · /dues  what you owe vendors',
        '/toget  money to get back: claims and loans owed to you',
        '<code>/default mpesa</code>  change it',
        '/cancel  drop an entry waiting for a category, or an edit',
        '<code>/link name@gmail.com</code>  connect a chat (a code is emailed to you)',
        '/unlink  disconnect this chat',
        '/help  this guide',
      ].join('\n'),
    },
    deliveries: {
      button: '🥛 Milk, bills & dues',
      text: [
        '<b>🥛 Deliveries</b> (set up in the app: Regulars → Deliveries)',
        'Each morning (9 am unless set) I ask what came, with − / + buttons. Tap ✓ if it was the usual; the first answer counts for everyone who got it.',
        'Or type a change: <code>no milk</code> · <code>milk none yesterday</code> · <code>milk x2</code> · <code>milk 2 L</code>',
        '<i>"milk 2" alone is still an expense of 2.</i>',
        '/deliveries  today\'s list again · /dues  what you owe each vendor, with ✓ Paid',
        '',
        '<b>🧾 Bills</b> (Regulars → Bills, set to "asks each time")',
        'I remind you before and on the day, with ✓ Paid (last time\'s amount) or Skip.',
        'Different amount: <code>paid electricity 1950</code>',
        '',
        '<i>Who gets these — everyone, one person or your family group — and the time are set on the item or bill in the app.</i>',
      ].join('\n'),
    },
    owed: {
      button: '🤝 Loans & paybacks',
      text: [
        '<b>🤝 Loans</b> (shown in the app under Debts)',
        '<code>5000 lent Ali</code>  Ali owes you',
        '<code>+20000 borrowed Hussain</code>  you owe Hussain',
        '<code>2000 paid back Ali</code>  Ali repaid part (also <code>2000 Ali paid back</code>)',
        '<code>3000 repaid Hussain</code>  you paid Hussain back',
        '',
        '<b>↩️ Expenses someone will pay back</b> (company, insurer, family)',
        '<code>30000 hospital @medical claim Star Health</code>  they\'ll pay it all',
        '<code>30000 hospital @medical claim Star Health 27000</code>  they\'ll pay 27,000 of it',
        'When the money comes: <code>+27000 paid back Star Health</code>',
        'It\'s shared evenly across their open items; buttons switch to oldest first, close the rest (nothing more coming), or count any extra as income.',
        '',
        '/toget  everything waiting to be paid back',
        '<i>Loans and money paid back move your balance but are never income or spending. #account and dates work as usual.</i>',
      ].join('\n'),
    },
    family: {
      button: '👪 Family group summaries',
      text: [
        '<b>👪 Family group summaries</b> (Pocket Pro)',
        'Add me to your family\'s Telegram group (or a topic in it) and send /summary on there. I\'ll post summaries of your shared space: daily, weekly, monthly and yearly, with the change from the period before.',
        'Only the shared space\'s accounts are included, never personal ones, and I don\'t read the group\'s messages. Entries still come here.',
        '',
        'In the group:',
        '/summary  settings · /summary now  today so far',
        '<code>/summary time 8:30pm</code>  when (a morning time sums up the day before)',
        '<code>/summary weekly friday</code>  the weekly day',
        '<code>/summary zone Nairobi</code>  the time zone',
        '<code>/summary calendar hijri</code>  Hijri or regular months',
        '<code>/summary yearly 31 march</code>  your year end',
        '<code>/summary names off</code> (or daily, weekly, monthly, yearly)',
        '/summary off  stop',
      ].join('\n'),
    },
  };

  /** The order of the topic buttons on the first page, two per row. */
  static readonly #TOPICS = ['record', 'categories', 'transfers', 'batch', 'extras', 'fix', 'deliveries', 'owed', 'family', 'commands'];

  static readonly #PREFIX = 'help:';

  /** Every page key. */
  static get pages(): string[] { return Object.keys(HelpMenu.#PAGES); }

  /** Is this a help button's callback data? */
  static isButton(data: string | undefined): boolean {
    return !!data?.startsWith(HelpMenu.#PREFIX);
  }

  /** The page a help button points to ('home' for anything unknown). */
  static pageFor(data: string | undefined): string {
    const key = (data ?? '').slice(HelpMenu.#PREFIX.length);
    return key in HelpMenu.#PAGES ? key : 'home';
  }

  /** A page's text and buttons: topics on the first page, Back on the others. */
  static page(key = 'home'): { text: string; keyboard: Keyboard } {
    const k = key in HelpMenu.#PAGES ? key : 'home';
    const button = (to: string) => ({ text: HelpMenu.#PAGES[to].button, callback_data: HelpMenu.#PREFIX + to });
    if (k !== 'home') return { text: HelpMenu.#PAGES[k].text, keyboard: [[button('home')]] };
    const keyboard: Keyboard = [];
    for (let i = 0; i < HelpMenu.#TOPICS.length; i += 2) keyboard.push(HelpMenu.#TOPICS.slice(i, i + 2).map(button));
    return { text: HelpMenu.#PAGES.home.text, keyboard };
  }
}
