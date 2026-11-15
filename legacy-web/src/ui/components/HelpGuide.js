/**
 * HelpGuide — the short "how this page works" guides, and the bits that
 * show them: a ? button by the page title and a one-time hint under it.
 *
 * All help text lives here so it can be edited in one place. Keep it plain
 * and short: what the page is for, then a few bullets.
 *
 * Whether a page's hint was seen is kept per device (localStorage), since
 * it's only a nudge.
 */
import { Html } from '../../core/Html.js';

export class HelpGuide {
  static #SEEN_KEY = 'pocket.helpSeen';

  /** @type {Record<string, {title:string, intro:string, points:string[]}>} */
  static #PAGES = Object.freeze({
    accounts: {
      title: 'Accounts',
      intro: 'Accounts are the places your money sits — your wallet, bank, cards and savings.',
      points: [
        'Add one account for each place you keep money: your wallet (<b>Cash</b>), each bank account (<b>Bank</b>), each <b>Credit Card</b>, and any <b>Savings</b> or <b>Investment</b>.',
        '<b>Starting balance</b>: what’s in it today. Every entry you add from then on moves it up or down.',
        '<b>Credit card</b>: enter what you owe as a minus amount, and fill in the <b>limit</b>, <b>statement day</b> and <b>due day</b>. The card’s page then shows this bill, when it’s due, and what’s left to spend, with a <b>Pay bill</b> button.',
        'Pick the account’s own currency. Totals are shown in your home currency.',
        'Moving money between your own accounts (bank to wallet, paying a card)? Add a <b>Transfer</b>, not an expense, so your spending stays right.',
        'Balance doesn’t match? Edit the account and type the current balance — Pocket adds a “Balance adjustment” entry. If <b>Reconcile</b> shows on an account, tap it.',
        '<b>Groups</b> keep things tidy, like Personal and Business. Closed an account? Mark it <b>Archived</b>: its history stays, it’s out of the way.',
        'Set <b>Warn me when the balance drops below</b> to see a Low balance note on the Dashboard. Tick <b>Leave out of totals</b> for a business or investment account you don’t want in your total balance.',
        'Tap <b>Reorder</b> to drag accounts into the order you like; lists and pickers follow it.',
        'You can share an account with family so they can add entries to it.',
      ],
    },
    investments: {
      title: 'Investments',
      intro: 'The gold, silver and shares you own: how much, what you paid, and what it’s worth today.',
      points: [
        '<b>Add</b> it: pick gold, silver or shares. For gold and silver choose the purity; for shares type the company and its code (optional). Then choose <b>I already own it</b> or <b>Buying now</b>.',
        '<b>Buy</b> and <b>Sell</b> move money between your account and your Investments account, with the grams or shares on the same entry. Add <b>Charges</b> (brokerage, making charges) and they count in what it cost you. Spending and budgets aren’t affected.',
        'Tap <b>Price</b> to enter today’s price per gram or per share. Worth = how much you hold × price, and your total balance and net worth use it.',
        'For shares, tap <b>Dividend</b> when one is paid: it’s saved as income and shown on the card.',
        'Set an alert, like <b>20%</b> gain or a target price. When the price reaches it you’ll see it here and on the Dashboard.',
        'Each card shows your <b>average cost</b> and the gain. Open <b>History</b> to see or delete a buy, sale or dividend.',
      ],
    },
    calendar: {
      title: 'Regulars',
      intro: 'Everything that repeats, in one place.',
      points: [
        '<b>Calendar</b> — each day at a glance: bills due, deliveries, and what you logged. Tap a day for details.',
        '<b>Bills</b> — repeating payments like rent or subscriptions. A bill that asks first (like electricity) waits for you to enter the amount. Pay, Edit or Stop from here.',
        '<b>Deliveries</b> — things you pay for later, like milk or the newspaper. Mark the days, pause when you’re away, and pay the vendor what’s owed.',
        '<b>Shortcuts</b> — one-tap entries for things you buy often. They show as chips when you add an expense.',
        'Tap <b>Add</b> to make any of these.',
      ],
    },
    budgets: {
      title: 'Budgets',
      intro: 'Set a limit for what you spend, and see how much is left.',
      points: [
        'A budget covers one or more categories. A budget on a main category includes all its sub-categories.',
        'Pick a Gregorian or a Hijri month for it.',
        '<b>Roll over</b>: what you don’t spend this month is added to next month’s.',
        'Spending in other currencies is converted to the budget’s currency.',
        'You can share a budget with family members you’ve added.',
      ],
    },
    debts: {
      title: 'Debts',
      intro: 'Everything you have to pay, and money owed to you.',
      points: [
        '<b>You owe</b> adds up four things, each in its own group: <b>Loans</b> you took, <b>Credit cards</b>, <b>Bills</b> due, and what you owe for <b>Deliveries</b>. Bills coming up this week are shown but not counted yet.',
        'Each <b>Pay</b> button uses the usual flow for that thing, so paying here or in Regulars or Accounts is the same.',
        'New debt: choose <b>I lent</b> or <b>I borrowed</b>, the person, and the account the money came from or went to. It’s also an entry in that account, so balances stay right.',
        'A loan from a person is paid back whenever, in any amounts. For a bank or car loan, tick <b>Paid back in monthly instalments</b> — it then shows what’s due each month and how many are paid.',
        'Tap <b>Record payment</b> as money comes back or goes out; the bar shows what’s left. <b>Mark as fully paid</b> when it’s settled.',
      ],
    },
    categories: {
      title: 'Categories',
      intro: 'Categories group your entries for budgets and reports.',
      points: [
        'Two levels: main categories, and sub-categories inside them. Expense, income and transfer categories are kept apart.',
        'Tap a category to rename it, change its colour or icon, or move it under another one.',
        '<b>Merge</b>: tick several and move them into one — keep one of them, pick another, or make a new one. You can undo straight after.',
        '<b>Delete</b>: if a category is still in use, you choose where its entries go first.',
      ],
    },
  });

  /** @param {string} page */
  static has(page) { return Object.hasOwn(HelpGuide.#PAGES, page); }

  /** @param {string} page */
  static guide(page) { return HelpGuide.#PAGES[page] ?? null; }

  /** The ? button to put after a page title. */
  static button(page) {
    if (!HelpGuide.has(page)) return '';
    return `<button type="button" class="help-btn inline-flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 align-middle ml-1"
                    style="width:28px;height:28px" onclick="window.__app.openHelp('${page}')" title="How this page works" aria-label="How this page works">
              <i data-lucide="circle-help" style="width:18px;height:18px"></i>
            </button>`;
  }

  /** A one-line nudge under the title until the guide is opened or closed. */
  static hint(page) {
    if (!HelpGuide.has(page) || HelpGuide.seen(page)) return '';
    return `<div class="help-hint flex items-center gap-2 text-xs text-zinc-500 mt-1">
              <span>New here? Tap <b>?</b> for a quick guide.</span>
              <button type="button" class="underline" onclick="window.__app.dismissHelpHint('${page}')">Got it</button>
            </div>`;
  }

  /** The guide's content, for the help window. */
  static body(page) {
    const g = HelpGuide.guide(page);
    if (!g) return '';
    return `<p class="text-sm text-zinc-500 mb-3">${Html.escape(g.intro)}</p>
            <ul class="space-y-2 text-sm list-disc pl-5">${g.points.map((p) => `<li>${p}</li>`).join('')}</ul>`;
  }

  /** @param {string} page */
  static seen(page) { return HelpGuide.#readSeen().includes(page); }

  /** @param {string} page */
  static markSeen(page) {
    const list = HelpGuide.#readSeen();
    if (list.includes(page)) return;
    list.push(page);
    try { localStorage.setItem(HelpGuide.#SEEN_KEY, JSON.stringify(list)); } catch { /* storage off: the hint just shows again */ }
  }

  static #readSeen() {
    try {
      const v = JSON.parse(localStorage.getItem(HelpGuide.#SEEN_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }
}
