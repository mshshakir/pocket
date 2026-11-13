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
    { command: 'default', description: 'Show or change your default account' },
  ];

  /** Telegram HTML: only <b>, <i>, <code> are used; < and > are escaped. */
  static readonly GUIDE = [
    '<b>📒 Pocket bot — how to record</b>',
    'Start with the amount, then describe it. Everything after the amount becomes the note.',
    '',
    '<b>💸 Expense</b>',
    '<code>70 marol to modi street</code>',
    '<code>511 mcdonalds abba amma</code>',
    'Saved in your default account with your default payment type.',
    '',
    '<b>💰 Income</b> — put + before the amount',
    '<code>+45000 salary</code>',
    '',
    '<b>🔁 Transfer</b> — use &gt; between two accounts',
    '<code>5000 #boi &gt; #inrm</code>  from BOI to INR (Mufaddal)',
    '<code>5000 &gt; #mpesa</code>  from your default account',
    '<code>5000 #boi &gt; #mpesa =7750</code>  different currencies: 7,750 arrived',
    'Without =, today\'s exchange rate is used. → and -&gt; also work.',
    '',
    '<b>➕ Add to any entry</b>',
    '<code>cash</code>, <code>card</code>, <code>online</code>, <code>cheque</code>  payment type',
    '<code>#name</code>  account, e.g. <code>#mpesa</code> (the start of its name is enough)',
    '<code>@name</code>  category, e.g. <code>@food</code>',
    '<code>yesterday</code>  dates it yesterday',
    'Example: <code>250 lunch cash #mpesa @food yesterday</code>',
    '',
    '<b>⚙️ Commands</b>',
    '/accounts  list your accounts',
    '/default  show the default account',
    '<code>/default mpesa</code>  change it',
    '/help  this guide',
    '',
    '<i>The word "to" in a note never makes a transfer — only &gt; or two #accounts do.</i>',
    '<i>If a name matches several accounts, I\'ll list them; type a bit more (e.g. #inrm).</i>',
    '<i>Edit or delete entries in the Pocket app.</i>',
  ].join('\n');
}
