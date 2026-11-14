/**
 * book-cleaner.smoke.mjs — removing sample data, and resetting a book.
 *
 * A new user chooses on first sign-in whether to keep the sample data; the
 * Settings "Reset data" button deletes every entry. Both must leave the
 * user's own records (or settings) alone, and the cloud diff must turn what
 * was removed into deletes.
 *
 * Pure domain — no DOM, no network. Run: node src/__smoke__/book-cleaner.smoke.mjs
 */
import { BookCleaner } from '../domain/services/BookCleaner.js';
import { SeedFactory } from '../data/seed.js';
import { BookDiff } from '../core/BookDiff.js';
import { CurrencySetupModal } from '../ui/modals/CurrencySetupModal.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
const clone = (v) => JSON.parse(JSON.stringify(v));

console.log('\nbook cleaner suite');

{
  const seed = SeedFactory.create();
  ok('seed accounts are all marked sample', seed.accounts.length > 0 && seed.accounts.every(BookCleaner.isSample));
  ok('seed transactions are all marked sample', seed.transactions.length > 0 && seed.transactions.every(BookCleaner.isSample));
  ok('seed budgets are all marked sample', seed.budgets.length > 0 && seed.budgets.every(BookCleaner.isSample));
  ok('default categories are not sample', seed.categories.length > 0 && !seed.categories.some(BookCleaner.isSample));
  ok('transactions still point at seed accounts',
    seed.transactions.every((t) => seed.accounts.some((a) => a.id === t.accountId)));
  ok('a fresh seed has sample data', BookCleaner.hasSample(seed));
}

{
  // Remove sample: the user's own entry and the account it lives in survive.
  const book = SeedFactory.create();
  const used = book.accounts[0];
  const mine = { id: 'tx_mine', accountId: used.id, amount: 500, type: 'expense', date: '2026-11-14' };
  const myAccount = { id: 'acc_mine', name: 'BOI', currency: 'INR', balance: 0 };
  book.transactions.push(mine);
  book.accounts.push(myAccount);
  book.user.defaultAccountId = book.accounts[1].id;
  const before = clone(book);

  const removed = BookCleaner.removeSample(book);
  ok('every sample transaction removed', !book.transactions.some(BookCleaner.isSample));
  ok('user transaction kept', book.transactions.length === 1 && book.transactions[0].id === 'tx_mine');
  ok('sample budgets removed', book.budgets.length === 0 && removed.budgets === before.budgets.length);
  ok('sample account the user writes into is kept', book.accounts.some((a) => a.id === used.id));
  ok('other sample accounts removed', book.accounts.length === 2 && removed.accounts === before.accounts.length - 2);
  ok('user account kept', book.accounts.some((a) => a.id === 'acc_mine'));
  ok('categories untouched', book.categories.length === before.categories.length);
  ok('default account pointing at a removed account is cleared', book.user.defaultAccountId === '');
  ok('no sample left except the kept account', BookCleaner.hasSample(book) === true);

  const diff = BookDiff.changes(before, book);
  ok('cloud diff deletes the removed sample transactions',
    diff?.remove?.transactions?.length === before.transactions.length - 1);
  ok('cloud diff deletes the removed accounts', diff?.remove?.accounts?.length === removed.accounts);
}

{
  // A book with no sample data at all is left as it is.
  const book = { user: { homeCurrency: 'INR' }, accounts: [{ id: 'a1' }], transactions: [{ id: 't1', accountId: 'a1' }], budgets: [] };
  const before = clone(book);
  BookCleaner.removeSample(book);
  ok('no sample → nothing removed', JSON.stringify(book) === JSON.stringify(before));
  ok('hasSample false for a real book', BookCleaner.hasSample(book) === false);
}

{
  // Reset: every entry goes; categories, settings and sharing stay.
  const book = SeedFactory.create();
  book.debts = [{ id: 'd1' }];
  book.regularItems = [{ id: 'r1' }];
  book.accountGroups = [{ id: 'g1' }];
  book.merchantCategories = { 'whole foods': 'cat_x' };
  book.family = [{ id: 'f1', email: 'wife@example.com' }];
  book.user.homeCurrency = 'INR';
  book.user.defaultAccountId = book.accounts[0].id;
  const before = clone(book);

  const removed = BookCleaner.wipe(book);
  const entryCount = ['transactions', 'accounts', 'budgets', 'debts', 'regularItems', 'accountGroups']
    .reduce((n, k) => n + before[k].length, 0);
  ok('reset reports every removed record', removed === entryCount, `${removed} vs ${entryCount}`);
  ok('all entry lists empty',
    ['transactions', 'accounts', 'budgets', 'debts', 'regularItems', 'accountGroups'].every((k) => book[k].length === 0));
  ok('learned payee categories cleared', Object.keys(book.merchantCategories).length === 0);
  ok('categories kept', book.categories.length === before.categories.length);
  ok('family sharing kept', book.family.length === 1);
  ok('settings kept', book.user.homeCurrency === 'INR');
  ok('default account cleared', book.user.defaultAccountId === '');

  const diff = BookDiff.changes(before, book);
  ok('cloud diff deletes every transaction', diff?.remove?.transactions?.length === before.transactions.length);
  ok('cloud diff deletes debts and regular items',
    diff?.remove?.debts?.length === 1 && diff?.remove?.regularItems?.length === 1);
  ok('cloud diff leaves categories alone', !diff?.remove?.categories);
}

{
  // Onboarding asks about sample data only when there is some.
  const storeWith = (state) => ({ getState: () => state });
  const withSample = new CurrencySetupModal({ store: storeWith(SeedFactory.create()) });
  withSample.onOpen();
  withSample.advance();
  ok('onboarding step 2 is the sample-data choice', withSample.render().includes('chooseSampleData(false)'));
  withSample.advance();
  ok('then the Hijri step', withSample.render().includes('saveCurrencySetup'));

  const realBook = { user: { homeCurrency: 'INR' }, accounts: [{ id: 'a1' }], transactions: [], budgets: [] };
  const noSample = new CurrencySetupModal({ store: storeWith(realBook) });
  noSample.onOpen();
  ok('no sample step shown in the indicator', !noSample.render().includes('Sample data'));
  noSample.advance();
  ok('without sample data step 2 is the Hijri step', noSample.render().includes('saveCurrencySetup'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
