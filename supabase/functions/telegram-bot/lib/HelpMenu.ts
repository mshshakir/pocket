/**
 * HelpMenu — the bot's guide (/help, /start) and the command list Telegram
 * shows in the chat's menu button.
 */
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
    { command: 'cancel', description: 'Drop the entry or edit in progress' },
    { command: 'link', description: 'Connect this chat to your Pocket account' },
    { command: 'unlink', description: 'Disconnect this chat' },
  ];

  /** Telegram HTML: only <b>, <i>, <code> are used; < and > are escaped. */
  static readonly GUIDE = [
    '<b>📒 Pocket bot — how to record</b>',
    'Start with the amount, then describe it, then add the category with @.',
    '',
    '<b>💸 Expense</b>',
    '<code>70 marol to modi street @taxi</code>',
    '<code>511 mcdonalds abba amma @restaurant</code>',
    'Saved in your default account with your default payment type.',
    '',
    '<b>💰 Income</b> — put + before the amount',
    '<code>+45000 salary @wazifa</code>',
    '',
    '<b>🏷 Category</b> — a subcategory is needed for every expense and income',
    'The start of the name is enough: <code>@rest</code> finds Restaurant/Fast food.',
    '<code>@travel</code> opens Travel so you can tap Taxi, Train, Bus…',
    'Forgot it? I\'ll show the main categories as buttons, then their subcategories. Nothing is saved until you choose one.',
    'Same name under two parents? Add the parent: <code>@childrentoiletries</code>',
    'Names with spaces: join them, e.g. <code>@airtimemufaddal</code>',
    '/categories lists them all; <code>/categories travel</code> shows one.',
    '',
    '<b>🔁 Transfer</b> — use &gt; between two accounts (no category needed)',
    '<code>5000 #boi &gt; #inrm</code>  from BOI to INR (Mufaddal)',
    '<code>5000 &gt; #mpesa</code>  from your default account',
    '<code>5000 #boi &gt; #mpesa =7750</code>  different currencies: 7,750 arrived',
    'Without =, today\'s exchange rate is used. → and -&gt; also work.',
    '',
    '<b>➕ Add to any entry</b>',
    '<code>cash</code>, <code>card</code>, <code>online</code>, <code>cheque</code>  payment type',
    '<code>#name</code>  account, e.g. <code>#mpesa</code> (the start of its name is enough). Accounts shared with you work too.',
    '<code>yesterday</code>  dates it yesterday',
    'Example: <code>250 lunch cash #mpesa @restaurant yesterday</code>',
    '',
    '<b>✏️ Fixing mistakes</b>',
    'Every saved entry gets two buttons:',
    '✏️ <b>Edit</b> — send the corrected entry and it replaces the old one.',
    '🗑 <b>Delete</b> — removes the entry.',
    '',
    '<b>⚙️ Commands</b>',
    '/accounts  your accounts and those shared with you',
    '/categories  list expense categories and subcategories',
    '<code>/categories deeni</code>  just one main category',
    '/default  show the default account',
    '<code>/default mpesa</code>  change it',
    '/cancel  drop an entry waiting for a category, or an edit',
    '<code>/link name@gmail.com</code>  connect a chat (a code is emailed to you)',
    '/unlink  disconnect this chat',
    '/help  this guide',
    '',
    '<i>The word "to" in a note never makes a transfer — only &gt; or two #accounts do.</i>',
    '<i>If a name matches several accounts, I\'ll list them; type a bit more (e.g. #inrm).</i>',
  ].join('\n');
}
