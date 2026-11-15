/**
 * SampleBook — the sample book a first-time visitor opens with: about six
 * months of an ordinary household in India, in rupees, so every part of
 * Pocket has something to show.
 *
 *   Accounts     bank, cash (just under its low-balance alert), savings, a
 *                credit card with a statement due, an investments account,
 *                and a petty-cash account left out of totals; two groups
 *   Entries      salary, rent, groceries, food delivery, fuel, cabs, chai,
 *                shopping (over budget this month), health, education,
 *                transfers, ATM withdrawals, card payments
 *   Regulars     salary, rent, internet and Netflix repeats; a gym repeat
 *                paused this month; an electricity bill that asks first and
 *                is due in a few days; milk and newspaper deliveries; chai
 *                and auto shortcuts
 *   Debts        money lent to a friend (part repaid) and an interest-free
 *                loan from family for the car, paid back in monthly
 *                instalments that add up to exactly what was borrowed (one
 *                behind). No interest is given or taken anywhere.
 *   Reimbursements  an office trip claim (half paid back), a health claim
 *                waiting, and a dinner a friend paid back
 *   Investments  24k gold, 999 silver (one sale) and shares (TCS, Infosys,
 *                a dividend), with prices and a gain alert
 *   Budgets      monthly (near, over, on track with rollover, bills still to
 *                come), weekly, yearly, Hijri month and a trip on set dates
 *   Habits       food delivery with a monthly limit, cabs with an amount limit
 *
 * Everything the visitor didn't type is flagged as sample (BookCleaner), so
 * "Remove sample data" takes it all away and keeps their own entries.
 * Dates are worked out from today; amounts come from a fixed seed, so the
 * book looks the same each time for the same day.
 */
import { DEFAULT_CATEGORIES } from './constants.js';
import { IdGenerator } from '../domain/services/IdGenerator.js';
import { DateService } from '../domain/services/DateService.js';
import { BookCleaner } from '../domain/services/BookCleaner.js';

export class SampleBook {
  static DAYS = 180;

  /** @type {string} */ #today;
  /** @type {() => number} */ #rand;
  /** @type {object[]} */ #cats = [];
  /** @type {object[]} */ #tx = [];
  /** @type {Record<string, object>} */ #acc = {};
  /** @type {Record<string, string>} */ #merchant = {};

  /** @param {string} [today] YYYY-MM-DD */
  constructor(today = DateService.todayIso()) {
    this.#today = today;
    this.#rand = SampleBook.#seeded(20261115);
  }

  /** The whole book, ready for the Store. */
  build() {
    this.#categories();
    this.#accounts();
    const groups = this.#groups();
    this.#income();
    this.#everyday();
    this.#repeats();
    this.#bills();
    const regularItems = this.#regulars();
    const debts = this.#debts();
    const claims = this.#reimbursements();
    const holdings = this.#investments();
    this.#transfers();
    this.#balances();
    const budgets = this.#budgets();
    const habits = this.#habits();
    const s = (list) => list.map((x) => BookCleaner.markSample(x));
    return {
      user: SampleBook.#user(),
      accounts:           s(Object.values(this.#acc)),
      accountGroups:      s(groups),
      categories:         this.#cats,
      transactions:       s(this.#tx),
      budgets:            s(budgets),
      debts:              s(debts),
      regularItems:       s(regularItems),
      holdings:           s(holdings),
      claims:             s(claims),
      habits:             s(habits),
      merchantCategories: { ...this.#merchant },
      family:             [],
    };
  }

  // ── Categories ──────────────────────────────────────────────────────

  #categories() {
    const uid = (p) => IdGenerator.generate(p);
    this.#cats = DEFAULT_CATEGORIES.map((c) => ({ id: uid('cat'), parentId: null, budgetLimit: null, ...c }));
    const sub = (parent, name, icon, color) => {
      const c = BookCleaner.markSample({ id: uid('cat'), name, icon, color, type: this.#find(parent).type, parentId: this.#find(parent).id, budgetLimit: null });
      this.#cats.push(c);
    };
    sub('Food & Drink', 'Groceries', 'shopping-basket', '#f59e0b');
    sub('Food & Drink', 'Eating out', 'utensils-crossed', '#fb923c');
    sub('Food & Drink', 'Milk & paper', 'milk', '#fbbf24');
    sub('Transport', 'Fuel', 'fuel', '#2563eb');
    sub('Transport', 'Cabs & autos', 'car-taxi-front', '#60a5fa');
    sub('Bills', 'Electricity', 'zap', '#0e7490');
    sub('Bills', 'Internet & phone', 'wifi', '#06b6d4');
    sub('Housing', 'Rent', 'key-round', '#a16207');
    sub('Health', 'Medicines', 'pill', '#f87171');
    sub('Entertainment', 'Subscriptions', 'tv', '#a78bfa');
    sub('Entertainment', 'Gym', 'dumbbell', '#84cc16');
    const top = (name, icon, color, type) => this.#cats.push(BookCleaner.markSample({ id: uid('cat'), name, icon, color, type, parentId: null, budgetLimit: null }));
    top('Travel', 'plane', '#0ea5e9', 'expense');
    top('Dividends', 'coins', '#16a34a', 'income');
  }

  #find(name) { return this.#cats.find((c) => c.name === name); }
  #cat(name) { return this.#find(name)?.id ?? null; }

  // ── Accounts ────────────────────────────────────────────────────────

  #accounts() {
    const a = (key, x) => { this.#acc[key] = { id: IdGenerator.generate('acc'), archived: false, openingBalance: 0, balance: 0, ...x }; };
    a('bank',  { name: 'HDFC Bank',        type: 'bank',    currency: 'INR', color: '#0ea5e9', icon: 'landmark' });
    a('cash',  { name: 'Cash',             type: 'cash',    currency: 'INR', color: '#22c55e', icon: 'wallet', lowBalance: 200000 });
    a('card',  { name: 'HDFC Credit Card', type: 'card',    currency: 'INR', color: '#a855f7', icon: 'credit-card', creditLimit: 15000000, statementDay: 5, dueDay: 25 });
    a('save',  { name: 'SBI Savings',      type: 'savings', currency: 'INR', color: '#14b8a6', icon: 'vault' });
    a('inv',   { name: 'Investments',      type: 'invest',  currency: 'INR', color: '#eab308', icon: 'trending-up' });
    a('petty', { name: 'Office petty cash', type: 'cash',   currency: 'INR', color: '#94a3b8', icon: 'wallet', excludeFromTotals: true });
  }

  #groups() {
    const everyday = { id: IdGenerator.generate('grp'), name: 'Everyday', color: '#0ea5e9' };
    const savings  = { id: IdGenerator.generate('grp'), name: 'Savings & investments', color: '#14b8a6' };
    for (const k of ['bank', 'cash', 'card', 'petty']) this.#acc[k].groupId = everyday.id;
    for (const k of ['save', 'inv']) this.#acc[k].groupId = savings.id;
    return [everyday, savings];
  }

  /** Opening balances that land each account where the story needs it today. */
  #balances() {
    const target = { bank: 8435000, cash: 124000, save: 21500000, petty: 500000 };
    for (const [key, want] of Object.entries(target)) {
      const acc = this.#acc[key];
      acc.openingBalance = want - this.#delta(acc.id);
      acc.balance = want;
    }
    for (const key of ['card', 'inv']) this.#acc[key].balance = this.#delta(this.#acc[key].id);
  }

  #delta(accountId) {
    let d = 0;
    for (const t of this.#tx) {
      if (t.accountId !== accountId) continue;
      if (t.type === 'income' || (t.type === 'transfer' && t.transferDir === 'in')) d += t.amount;
      else d -= t.amount;
    }
    return d;
  }

  // ── Entries ─────────────────────────────────────────────────────────

  #add(x) {
    const t = {
      id: x.id || IdGenerator.generate('tx'), accountId: this.#acc[x.acc || 'bank'].id,
      categoryId: x.cat ? this.#cat(x.cat) : null, amount: x.amount, currency: 'INR', exchangeRate: 1, refAmount: x.amount,
      payee: x.payee || '', note: x.note || '', date: x.date, paymentType: x.pay || 'upi', recordState: 'cleared',
      type: x.type || 'expense', transferPairId: null, tags: x.tags || [],
    };
    for (const k of Object.keys(x)) if (!['acc', 'cat', 'pay', 'type', 'id'].includes(k) && !(k in t)) t[k] = x[k];
    if (x.payee && t.categoryId && t.type !== 'transfer') this.#merchant[x.payee.toLowerCase()] = t.categoryId;
    this.#tx.push(t);
    return t;
  }

  #transfer(from, to, amount, date, note, extraIn = {}) {
    const out = this.#add({ acc: from, amount, date, type: 'transfer', transferDir: 'out', note, pay: 'transfer' });
    const inn = this.#add({ acc: to, amount, date, type: 'transfer', transferDir: 'in', note, pay: 'transfer', ...extraIn });
    out.transferPairId = inn.id; inn.transferPairId = out.id;
    return { out, inn };
  }

  /** Every date in the window, oldest first, except the future. */
  *#days() {
    for (let i = SampleBook.DAYS; i >= 0; i--) yield this.#ago(i);
  }

  #income() {
    for (const d of this.#monthly(1)) this.#add({ id: `${this.#salaryId}__${d}`, recurringSourceId: this.#salaryId, acc: 'bank', type: 'income', cat: 'Salary', amount: 9500000, payee: 'Acme Technologies', note: 'Monthly salary', date: d, pay: 'transfer' });
    for (const back of [130, 62]) this.#add({ acc: 'bank', type: 'income', cat: 'Freelance', amount: 1800000 + this.#int(0, 6) * 100000, payee: 'Design client', note: 'Logo and brand kit', date: this.#ago(back), pay: 'transfer' });
  }

  #everyday() {
    const monthStart = this.#today.slice(0, 8) + '01';
    for (const d of this.#days()) {
      const wd = SampleBook.#weekday(d);
      const thisMonth = d >= monthStart;
      if (wd === 6) this.#add({ acc: this.#pick(['bank', 'card']), cat: 'Groceries', payee: this.#pick(['BigBasket', 'DMart', 'Reliance Fresh']), amount: this.#money(1800, 4200), date: d, note: 'Weekly groceries' });
      if (this.#rand() < 0.36) this.#add({ acc: this.#pick(['bank', 'card']), cat: 'Eating out', payee: this.#pick(['Swiggy', 'Swiggy', 'Zomato']), amount: this.#money(280, 820), date: d });
      if (wd !== 0 && this.#rand() < 0.55) this.#add({ acc: 'cash', cat: 'Food & Drink', payee: 'Chai', amount: 2000, date: d, pay: 'cash', regularItemId: this.#chaiId });
      if (this.#rand() < 0.22) this.#add({ acc: this.#pick(['cash', 'bank']), cat: 'Cabs & autos', payee: this.#pick(['Uber', 'Ola', 'Auto']), amount: this.#money(90, 520), date: d, pay: 'cash' });
      if (d.slice(8) === '08' || d.slice(8) === '22') this.#add({ acc: 'card', cat: 'Fuel', payee: 'Indian Oil', amount: this.#money(1800, 2600), date: d, pay: 'card' });
      if (this.#rand() < (thisMonth ? 0.16 : 0.06)) this.#add({ acc: 'card', cat: 'Shopping', payee: this.#pick(['Amazon', 'Myntra', 'Decathlon']), amount: this.#money(700, 3200), date: d, pay: 'card' });
      if (this.#rand() < 0.04) this.#add({ acc: 'bank', cat: 'Medicines', payee: 'Apollo Pharmacy', amount: this.#money(240, 1100), date: d });
      if (d.slice(8) === '12') this.#transfer('bank', 'cash', 150000, d, 'ATM withdrawal');
    }
    this.#add({ acc: 'bank', cat: 'Education', payee: 'Coursera', amount: 399900, date: this.#ago(70), note: 'Data course, 3 months' });
    this.#add({ acc: 'bank', cat: 'Education', payee: 'Crossword', amount: 128000, date: this.#ago(18), note: 'Two books' });
    this.#add({ acc: 'petty', cat: 'Food & Drink', payee: 'Office snacks', amount: 64000, date: this.#ago(6), pay: 'cash' });
  }

  // ── Repeats and bills ───────────────────────────────────────────────

  get #salaryId() { return this.#ids.salary; }
  get #chaiId()   { return this.#ids.chai; }
  #ids = { salary: IdGenerator.generate('tx'), chai: IdGenerator.generate('ri'), auto: IdGenerator.generate('ri') };

  /** Every month's day `day` in the window up to today. */
  #monthly(day) {
    const out = [];
    const start = this.#ago(SampleBook.DAYS);
    let [y, m] = start.split('-').map(Number);
    for (let i = 0; i < 8; i++) {
      const d = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (d >= start && d <= this.#today) out.push(d);
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  /** A repeat: its first entry is the template, later months are its copies. */
  #repeat(x, day) {
    const dates = this.#monthly(day);
    if (!dates.length) return null;
    const tpl = this.#add({ ...x, date: dates[0], recurring: { rule: 'monthly', interval: 1, until: null, skipped: [] } });
    for (const d of dates.slice(1)) {
      if (x.pauses && x.pauses.some((p) => d >= p.from && (!p.to || d <= p.to))) continue;
      const copy = this.#add({ ...x, id: `${tpl.id}__${d}`, recurringSourceId: tpl.id, date: d });
      delete copy.pauses;
    }
    return tpl;
  }

  #repeats() {
    // Salary entries were added in #income with the template's copy ids; make the first one the template.
    const salaries = this.#tx.filter((t) => t.recurringSourceId === this.#salaryId).sort((a, b) => a.date.localeCompare(b.date));
    if (salaries.length) {
      const first = salaries[0];
      first.id = this.#salaryId; delete first.recurringSourceId;
      first.recurring = { rule: 'monthly', interval: 1, until: null, skipped: [] };
    }
    this.#repeat({ acc: 'bank', cat: 'Rent', payee: 'Landlord — Mr. Kapoor', amount: 2800000, note: 'Flat rent', pay: 'transfer' }, 5);
    this.#repeat({ acc: 'bank', cat: 'Internet & phone', payee: 'Airtel Fiber', amount: 99900, note: 'Broadband' }, 7);
    this.#repeat({ acc: 'card', cat: 'Subscriptions', payee: 'Netflix', amount: 64900, pay: 'card' }, 15);
    const monthStart = this.#today.slice(0, 8) + '01';
    const monthEnd = SampleBook.#monthEnd(this.#today);
    this.#repeat({ acc: 'bank', cat: 'Gym', payee: 'Cult.fit', amount: 150000, note: 'Gym membership', pauses: [{ from: monthStart, to: monthEnd }] }, 3);
  }

  /** Electricity: a bill that asks first; past months paid, this month's due in a few days. */
  #bills() {
    const due = SampleBook.#dayOf(SampleBook.#addDays(this.#today, 4));
    const dates = this.#monthly(due).filter((d) => d < this.#today);
    if (!dates.length) return;
    const bill = { acc: 'bank', cat: 'Electricity', payee: 'Tata Power', note: 'Electricity bill' };
    const tpl = this.#add({ ...bill, amount: this.#money(1400, 2400), date: dates[0],
      recurring: { rule: 'monthly', interval: 1, until: null, skipped: [] }, askFirst: true, remindDays: 2, remindTo: 'all' });
    for (const d of dates.slice(1)) {
      // A payment's id names the date it was due; it is dated the day it was paid.
      const paidOn = SampleBook.#addDays(d, this.#int(0, 2));
      this.#add({ ...bill, id: `${tpl.id}__${d}`, recurringSourceId: tpl.id, amount: this.#money(1500, 2900), date: paidOn > this.#today ? d : paidOn });
    }
  }

  #regulars() {
    const trackFrom = this.#ago(75);
    const lastMonthEnd = SampleBook.#addDays(this.#today.slice(0, 8) + '01', -1);
    const milk = {
      id: IdGenerator.generate('ri'), name: 'Milk', vendor: 'Ramesh doodhwala', unit: 'L', icon: 'milk', color: '#f59e0b',
      accountId: this.#acc.cash.id, categoryId: this.#cat('Milk & paper'), currency: 'INR', defaultAmount: 6800,
      payLater: true, usualQty: 1, usualDays: [0, 1, 2, 3, 4, 5, 6], trackFrom, marks: {}, pauses: [], confirmed: {},
      checkinTo: 'all', checkinMinute: 480,
    };
    const paper = {
      id: IdGenerator.generate('ri'), name: 'Newspaper', vendor: 'Sharma news agency', unit: '', icon: 'newspaper', color: '#64748b',
      accountId: this.#acc.cash.id, categoryId: this.#cat('Milk & paper'), currency: 'INR', defaultAmount: 1000,
      payLater: true, usualQty: 1, usualDays: [1, 2, 3, 4, 5, 6], trackFrom, marks: {}, pauses: [], confirmed: {},
    };
    // Guests one weekend: 2 L; away 3 days last month: paused.
    milk.marks[SampleBook.#addDays(lastMonthEnd, -9)] = 2;
    const away = SampleBook.#addDays(lastMonthEnd, -20);
    milk.pauses.push({ from: away, to: SampleBook.#addDays(away, 2) });
    // Every past day confirmed except yesterday, so the app shows one to check.
    for (const item of [milk, paper]) {
      for (let d = trackFrom; d < SampleBook.#addDays(this.#today, -1); d = SampleBook.#addDays(d, 1)) item.confirmed[d] = true;
    }
    // Paid each vendor up to the end of every finished month.
    for (const item of [milk, paper]) {
      let from = trackFrom;
      for (let end = SampleBook.#monthEnd(trackFrom); end <= lastMonthEnd; end = SampleBook.#monthEnd(SampleBook.#addDays(end, 1))) {
        const amount = this.#deliveryCost(item, from, end);
        if (amount > 0) this.#add({ acc: 'cash', cat: 'Milk & paper', payee: item.vendor, amount, date: SampleBook.#addDays(end, 2) > this.#today ? end : SampleBook.#addDays(end, 2), pay: 'cash', regularItemId: item.id, settles: { from, to: end, qty: this.#deliveryQty(item, from, end) }, note: `${item.name} ${DateRangeText.range(from, end)}` });
        from = SampleBook.#addDays(end, 1);
      }
      item.paidTo = lastMonthEnd >= trackFrom ? lastMonthEnd : null;
    }
    const chai = { id: this.#ids.chai, name: 'Chai', icon: 'coffee', color: '#a16207', currency: 'INR', accountId: this.#acc.cash.id, categoryId: this.#cat('Food & Drink'), defaultAmount: 2000 };
    const auto = { id: this.#ids.auto, name: 'Auto', icon: 'car-taxi-front', color: '#facc15', currency: 'INR', accountId: this.#acc.cash.id, categoryId: this.#cat('Cabs & autos'), defaultAmount: 6000 };
    return [milk, paper, chai, auto];
  }

  #deliveryQty(item, from, to) {
    let q = 0;
    for (let d = from; d <= to; d = SampleBook.#addDays(d, 1)) q += this.#qtyOn(item, d);
    return q;
  }

  #deliveryCost(item, from, to) { return Math.round(this.#deliveryQty(item, from, to) * item.defaultAmount); }

  #qtyOn(item, d) {
    if (d < item.trackFrom) return 0;
    if (item.marks[d] != null) return item.marks[d];
    if (item.pauses.some((p) => d >= p.from && d <= p.to)) return 0;
    return item.usualDays.includes(SampleBook.#weekday(d)) ? item.usualQty : 0;
  }

  // ── Debts ───────────────────────────────────────────────────────────

  #debts() {
    const lent = { id: IdGenerator.generate('dbt'), type: 'lent', counterparty: 'Imran', principal: 1500000, currency: 'INR',
      accountId: this.#acc.bank.id, dateTaken: this.#ago(58), dueDate: SampleBook.#addDays(this.#today, 30), note: 'For his bike repair', status: 'active' };
    const t1 = this.#add({ acc: 'bank', amount: lent.principal, date: lent.dateTaken, payee: 'Imran', note: 'Lent to Imran — for his bike repair', tags: ['debt'], debtId: lent.id, debtRole: 'initial', pay: 'transfer' });
    lent.initialTxId = t1.id;
    this.#add({ acc: 'bank', type: 'income', amount: 500000, date: this.#ago(21), payee: 'Imran', note: 'Repayment from Imran', tags: ['debt-payment'], debtId: lent.id, debtRole: 'payment', pay: 'upi' });

    // Interest-free family loan towards the car: 12 instalments of ₹10,000 on
    // the 10th — exactly the ₹1,20,000 borrowed; the latest one not paid yet.
    const taken = this.#ago(200);
    const loan = { id: IdGenerator.generate('dbt'), type: 'borrowed', counterparty: 'Mustafa bhai', principal: 12000000, currency: 'INR',
      accountId: this.#acc.bank.id, dateTaken: taken, dueDate: null, note: 'Interest-free, towards the car', status: 'active',
      instalmentAmount: 1000000, instalmentDay: 10, instalmentCount: 12 };
    const t2 = this.#add({ acc: 'bank', type: 'income', amount: loan.principal, date: taken, payee: loan.counterparty, note: 'Borrowed from Mustafa bhai — interest-free, towards the car', tags: ['debt'], debtId: loan.id, debtRole: 'initial', pay: 'transfer' });
    // The car itself, bought before the sample's six months.
    this.#add({ acc: 'bank', cat: 'Transport', amount: 42000000, date: taken, payee: 'Maruti Suzuki', note: 'New car', pay: 'transfer' });
    loan.initialTxId = t2.id;
    // Instalment dates: the 10th of each month after the loan was taken, up to today.
    const due = [];
    for (let d = taken; d <= this.#today; d = SampleBook.#addDays(d, 1)) if (d > taken && d.slice(8) === '10') due.push(d);
    due.slice(0, Math.max(0, due.length - 1)).forEach((d) => {
      this.#add({ acc: 'bank', amount: loan.instalmentAmount, date: d, payee: loan.counterparty, note: 'Payment to Mustafa bhai — instalment', tags: ['debt-payment'], debtId: loan.id, debtRole: 'payment', pay: 'transfer' });
    });
    return [lent, loan];
  }

  // ── Reimbursements ──────────────────────────────────────────────────

  #reimbursements() {
    const trip = { id: IdGenerator.generate('clm'), name: 'Pune client visit', ref: 'EXP-2291' };
    const health = { id: IdGenerator.generate('clm'), name: 'Clinic visit', ref: 'CL-4471' };
    const hotel = this.#add({ acc: 'card', cat: 'Travel', payee: 'Lemon Tree Hotel', amount: 840000, date: this.#ago(34), pay: 'card', note: 'Two nights', reimbBy: 'Acme Technologies', claimId: trip.id });
    this.#add({ acc: 'card', cat: 'Travel', payee: 'IndiGo', amount: 620000, date: this.#ago(36), pay: 'card', note: 'Flight to Pune', reimbBy: 'Acme Technologies', claimId: trip.id });
    this.#add({ acc: 'bank', type: 'income', amount: 840000, date: this.#ago(9), payee: 'Acme Technologies', note: 'Expense claim EXP-2291 (part)', tags: ['reimbursement'],
      reimbBy: 'Acme Technologies', claimId: trip.id, reimbAlloc: [{ txId: hotel.id, amount: 840000, pay: 840000 }], pay: 'transfer' });
    this.#add({ acc: 'bank', cat: 'Health', payee: 'City Clinic', amount: 320000, date: this.#ago(12), note: 'Consultation and tests', reimbBy: 'Star Health', reimbExpected: 280000, claimId: health.id });
    const dinner = this.#add({ acc: 'card', cat: 'Eating out', payee: 'Barbeque Nation', amount: 240000, date: this.#ago(26), pay: 'card', note: 'Dinner with Imran — half is his', reimbBy: 'Imran', reimbExpected: 120000 });
    this.#add({ acc: 'bank', type: 'income', amount: 120000, date: this.#ago(24), payee: 'Imran', note: 'His half of dinner', tags: ['reimbursement'],
      reimbBy: 'Imran', reimbAlloc: [{ txId: dinner.id, amount: 120000, pay: 120000 }], pay: 'upi' });
    return [trip, health];
  }

  // ── Investments ─────────────────────────────────────────────────────

  #investments() {
    const h = (x) => ({ id: IdGenerator.generate('hld'), accountId: this.#acc.inv.id, currency: 'INR', archived: false, ...x });
    const price = (list) => list.map(([back, p]) => ({ date: this.#ago(back), price: p }));
    const gold = h({ kind: 'gold', purity: '24k', name: '24k gold coins', unit: 'g', openingQty: 10, openingCost: 6200000,
      prices: price([[120, 720000], [60, 745000], [20, 762000], [2, 778000]]), alert: { gainPct: 20 } });
    const silver = h({ kind: 'silver', purity: '999', name: 'Silver bar', unit: 'g',
      prices: price([[90, 8800], [30, 9400], [3, 9700]]) });
    const tcs = h({ kind: 'shares', code: 'TCS', name: 'Tata Consultancy Services', unit: 'shares', prices: price([[100, 395000], [40, 412000], [1, 426000]]) });
    const infy = h({ kind: 'shares', code: 'INFY', name: 'Infosys', unit: 'shares', prices: price([[80, 148000], [1, 156500]]), alert: { targetPrice: 160000 } });

    const buy = (hold, back, qty, unit, charges = 0) => this.#transfer('bank', 'inv', Math.round(qty * unit) + charges, this.#ago(back),
      `Buy ${qty}${hold.unit === 'g' ? ' g' : ' shares'} · ${hold.name}`, { holdingId: hold.id, qty, unitPrice: unit });
    const sell = (hold, back, qty, unit, charges = 0) => {
      const { out } = this.#transfer('inv', 'bank', Math.round(qty * unit) - charges, this.#ago(back), `Sell ${qty}${hold.unit === 'g' ? ' g' : ' shares'} · ${hold.name}`);
      Object.assign(out, { holdingId: hold.id, qty: -qty, unitPrice: unit });
    };
    buy(gold, 58, 5, 745000);
    buy(silver, 88, 500, 8800);
    sell(silver, 28, 100, 9900);
    buy(tcs, 98, 10, 395000, 2000);
    buy(infy, 79, 15, 148000, 1500);
    this.#add({ acc: 'bank', type: 'income', cat: 'Dividends', amount: 25000, date: this.#ago(33), payee: 'TCS', note: 'Dividend · Tata Consultancy Services', holdingId: tcs.id, pay: 'transfer' });
    return [gold, silver, tcs, infy];
  }

  // ── Transfers ───────────────────────────────────────────────────────

  #transfers() {
    for (const d of this.#monthly(2)) this.#transfer('bank', 'save', 1000000, d, 'Monthly savings');
    // Card: each statement (the 5th) paid in full on the 20th — the latest one still open.
    const card = this.#acc.card.id;
    const statements = this.#monthly(5);
    let prev = this.#ago(SampleBook.DAYS + 1);
    for (const st of statements) {
      const bill = this.#tx.filter((t) => t.accountId === card && t.type === 'expense' && t.date > prev && t.date <= st).reduce((s, t) => s + t.amount, 0);
      const payOn = SampleBook.#addDays(st, 15);
      if (bill > 0 && payOn < this.#today) this.#transfer('bank', 'card', bill, payOn, 'Credit card bill');
      prev = st;
    }
  }

  // ── Budgets and habits ──────────────────────────────────────────────

  #budgets() {
    const b = (cats, amount, period, x = {}) => ({ id: IdGenerator.generate('bg'), categoryIds: cats.map((c) => this.#cat(c)), categoryId: this.#cat(cats[0]),
      amount, currency: 'INR', period, rollover: false, alerts: true, ...x });
    const tripStart = SampleBook.#addDays(this.#today, 12);
    return [
      b(['Food & Drink'], 1800000, 'gregorian'),
      b(['Shopping'], 600000, 'gregorian'),
      b(['Transport'], 900000, 'gregorian', { rollover: true, rolloverCap: 300000 }),
      b(['Bills'], 650000, 'gregorian'),
      b(['Eating out'], 220000, 'week'),
      b(['Education'], 2500000, 'year'),
      b(['Health'], 400000, 'hijri'),
      b(['Travel'], 4000000, 'range', { startDate: tripStart, endDate: SampleBook.#addDays(tripStart, 5) }),
    ];
  }

  #habits() {
    return [
      { id: IdGenerator.generate('hb'), name: 'Food delivery', icon: 'bike', color: '#f97316', words: ['swiggy', 'zomato'], categoryIds: [], itemIds: [], limitCount: 10 },
      { id: IdGenerator.generate('hb'), name: 'Cabs & autos', icon: 'car-taxi-front', color: '#3b82f6', words: [], categoryIds: [this.#cat('Cabs & autos')], itemIds: [this.#ids.auto], limitAmount: 250000 },
    ];
  }

  // ── Settings ────────────────────────────────────────────────────────

  static #user() {
    return {
      homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'system', showHijri: true, calendarMode: 'both', dateFormat: 'auto',
      defaultAccountId: '', defaultPaymentType: 'upi', geminiApiKey: '', supabaseUrl: '', supabaseKey: '',
      customPaymentTypes: [], hiddenPaymentTypes: [], collapsedAccountGroups: [], collapsedCategories: [],
    };
  }

  // ── Small helpers ───────────────────────────────────────────────────

  #ago(n) { return SampleBook.#addDays(this.#today, -n); }
  #int(lo, hi) { return lo + Math.floor(this.#rand() * (hi - lo + 1)); }
  /** Whole rupees between lo and hi, in paise. */
  #money(lo, hi) { return this.#int(lo, hi) * 100; }
  #pick(list) { return list[Math.floor(this.#rand() * list.length)]; }

  static #addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  static #weekday(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
  static #dayOf(iso) { return Math.min(28, Number(iso.slice(8, 10))); }
  static #monthEnd(iso) { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }

  /** A small fixed-seed generator (mulberry32), so the sample is the same each time. */
  static #seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}

/** Short date ranges for notes, e.g. "1–31 Oct". */
class DateRangeText {
  static #M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  static range(from, to) {
    const [, fm, fd] = from.split('-').map(Number);
    const [, tm, td] = to.split('-').map(Number);
    return fm === tm ? `${fd}–${td} ${DateRangeText.#M[tm - 1]}` : `${fd} ${DateRangeText.#M[fm - 1]} – ${td} ${DateRangeText.#M[tm - 1]}`;
  }
}
