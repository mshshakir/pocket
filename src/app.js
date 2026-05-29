/**
 * app.js — Application root.
 *
 * Wires every layer together (core, domain, UI) into a single Application
 * singleton.  Exposes the window.__app dispatch surface that all HTML onclick
 * handlers call.  Nothing outside this file mutates global state directly.
 */

// ── Core infrastructure ──────────────────────────────────────────────────────
import { Store }      from './core/Store.js';
import { EventBus }   from './core/EventBus.js';
import { Router }     from './core/Router.js';

// ── Data ─────────────────────────────────────────────────────────────────────
import { SeedFactory } from './data/seed.js';
import {
  FX, MEMBER_COLORS, ACCOUNT_TYPE_ICONS,
} from './data/constants.js';

// ── Domain services ──────────────────────────────────────────────────────────
import { IdGenerator }         from './domain/services/IdGenerator.js';
import { CurrencyService }     from './domain/services/CurrencyService.js';
import { HijriCalendarService }from './domain/services/HijriCalendarService.js';
import { AccountService }      from './domain/services/AccountService.js';
import { CategoryService }     from './domain/services/CategoryService.js';
import { TransactionService }  from './domain/services/TransactionService.js';
import { BudgetService }       from './domain/services/BudgetService.js';
import { RecurringService }    from './domain/services/RecurringService.js';
import { SyncService }         from './domain/services/SyncService.js';

// ── UI components ────────────────────────────────────────────────────────────
import { Toast }      from './ui/components/Toast.js';
import { Modal }      from './ui/components/Modal.js';
import { Navigation } from './ui/components/Navigation.js';

// ── Views ─────────────────────────────────────────────────────────────────────
import { DashboardView }     from './ui/views/DashboardView.js';
import { TransactionsView }  from './ui/views/TransactionsView.js';
import { AccountsView }      from './ui/views/AccountsView.js';
import { AccountDetailView } from './ui/views/AccountDetailView.js';
import { BudgetsView }       from './ui/views/BudgetsView.js';
import { CategoriesView }    from './ui/views/CategoriesView.js';
import { ReportsView }       from './ui/views/ReportsView.js';
import { DebtsView }         from './ui/views/DebtsView.js';
import { CalendarView }      from './ui/views/CalendarView.js';
import { FamilyView }        from './ui/views/FamilyView.js';

// ── Modals ─────────────────────────────────────────────────────────────────────
import { TransactionModal } from './ui/modals/TransactionModal.js';
import { AccountModal }     from './ui/modals/AccountModal.js';
import { CategoryModal }    from './ui/modals/CategoryModal.js';
import { BudgetModal }      from './ui/modals/BudgetModal.js';
import { SettingsModal }    from './ui/modals/SettingsModal.js';
import { CsvModal }         from './ui/modals/CsvModal.js';
import { DebtModal }        from './ui/modals/DebtModal.js';
import { FamilyModal }      from './ui/modals/FamilyModal.js';
import { AuthModal }        from './ui/modals/AuthModal.js';
import { RegularItemModal } from './ui/modals/RegularItemModal.js';

// ─────────────────────────────────────────────────────────────────────────────
// CSV import constants (kept local — not re-exported)
// ─────────────────────────────────────────────────────────────────────────────
const ACCOUNT_TYPE_KEYWORDS = {
  cash:    ['cash','wallet','pocket','petty'],
  card:    ['credit','card','visa','mastercard','amex','american express','discover','platinum'],
  savings: ['savings','save','hys','high-yield','reserve','emergency','rainy day'],
  invest:  ['invest','ira','roth','401k','brokerage','stocks','crypto'],
  bank:    [],
};
const CATEGORY_KEYWORD_DEFAULTS = [
  { keys:['food','drink','grocery','restaurant','dining','meal','cafe','coffee','snack','pizza','burger'], icon:'utensils', color:'#f97316' },
  { keys:['transport','transit','uber','lyft','taxi','gas','fuel','car','metro','bus','train','flight','travel'], icon:'car', color:'#3b82f6' },
  { keys:['shop','clothing','retail','amazon','walmart','store','apparel'], icon:'shopping-bag', color:'#ec4899' },
  { keys:['health','medical','pharmacy','doctor','dental','hospital','vitamin'], icon:'heart-pulse', color:'#ef4444' },
  { keys:['housing','rent','mortgage','home','maintenance'], icon:'home', color:'#a16207' },
  { keys:['entertainment','movies','netflix','spotify','games','disney','concert','music'], icon:'film', color:'#8b5cf6' },
  { keys:['bills','utility','utilities','electric','internet','wifi','phone','water'], icon:'receipt', color:'#0891b2' },
  { keys:['education','school','tuition','book','course'], icon:'graduation-cap', color:'#10b981' },
  { keys:['salary','payroll','wage','income','paycheck'], icon:'banknote', color:'#22c55e' },
  { keys:['freelance','contract','gig','consulting'], icon:'briefcase', color:'#14b8a6' },
  { keys:['savings','save','deposit'], icon:'landmark', color:'#06b6d4' },
  { keys:['transfer'], icon:'arrow-right-left', color:'#737373' },
  { keys:['gift','present'], icon:'gift', color:'#d946ef' },
  { keys:['fitness','gym','sport','workout'], icon:'dumbbell', color:'#84cc16' },
  { keys:['baby','child','kid','daycare'], icon:'baby', color:'#fb7185' },
  { keys:['pet','dog','cat','vet'], icon:'paw-print', color:'#d97706' },
];

// ─────────────────────────────────────────────────────────────────────────────

export class Application {
  // ── Singleton ──────────────────────────────────────────────────────────────
  static #instance = null;

  static getInstance() {
    if (!Application.#instance) Application.#instance = new Application();
    return Application.#instance;
  }

  // ── Core ───────────────────────────────────────────────────────────────────
  /** @type {Store}    */ #store;
  /** @type {EventBus} */ #bus;
  /** @type {Router}   */ #router;

  // ── Domain services ────────────────────────────────────────────────────────
  /** @type {CurrencyService}      */ #fx;
  /** @type {HijriCalendarService} */ #hijri;
  /** @type {AccountService}       */ #accounts;
  /** @type {CategoryService}      */ #categories;
  /** @type {TransactionService}   */ #transactions;
  /** @type {BudgetService}        */ #budgets;
  /** @type {RecurringService}     */ #recurring;
  /** @type {SyncService}          */ #sync;

  // ── UI components ──────────────────────────────────────────────────────────
  /** @type {Toast}      */ #toast;
  /** @type {Modal}      */ #modal;
  /** @type {Navigation} */ #nav;

  // ── Views (lazy-created on first navigate) ─────────────────────────────────
  #views = /** @type {Map<string,object>} */ (new Map());

  // ── Modals (registered instances) ─────────────────────────────────────────
  #txModal     = null;  // TransactionModal — kept for split-state access
  #familyModal = null;  // FamilyModal — kept for pendingPerms access
  #debtModal   = null;  // DebtModal — kept for payment-mode routing

  // ── Per-session UI state ──────────────────────────────────────────────────
  #reportRange    = '30';
  #importPlan     = null;
  #swipeTxId      = null;
  #swipeStartX    = 0;
  #swipeDeltaX    = 0;

  // ── Private constructor (use getInstance()) ────────────────────────────────
  constructor() {
    if (Application.#instance) throw new Error('Use Application.getInstance()');
    this.#store       = Store.getInstance();
    this.#bus         = EventBus.getInstance();
    this.#router      = Router.getInstance();
    this.#fx          = new CurrencyService();
    this.#hijri       = new HijriCalendarService();
    this.#accounts    = new AccountService();
    this.#categories  = new CategoryService();
    this.#transactions= new TransactionService();
    this.#budgets     = new BudgetService();
    this.#recurring   = new RecurringService();
    this.#sync        = new SyncService();
    this.#toast       = new Toast();
    this.#modal       = new Modal();
    this.#nav         = new Navigation();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Initialisation
  // ──────────────────────────────────────────────────────────────────────────

  /** Boot the application. Call once after DOMContentLoaded. */
  async init() {
    // 1. Load or seed state
    this.#store.init(() => SeedFactory.create());
    this.#ensureUserDefaults();

    // 2. Process any missed recurring items
    this.#recurring.process();

    // 3. Apply saved theme immediately (before first render)
    this.#applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this.#store.getState().user.theme === 'system') this.#applyTheme();
    });

    // 4. Expose dispatch surface early so onclick handlers work from first render
    window.__app = this;

    // 5. Mount UI components
    const container = document.getElementById('app');
    this.#toast.mount(container);
    this.#modal.mount(container);
    this.#nav.mount({
      onNavigate: (id) => this.navigate(id),
      onAdd:      ()   => this.openModal('transaction', {}),
      onMore:     ()   => this.openModal('more', {}),
    });

    // 6. Register all modals
    this.#txModal     = new TransactionModal();
    this.#familyModal = new FamilyModal();
    this.#debtModal   = new DebtModal();
    this.#modal.register('transaction',  this.#txModal);
    this.#modal.register('account',      new AccountModal());
    this.#modal.register('category',     new CategoryModal());
    this.#modal.register('budget',       new BudgetModal());
    this.#modal.register('settings',     new SettingsModal());
    this.#modal.register('csv',          new CsvModal());
    this.#modal.register('debt',         this.#debtModal);
    this.#modal.register('debtPayment',  this.#debtModal);
    this.#modal.register('familyMember', this.#familyModal);
    this.#modal.register('auth',         new AuthModal());
    this.#modal.register('regularItem',  new RegularItemModal());

    // 7. Subscribe to events
    // route:changed → only re-render the view panel (not the whole shell)
    this.#bus.on('route:changed', ({ route }) => this.#renderView(route));
    this.#bus.on('toast',         ({ message }) => this.#toast.show(message));
    // state:changed fires after pull/replaceState completes — full re-render
    this.#bus.on('state:changed',  () => this.#render());
    // auth:changed → only update the auth pill + nav; full re-render happens
    // after restoreSession() resolves (via .then(#render)) to avoid showing
    // seed data briefly before the cloud pull completes
    this.#bus.on('auth:changed', ({ user }) => {
      this.#nav.renderAuthPill(user ?? null);
      if (!user) this.#render(); // sign-out: show seed/default data immediately
    });

    // 8. Initial render (shows locally-cached or seed data while Supabase loads)
    this.#render();

    // 9. Init Supabase — restores session, pulls cloud data, then re-renders
    if (this.#sync.init()) {
      this.#sync.restoreSession().then(() => this.#render());
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────────────────────

  navigate(id) {
    if (id === '__add')  return this.openModal('transaction', {});
    if (id === '__more') return this.#openMoreMenu();
    this.#router.navigate(id);
    this.#render();
  }

  /** Open a bottom-sheet "More" menu showing nav items not in the mobile tab bar. */
  #openMoreMenu() {
    const MORE_ITEMS = [
      { id: 'accounts',   label: 'Accounts',          icon: 'wallet'         },
      { id: 'budgets',    label: 'Budgets',            icon: 'target'         },
      { id: 'debts',      label: 'Debts',              icon: 'hand-coins'     },
      { id: 'categories', label: 'Categories',         icon: 'tags'           },
      { id: 'reports',    label: 'Reports',            icon: 'pie-chart'      },
      { id: 'family',     label: 'Family',             icon: 'users'          },
    ];
    const items = MORE_ITEMS.map((n) => `
      <button type="button"
              onclick="window.__app.closeModal();window.__app.navigate('${n.id}')"
              class="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl
                     bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700
                     transition-colors text-zinc-700 dark:text-zinc-200">
        <i data-lucide="${n.icon}" style="width:24px;height:24px"></i>
        <span class="text-xs font-medium">${n.label}</span>
      </button>`).join('');

    this.#modal.open('_raw', {
      html: `
        <div class="p-5" style="min-width:320px;max-width:420px">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-base font-semibold">More</h3>
            <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">
              <i data-lucide="x"></i>
            </button>
          </div>
          <div class="grid grid-cols-3 gap-3">
            ${items}
          </div>
        </div>`,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Modal operations
  // ──────────────────────────────────────────────────────────────────────────

  openModal(name, opts = {}) {
    // debtPayment needs to route to DebtModal in payment mode
    if (name === 'debtPayment') {
      this.#modal.open('debtPayment', { ...opts, mode: 'payment' });
    } else {
      this.#modal.open(name, opts);
    }
    lucide?.createIcons?.();
  }

  closeModal() {
    this.#modal.close();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Sync helpers (exposed to modals / nav)
  // ──────────────────────────────────────────────────────────────────────────

  isManagedMode() { return this.#sync.isManagedMode(); }
  getSbUser()     { return this.#sync.getSbUser?.() ?? null; }

  async signInWithGoogle() { await this.#sync.signInWithGoogle(); }
  async signOut()          { await this.#sync.signOut(); this.#render(); }

  setSbUrl(v) {
    const s = this.#store.getState();
    s.user.supabaseUrl = v;
    this.#store.persist();
  }

  setSbKey(v) {
    const s = this.#store.getState();
    s.user.supabaseKey = v;
    this.#store.persist();
  }

  connectSupabase() {
    if (this.#sync.init()) {
      this.#toast.show('Supabase connected — sign in to sync');
      this.openModal('auth', {});
    } else {
      this.#toast.show('Invalid URL or key');
    }
  }

  copySql() {
    const el = document.querySelector('.js-sql-block');
    if (!el) return;
    navigator.clipboard.writeText(el.textContent).then(() => this.#toast.show('SQL copied'));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Settings mutations
  // ──────────────────────────────────────────────────────────────────────────

  setHomeCurrency(v) {
    this.#store.getState().user.homeCurrency = v;
    this.#store.persist();
    this.closeModal(); this.#render();
    this.#toast.show('Home currency: ' + v);
  }

  setDefaultCurrency(v) {
    this.#store.getState().user.defaultCurrency = v;
    this.#store.persist();
    this.closeModal(); this.#render();
    this.#toast.show('Default currency: ' + v);
  }

  setDateFormat(v) {
    this.#store.getState().user.dateFormat = v;
    this.#store.persist();
    this.closeModal(); this.#render();
    this.#toast.show('Date format: ' + v);
  }

  setTheme(v) {
    this.#store.getState().user.theme = v;
    this.#store.persist();
    this.#applyTheme();
    this.closeModal(); this.#render();
  }

  toggleHijri() {
    const u = this.#store.getState().user;
    u.showHijri = !u.showHijri;
    this.#store.persist();
    this.closeModal(); this.#render();
  }

  setCalendarMode(v) {
    this.#store.getState().user.calendarMode = v;
    this.#store.persist();
    // Re-open settings so the new selection is reflected
    this.openModal('settings', {});
    this.#render();
  }

  setGeminiKey(v) {
    this.#store.getState().user.geminiApiKey = v;
    this.#store.persist();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Transaction CRUD
  // ──────────────────────────────────────────────────────────────────────────

  async submitTx(event, id) {
    event.preventDefault();
    const fd   = new FormData(event.target);
    const data = Object.fromEntries(fd.entries());
    const state= this.#store.getState();

    // ── Shared-account contribution mode ──────────────────────────────────
    // When a family member adds/edits a tx in a shared account, send it to
    // the owner via family_contributions instead of saving locally.
    const sharedMode = this.#txModal?.sharedTxMode;
    if (sharedMode && !id) {
      const currency  = data.currency;
      const minor     = this.#fx.toMinor(data.amount, currency);
      const sharedAcc = this.#sync.sharedData?.[sharedMode.shareIndex];
      if (!sharedAcc?._ownerId) return this.#toast.show('Shared account not found');
      const tx = {
        id:          IdGenerator.generate('tx'),
        accountId:   sharedMode.accountId || data.accountId,
        categoryId:  data.categoryId || null,
        amount:      minor,
        currency,
        exchangeRate: (FX[currency] || 1) / (FX[state.user.homeCurrency] || 1),
        refAmount:   this.#fx.convert(minor, currency, state.user.homeCurrency),
        payee:       data.payee || '',
        note:        data.note || '',
        date:        data.date,
        type:        data.type || 'expense',
        paymentType: data.paymentType || 'card',
        recordState: 'cleared',
        createdAt:   new Date().toISOString(),
        addedBy:     this.#sync.getSbUser?.()?.email || null,
      };
      try {
        await this.#sync.submitContribution(sharedAcc._ownerId, tx);
        this.closeModal();
        this.#toast.show('Transaction submitted to owner');
      } catch (e) {
        this.#toast.show('Failed to submit: ' + (e.message || e));
      }
      return;
    }

    const currency = data.currency;
    const minor    = this.#fx.toMinor(data.amount, currency);
    const exchRate = (FX[currency] || 1) / (FX[state.user.homeCurrency] || 1);
    const refAmt   = this.#fx.convert(minor, currency, state.user.homeCurrency);

    // Cross-currency transfer rate
    let xfer = null;
    if (data.type === 'transfer') {
      if (!data.accountId || !data.transferToAccountId || data.accountId === data.transferToAccountId) {
        return this.#toast.show('Pick two different accounts');
      }
      const toAcc = state.accounts.find((a) => a.id === data.transferToAccountId);
      if (!toAcc) return this.#toast.show('Pick a destination account');
      const toCcy  = toAcc.currency;
      let rate = Number(data.transferRate);
      if (!isFinite(rate) || rate <= 0) rate = (FX[toCcy] || 1) / (FX[currency] || 1);
      const dstMinor = currency === toCcy ? minor
        : this.#fx.toMinor(this.#fx.fromMinor(minor, currency) * rate, toCcy);
      xfer = { rate, toCcy, dstMinor };
    }

    // Splits
    let splits = null;
    const modal = this.#txModal;
    if (modal?.splitsEnabled && data.type !== 'transfer') {
      const currentSplits = modal.splits || [];
      const cleaned = [];
      for (let i = 0; i < currentSplits.length; i++) {
        const cv  = fd.get(`split_cat_${i}`);
        const ac  = fd.get(`split_acc_${i}`);
        const av  = fd.get(`split_amt_${i}`);
        const amt = this.#fx.toMinor(Number(av || 0), currency);
        if (amt > 0) cleaned.push({ categoryId: cv || null, accountId: ac || data.accountId, amount: amt });
      }
      if (!cleaned.length) return this.#toast.show('Add at least one split with an amount');
      const sum = cleaned.reduce((s, x) => s + x.amount, 0);
      if (Math.abs(sum - minor) > 1) {
        return this.#toast.show(
          `Splits must add up to ${this.#fx.formatMoney(minor, currency)} (currently ${this.#fx.formatMoney(sum, currency)})`,
        );
      }
      splits = cleaned;
      data.accountId = splits[0].accountId;
    }

    // Recurring rule
    let recurring = null;
    if (data.type !== 'transfer' && fd.get('recurringEnabled')) {
      recurring = {
        rule:     fd.get('recurringRule') || 'monthly',
        interval: Math.max(1, Number(fd.get('recurringInterval')) || 1),
        until:    fd.get('recurringUntil') || null,
      };
    }

    if (id) {
      // Edit existing
      const tx = state.transactions.find((x) => x.id === id);
      if (!tx) return;
      if (data.type === 'transfer' && tx.type === 'transfer' && tx.transferPairId) {
        const pair = state.transactions.find((x) => x.id === tx.transferPairId);
        // Revert both legs
        const fa0 = state.accounts.find((a) => a.id === tx.accountId);
        if (fa0) fa0.balance += this.#fx.convert(tx.amount, tx.currency, fa0.currency);
        if (pair) {
          const ta0 = state.accounts.find((a) => a.id === pair.accountId);
          if (ta0) ta0.balance -= this.#fx.convert(pair.amount, pair.currency, ta0.currency);
        }
        Object.assign(tx, {
          accountId: data.accountId, categoryId: null,
          amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
          payee: data.payee || 'Transfer', note: data.note, date: data.date,
          paymentType: 'transfer', type: 'transfer', splits: null,
          transferRate: xfer?.rate ?? null, transferDir: 'out',
        });
        if (pair) {
          Object.assign(pair, {
            accountId: data.transferToAccountId, categoryId: null,
            amount: xfer ? xfer.dstMinor : minor,
            currency: xfer ? xfer.toCcy : currency,
            exchangeRate: ((FX[xfer?.toCcy || currency] || 1)) / ((FX[state.user.homeCurrency] || 1)),
            refAmount: this.#fx.convert(xfer ? xfer.dstMinor : minor, xfer ? xfer.toCcy : currency, state.user.homeCurrency),
            payee: data.payee || 'Transfer', note: data.note, date: data.date,
            paymentType: 'transfer', type: 'transfer', splits: null,
            transferRate: xfer?.rate ?? null, transferDir: 'in',
          });
        }
        const fa1 = state.accounts.find((a) => a.id === tx.accountId);
        if (fa1) fa1.balance -= this.#fx.convert(tx.amount, tx.currency, fa1.currency);
        if (pair) {
          const ta1 = state.accounts.find((a) => a.id === pair.accountId);
          if (ta1) ta1.balance += this.#fx.convert(pair.amount, pair.currency, ta1.currency);
        }
      } else {
        this.#revertBalances(tx, state);
        Object.assign(tx, {
          accountId: data.accountId,
          categoryId: splits ? null : (data.categoryId || null),
          amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
          payee: data.payee, note: data.note, date: data.date,
          paymentType: data.paymentType, type: data.type,
          splits, recurring,
        });
        this.#applyBalances(tx, state);
      }
    } else {
      // New transaction
      if (data.type === 'transfer') {
        const fromId = IdGenerator.generate('tx');
        const toId   = IdGenerator.generate('tx');
        const toCcy  = xfer?.toCcy ?? currency;
        const dst    = xfer?.dstMinor ?? minor;
        const now    = new Date().toISOString();
        const txFrom = {
          id: fromId, accountId: data.accountId, categoryId: null,
          amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
          payee: data.payee || 'Transfer', note: data.note, date: data.date,
          paymentType: 'transfer', recordState: 'cleared', type: 'transfer',
          transferPairId: toId, transferRate: xfer?.rate ?? null, transferDir: 'out', tags: [],
          createdAt: now, addedBy: this.#sync.getSbUser?.()?.email || null,
        };
        const txTo = {
          id: toId, accountId: data.transferToAccountId, categoryId: null,
          amount: dst, currency: toCcy,
          exchangeRate: ((FX[toCcy] || 1)) / ((FX[state.user.homeCurrency] || 1)),
          refAmount: this.#fx.convert(dst, toCcy, state.user.homeCurrency),
          payee: data.payee || 'Transfer', note: data.note, date: data.date,
          paymentType: 'transfer', recordState: 'cleared', type: 'transfer',
          transferPairId: fromId, transferRate: xfer?.rate ?? null, transferDir: 'in', tags: [],
          createdAt: now, addedBy: this.#sync.getSbUser?.()?.email || null,
        };
        state.transactions.push(txFrom, txTo);
        const fa = state.accounts.find((a) => a.id === data.accountId);
        if (fa) fa.balance -= this.#fx.convert(minor, currency, fa.currency);
        const ta = state.accounts.find((a) => a.id === data.transferToAccountId);
        if (ta) ta.balance += this.#fx.convert(dst, toCcy, ta.currency);
      } else {
        const tx = {
          id: IdGenerator.generate('tx'),
          accountId: data.accountId,
          categoryId: splits ? null : (data.categoryId || null),
          amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
          payee: data.payee, note: data.note, date: data.date,
          paymentType: data.paymentType, recordState: 'cleared', type: data.type,
          transferPairId: null, tags: [], splits, recurring,
          createdAt: new Date().toISOString(),
          addedBy: this.#sync.getSbUser?.()?.email || null,
        };
        state.transactions.push(tx);
        this.#applyBalances(tx, state);
        if (data.payee && !splits && data.categoryId) {
          if (!state.merchantCategories) state.merchantCategories = {};
          state.merchantCategories[data.payee.toLowerCase()] = data.categoryId;
        }
      }
    }

    if (recurring) this.#recurring.process();
    this.#store.persist();
    this.closeModal();
    this.#render();
    this.#toast.show(id ? 'Transaction updated' : 'Transaction added');
    this.#sync.schedulePush?.();
  }

  deleteTx(id) {
    if (!confirm('Delete this transaction?')) return;
    const state = this.#store.getState();
    const tx    = state.transactions.find((x) => x.id === id);
    if (!tx) return;
    if (tx.type === 'transfer' && tx.transferPairId) {
      const pair = state.transactions.find((x) => x.id === tx.transferPairId);
      if (pair) {
        const fa = state.accounts.find((a) => a.id === tx.accountId);
        if (fa) fa.balance += this.#fx.convert(tx.amount, tx.currency, fa.currency);
        const ta = state.accounts.find((a) => a.id === pair.accountId);
        if (ta) ta.balance -= this.#fx.convert(pair.amount, pair.currency, ta.currency);
        state.transactions = state.transactions.filter((x) => x.id !== pair.id);
      }
    } else {
      this.#revertBalances(tx, state);
    }
    state.transactions = state.transactions.filter((x) => x.id !== id);
    this.#store.persist();
    this.closeModal();
    this.#render();
    this.#toast.show('Transaction deleted');
    this.#sync.schedulePush?.();
  }

  // Bulk delete — collects selectedIds from whichever view is active
  bulkDeleteTx() {
    const view = this.#views.get(this.#router.current);
    const ids  = view?.selectedIds ?? new Set();
    if (!ids.size) return;
    if (!confirm(`Delete ${ids.size} transaction${ids.size === 1 ? '' : 's'}?`)) return;
    const state = this.#store.getState();
    ids.forEach((id) => {
      const tx = state.transactions.find((x) => x.id === id);
      if (!tx) return;
      if (tx.type === 'transfer' && tx.transferPairId) {
        const pair = state.transactions.find((x) => x.id === tx.transferPairId);
        if (pair) {
          const fa = state.accounts.find((a) => a.id === tx.accountId);
          if (fa) fa.balance += this.#fx.convert(tx.amount, tx.currency, fa.currency);
          const ta = state.accounts.find((a) => a.id === pair.accountId);
          if (ta) ta.balance -= this.#fx.convert(pair.amount, pair.currency, ta.currency);
          state.transactions = state.transactions.filter((x) => x.id !== pair.id);
        }
      } else {
        this.#revertBalances(tx, state);
      }
      state.transactions = state.transactions.filter((x) => x.id !== id);
    });
    if (view?.clearMultiSelect) view.clearMultiSelect();
    this.#store.persist();
    this.#render();
    this.#toast.show(`${ids.size} transactions deleted`);
    this.#sync.schedulePush?.();
  }

  // Shared (family) tx ops — delegate to SyncService
  async deleteSharedTx(shareIndex, txId) {
    await this.#sync.deleteSharedTx?.(shareIndex, txId);
    this.#render();
  }

  openSharedTxModal(shareIndex, accountId) {
    this.openModal('transaction', { sharedTxMode: { shareIndex, accountId } });
  }

  openSharedTxEdit(shareIndex, accountId, txId) {
    this.openModal('transaction', { sharedTxMode: { shareIndex, accountId, editTxId: txId } });
  }

  // ── Multi-select (Transactions view) ────────────────────────────────────

  toggleMultiSelect() {
    const v = this.#views.get('transactions');
    v?.toggleMultiSelect?.();
    this.#render();
  }

  selectAllTx() {
    const v = this.#views.get('transactions');
    v?.selectAll?.();
    this.#render();
  }

  deselectAllTx() {
    const v = this.#views.get('transactions');
    v?.deselectAll?.();
    this.#render();
  }

  toggleTxSelection(id) {
    const v = this.#views.get('transactions');
    v?.toggleSelection?.(id);
    this.#render();
  }

  // ── Multi-select (Account detail view) ──────────────────────────────────

  toggleAccountMultiSelect() {
    const v = this.#views.get('accounts');
    v?.toggleMultiSelect?.();
    this.#render();
  }

  selectAllAccTx() {
    const v = this.#views.get('accounts');
    v?.selectAll?.();
    this.#render();
  }

  deselectAllAccTx() {
    const v = this.#views.get('accounts');
    v?.deselectAll?.();
    this.#render();
  }

  bulkDeleteAccTx() {
    const v = this.#views.get('accounts');
    if (!v) return;
    const ids = v.selectedIds ?? new Set();
    if (!ids.size) return;
    if (!confirm(`Delete ${ids.size} transaction${ids.size === 1 ? '' : 's'}?`)) return;
    const state = this.#store.getState();
    ids.forEach((id) => {
      const tx = state.transactions.find((x) => x.id === id);
      if (!tx) return;
      this.#revertBalances(tx, state);
      state.transactions = state.transactions.filter((x) => x.id !== id);
    });
    v.clearMultiSelect?.();
    this.#store.persist();
    this.#render();
    this.#toast.show(`${ids.size} transactions deleted`);
    this.#sync.schedulePush?.();
  }

  // ── Transaction filters ──────────────────────────────────────────────────

  txFilterToggle(field, value) {
    const v = this.#views.get('transactions');
    v?.toggleFilterItem?.(field, value);
    this.#render();
  }

  txFilterSet(key, value) {
    const v = this.#views.get('transactions');
    v?.setFilter?.(key, value);
    this.#render();
  }

  txFilterSetRange(from, to) {
    const v = this.#views.get('transactions');
    v?.setFilter?.('dateFrom', from);
    v?.setFilter?.('dateTo', to);
    v?.setFilter?.('range', 'custom');
    this.#render();
  }

  /**
   * Clear transaction filters.
   * @param {'dates'|'amounts'|undefined} group  Omit to clear everything.
   */
  txFilterClear(group) {
    const v = this.#views.get('transactions');
    if (!v) return;
    if (group === 'dates') {
      v.setFilter?.('dateFrom', '');
      v.setFilter?.('dateTo', '');
    } else if (group === 'amounts') {
      v.setFilter?.('amountMin', '');
      v.setFilter?.('amountMax', '');
    } else {
      v.clearFilters?.();
    }
    this.#render();
  }

  /** Alias used by "Clear all filters" buttons in TransactionsView. */
  clearTxFilters() { this.txFilterClear(); }

  toggleTxFilterPanel() {
    const v = this.#views.get('transactions');
    v?.toggleFilterPanel?.();
    this.#render();
  }

  // ── Transaction modal helpers ────────────────────────────────────────────

  toggleSplits() {
    this.#txModal?.toggleSplits?.();
    this.#modal.refresh();
    lucide?.createIcons?.();
  }

  addSplit() {
    this.#txModal?.addSplit?.();
    this.#modal.refresh();
    lucide?.createIcons?.();
  }

  removeSplit(i) {
    this.#txModal?.removeSplit?.(i);
    this.#modal.refresh();
    lucide?.createIcons?.();
  }

  setSplitAmount(i, val, currency) { this.#txModal?.setSplitAmount?.(i, val, currency); }
  setSplitField(i, field, val) { this.#txModal?.setSplitField?.(i, field, val); }

  setTxType(type) {
    this.#txModal?.setType?.(type);
    this.#modal.refresh();
    lucide?.createIcons?.();
  }

  toggleRecurringFields() {
    const el = document.getElementById('recurringFields');
    const inp = document.getElementById('recurringEnabled');
    if (el && inp) el.classList.toggle('hidden', !inp.checked);
  }

  updateHijriPreview(iso) {
    const el = document.getElementById('hijriDatePreview');
    if (!el || !iso) return;
    try {
      const state = this.#store.getState();
      if (!state.user.showHijri) { el.textContent = ''; return; }
      const h = this.#hijri.toHijri(new Date(iso));
      el.textContent = `${h.day} ${this.#hijri.monthsLong()[h.month - 1]} ${h.year}`;
    } catch { el.textContent = ''; }
  }

  /**
   * Refresh the transfer FX panel.
   * @param {boolean} userChangedRate  true when the user manually edited the rate field;
   *                                   false (default) means auto-fill rate from FX table.
   * Called by TransactionModal with false on account/amount change, true on rate input.
   */
  updateTransferFxPanel(userChangedRate = false) {
    const panel = document.getElementById('fxPanel');
    if (!panel) return;

    // Resolve currencies from the form's account selects
    const state    = this.#store.getState();
    const fromAccId = document.querySelector('[name=accountId]')?.value;
    const toAccId   = document.querySelector('[name=transferToAccountId]')?.value;
    const fromAcc   = state.accounts.find((a) => a.id === fromAccId);
    const toAcc     = state.accounts.find((a) => a.id === toAccId);

    if (!fromAcc || !toAcc || fromAcc.currency === toAcc.currency) {
      panel.style.display = 'none';
      return;
    }

    panel.style.display = '';
    const fromCcy  = fromAcc.currency;
    const toCcy    = toAcc.currency;
    const autoRate = (FX[toCcy] || 1) / (FX[fromCcy] || 1);

    const rateInp = document.getElementById('fxRate');
    if (!userChangedRate || !(parseFloat(rateInp?.value) > 0)) {
      if (rateInp) rateInp.value = autoRate.toFixed(6);
    }

    const rate    = parseFloat(rateInp?.value) || autoRate;
    const fromAmt = parseFloat(document.querySelector('[name=amount]')?.value) || 0;
    const toAmt   = fromAmt * rate;

    const fromCcyEl  = document.getElementById('fxFromCcy');
    const toCcyEl    = document.getElementById('fxToCcy');
    const toAmtEl    = document.getElementById('fxToAmount');
    const rateNoteEl = document.getElementById('fxRateNote');

    if (fromCcyEl)  fromCcyEl.textContent  = fromCcy;
    if (toCcyEl)    toCcyEl.textContent    = toCcy;
    if (toAmtEl)    toAmtEl.textContent    = this.#fx.formatMoney(this.#fx.toMinor(toAmt, toCcy), toCcy);
    if (rateNoteEl) rateNoteEl.textContent = `Auto: 1 ${fromCcy} = ${autoRate.toFixed(4)} ${toCcy}`;
  }

  resetTransferFx() {
    const state    = this.#store.getState();
    const toAccId  = document.querySelector('[name=transferToAccountId]')?.value;
    const fromAccId = document.querySelector('[name=accountId]')?.value;
    const fromAcc  = state.accounts.find((a) => a.id === fromAccId);
    const toAcc    = state.accounts.find((a) => a.id === toAccId);
    if (!fromAcc || !toAcc || fromAcc.currency === toAcc.currency) return;
    const rateInp = document.getElementById('fxRate');
    if (rateInp) {
      rateInp.value = ((FX[toAcc.currency] || 1) / (FX[fromAcc.currency] || 1)).toFixed(6);
    }
    this.updateTransferFxPanel(false);
  }

  onTxAccountChange(sel) {
    const state  = this.#store.getState();
    const acc    = state.accounts.find((a) => a.id === sel?.value);
    const curEl  = document.querySelector('[name=currency]');
    if (curEl && acc) curEl.value = acc.currency;
  }

  suggestCategory(payee) {
    const state = this.#store.getState();
    const key   = (payee || '').toLowerCase();
    const catId = state.merchantCategories?.[key];
    if (!catId) return;
    const sel = document.querySelector('[name=categoryId]');
    if (sel) sel.value = catId;
  }

  async scanReceipt(input) {
    const file = input?.files?.[0];
    if (!file) return;
    const key = this.#store.getState().user.geminiApiKey;
    if (!key) return this.#toast.show('Add a Gemini API key in Settings first');
    this.#toast.show('Scanning receipt…');
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const state     = this.#store.getState();
      const catNames  = state.categories
        .filter((c) => c.type === 'expense' || !c.type)
        .map((c) => c.name)
        .join(', ');
      const prompt = [
        'You are a receipt parser. Extract every line item from this receipt image.',
        'Return ONLY a valid JSON array — no markdown, no code fences, nothing else.',
        'Each element must have these exact fields:',
        '  description: string — item name',
        '  amount: number — in MAJOR currency units with decimal (e.g. 4.99, not 499)',
        '  currency: string — ISO 4217 code (e.g. "USD", "PKR"). Detect from receipt or use "' + (state.user.homeCurrency || 'USD') + '".',
        '  categoryName: string — pick the single best match from this list: [' + (catNames || 'Food, Transport, Shopping') + ']. Use null if none fit.',
        '  quantity: string — quantity with unit if visible (e.g. "2x", "500ml", "1kg"), else null',
        '  note: string — any extra details like size, variant, or pack info visible on the receipt, else null',
      ].join('\n');

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inlineData: { mimeType: file.type || 'image/jpeg', data: base64 } },
              ],
            }],
          }),
        },
      );
      const json = await resp.json();
      const raw  = json.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      const items = JSON.parse(raw.replace(/```json|```/g, '').trim());
      if (items.length && this.#txModal) {
        this.#txModal.applyScanResult?.(items);
        this.#modal.refresh();
        lucide?.createIcons?.();
      }
      this.#toast.show(items.length ? `${items.length} item(s) detected` : 'No items found');
    } catch (e) {
      this.#toast.show('Scan failed: ' + e.message);
    }
    input.value = '';
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Account CRUD
  // ──────────────────────────────────────────────────────────────────────────

  submitAccount(event, id) {
    event.preventDefault();
    const fd      = new FormData(event.target);
    const data    = Object.fromEntries(fd.entries());
    const state   = this.#store.getState();
    const newMinor= this.#fx.toMinor(data.balance || 0, data.currency);
    const today   = new Date().toISOString().slice(0, 10);

    // Resolve group
    const groupRes = this.#resolveAccountGroupId(data, state);
    if (groupRes.error) return this.#toast.show(groupRes.error);
    const { groupId } = groupRes;

    if (id) {
      const a = state.accounts.find((x) => x.id === id);
      if (!a) return;
      const wasMajor = a.balance;
      Object.assign(a, { name: data.name, type: data.type, currency: data.currency, color: data.color, archived: !!data.archived, groupId });
      if (newMinor !== wasMajor) {
        const delta    = newMinor - wasMajor;
        const positive = delta > 0;
        const tx = {
          id: IdGenerator.generate('tx'), accountId: a.id, categoryId: null,
          amount: Math.abs(delta), currency: a.currency,
          exchangeRate: (FX[a.currency] || 1) / (FX[state.user.homeCurrency] || 1),
          refAmount: this.#fx.convert(Math.abs(delta), a.currency, state.user.homeCurrency),
          payee: 'Balance adjustment',
          note: `Manual balance set: ${this.#fx.formatMoney(wasMajor, a.currency)} → ${this.#fx.formatMoney(newMinor, a.currency)}`,
          date: today, paymentType: 'cash', recordState: 'cleared',
          type: positive ? 'income' : 'expense',
          transferPairId: null, splits: null, tags: ['balance-adjustment'],
        };
        state.transactions.push(tx);
        this.#applyBalances(tx, state);
      }
      this.#store.persist();
      this.closeModal(); this.#render();
      this.#toast.show('Account updated' + (newMinor !== wasMajor ? ' · adjustment logged' : ''));
      this.#sync.schedulePush?.();
      return;
    }

    // New account
    const newId = IdGenerator.generate('acc');
    state.accounts.push({ id: newId, name: data.name, type: data.type, currency: data.currency, color: data.color, icon: 'wallet', archived: false, balance: 0, groupId });
    if (newMinor !== 0) {
      const a       = state.accounts.find((x) => x.id === newId);
      const positive = newMinor > 0;
      const tx = {
        id: IdGenerator.generate('tx'), accountId: newId, categoryId: null,
        amount: Math.abs(newMinor), currency: a.currency,
        exchangeRate: (FX[a.currency] || 1) / (FX[state.user.homeCurrency] || 1),
        refAmount: this.#fx.convert(Math.abs(newMinor), a.currency, state.user.homeCurrency),
        payee: 'Opening balance', note: '',
        date: today, paymentType: 'cash', recordState: 'cleared',
        type: positive ? 'income' : 'expense',
        transferPairId: null, splits: null, tags: ['opening-balance'],
      };
      state.transactions.push(tx);
      this.#applyBalances(tx, state);
    }
    this.#store.persist();
    this.closeModal(); this.#render();
    this.#toast.show('Account added' + (newMinor !== 0 ? ' · opening balance logged' : ''));
    this.#sync.schedulePush?.();
  }

  deleteAccount(id) {
    const state = this.#store.getState();
    if (state.transactions.some((t) => t.accountId === id)) {
      return this.#toast.show('Archive instead — account has transactions');
    }
    if (!confirm('Delete this account?')) return;
    state.accounts = state.accounts.filter((a) => a.id !== id);
    this.#store.persist();
    this.closeModal(); this.#render();
    this.#sync.schedulePush?.();
  }

  deleteAccountGroup(id) {
    const state = this.#store.getState();
    if (!confirm('Delete this group? Accounts will become ungrouped.')) return;
    state.accounts.forEach((a) => { if (a.groupId === id) a.groupId = null; });
    state.accountGroups = (state.accountGroups || []).filter((g) => g.id !== id);
    this.#store.persist();
    this.#render();
  }

  onAccGroupChange(sel) {
    const inp = document.getElementById('accNewGroupName');
    if (!inp) return;
    if (sel.value === '__new__') {
      inp.classList.remove('hidden'); inp.required = true; inp.focus();
    } else {
      inp.classList.add('hidden'); inp.required = false; inp.value = '';
    }
  }

  // ── Account detail view ──────────────────────────────────────────────────

  openAccountDetail(id, sharedMeta = null) {
    const v = this.#getOrCreateView('accountDetail');
    v.setAccount(id, sharedMeta);
    this.#router.navigate('accountDetail');
    this.#render();
  }

  setAccountViewMode(mode) {
    const v = this.#views.get('accountDetail');
    v?.setViewMode?.(mode);
    this.#render();
  }

  setAccDetailFilter(key, val) {
    const v = this.#views.get('accountDetail');
    v?.setFilter?.(key, val);
    this.#render();
  }

  reconcileAccount(id) {
    const state = this.#store.getState();
    const a     = state.accounts.find((x) => x.id === id);
    if (!a) return;
    // Recompute balance from ledger
    const ledger = state.transactions.filter((t) => {
      if (t.accountId === id) return true;
      if (Array.isArray(t.splits)) return t.splits.some((s) => s.accountId === id);
      return false;
    });
    let bal = 0;
    ledger.forEach((t) => {
      if (Array.isArray(t.splits) && t.splits.length) {
        t.splits.filter((s) => s.accountId === id).forEach((s) => {
          const m = this.#fx.convert(s.amount, t.currency, a.currency);
          if (t.type === 'expense') bal -= m;
          else if (t.type === 'income') bal += m;
        });
      } else {
        const m = this.#fx.convert(t.amount, t.currency, a.currency);
        if (t.type === 'expense') bal -= m;
        else if (t.type === 'income') bal += m;
        else if (t.type === 'transfer') {
          if (t.transferDir === 'out') bal -= m;
          else if (t.transferDir === 'in') bal += m;
        }
      }
    });
    a.balance = Math.round(bal);
    this.#store.persist();
    this.#render();
    this.#toast.show('Balance reconciled from ledger');
  }

  async refreshSharedAccount(shareIndex) {
    await this.#sync.pullFamilyShares?.();
    this.#render();
    this.#toast.show('Refreshed');
  }

  toggleAccountGroupCollapse(id) {
    const state = this.#store.getState();
    if (!Array.isArray(state.user.collapsedAccountGroups)) state.user.collapsedAccountGroups = [];
    const idx = state.user.collapsedAccountGroups.indexOf(id);
    if (idx >= 0) state.user.collapsedAccountGroups.splice(idx, 1);
    else state.user.collapsedAccountGroups.push(id);
    this.#store.persist();
    this.#render();
  }

  collapseAllAccountGroups() {
    const state = this.#store.getState();
    state.user.collapsedAccountGroups = (state.accountGroups || []).map((g) => g.id);
    this.#store.persist();
    this.#render();
  }

  expandAllAccountGroups() {
    this.#store.getState().user.collapsedAccountGroups = [];
    this.#store.persist();
    this.#render();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Category CRUD
  // ──────────────────────────────────────────────────────────────────────────

  submitCategory(event, id) {
    event.preventDefault();
    const fd       = new FormData(event.target);
    const data     = Object.fromEntries(fd.entries());
    const state    = this.#store.getState();
    const parentId = data.parentId || null;
    if (id && parentId === id) return this.#toast.show('A category cannot be its own parent');
    if (id && parentId && state.categories.some((c) => c.parentId === id)) {
      return this.#toast.show('This category already has sub-categories — cannot itself become a sub-category');
    }
    const payload = { name: data.name, type: data.type, color: data.color, icon: data.icon, parentId };
    if (id) {
      Object.assign(state.categories.find((c) => c.id === id), payload);
    } else {
      state.categories.push({ id: IdGenerator.generate('cat'), budgetLimit: null, ...payload });
    }
    this.#store.persist();
    this.closeModal(); this.#render();
    this.#toast.show(id ? 'Category updated' : 'Category added');
    this.#sync.schedulePush?.();
  }

  deleteCategory(id) {
    const state = this.#store.getState();
    if (state.transactions.some((t) => t.categoryId === id)) {
      return this.#toast.show('Reassign transactions first');
    }
    if (!confirm('Delete this category?')) return;
    state.categories = state.categories.filter((c) => c.id !== id);
    this.#store.persist();
    this.closeModal(); this.#render();
    this.#sync.schedulePush?.();
  }

  toggleCategoryCollapse(id) {
    const state = this.#store.getState();
    if (!Array.isArray(state.user.collapsedCategories)) state.user.collapsedCategories = [];
    const idx = state.user.collapsedCategories.indexOf(id);
    if (idx >= 0) state.user.collapsedCategories.splice(idx, 1);
    else state.user.collapsedCategories.push(id);
    this.#store.persist();
    this.#render();
  }

  collapseAllCategories() {
    const state = this.#store.getState();
    state.user.collapsedCategories = state.categories.filter((c) => !c.parentId).map((c) => c.id);
    this.#store.persist();
    this.#render();
  }

  expandAllCategories() {
    this.#store.getState().user.collapsedCategories = [];
    this.#store.persist();
    this.#render();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Budget CRUD
  // ──────────────────────────────────────────────────────────────────────────

  submitBudget(event, id) {
    event.preventDefault();
    const fd    = new FormData(event.target);
    const data  = Object.fromEntries(fd.entries());
    const state = this.#store.getState();
    const minor = this.#fx.toMinor(data.amount, data.currency);
    const period= data.period === 'hijri' ? 'hijri' : 'gregorian';
    if (id) {
      Object.assign(state.budgets.find((b) => b.id === id), {
        categoryId: data.categoryId, amount: minor, currency: data.currency, period, rollover: !!data.rollover,
      });
    } else {
      state.budgets.push({ id: IdGenerator.generate('bg'), period, categoryId: data.categoryId, amount: minor, currency: data.currency, rollover: !!data.rollover });
    }
    this.#store.persist();
    this.closeModal(); this.#render();
    this.#toast.show(id ? 'Budget updated' : 'Budget added');
    this.#sync.schedulePush?.();
  }

  deleteBudget(id) {
    if (!confirm('Delete this budget?')) return;
    const state = this.#store.getState();
    state.budgets = state.budgets.filter((b) => b.id !== id);
    this.#store.persist();
    this.closeModal(); this.#render();
    this.#sync.schedulePush?.();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Debt CRUD
  // ──────────────────────────────────────────────────────────────────────────

  submitDebt(event, id) {
    event.preventDefault();
    const fd    = new FormData(event.target);
    const data  = Object.fromEntries(fd.entries());
    const state = this.#store.getState();

    if (id) {
      const debt = state.debts.find((x) => x.id === id);
      if (!debt) return;
      debt.counterparty = data.counterparty || debt.counterparty;
      debt.dueDate      = data.dueDate || null;
      debt.note         = data.note || '';
      debt.status       = data.markPaid ? 'paid' : 'active';
      this.#store.persist();
      this.closeModal(); this.#render();
      this.#toast.show('Debt updated');
      return;
    }

    const currency  = data.currency;
    const principal = this.#fx.toMinor(data.principal, currency);
    if (!isFinite(principal) || principal <= 0) return this.#toast.show('Principal must be positive');
    if (!data.counterparty?.trim()) return this.#toast.show('Add a counterparty');
    const acc = state.accounts.find((a) => a.id === data.accountId);
    if (!acc) return this.#toast.show('Pick an account');

    const debtId  = IdGenerator.generate('dbt');
    const txId    = IdGenerator.generate('tx');
    const exRate  = (FX[currency] || 1) / (FX[state.user.homeCurrency] || 1);
    const refAmt  = this.#fx.convert(principal, currency, state.user.homeCurrency);
    const isBorrowed = data.type === 'borrowed';

    const tx = {
      id: txId, accountId: data.accountId, categoryId: null,
      amount: principal, currency, exchangeRate: exRate, refAmount: refAmt,
      payee: data.counterparty,
      note: (isBorrowed ? 'Borrowed from ' : 'Lent to ') + data.counterparty + (data.note ? ' — ' + data.note : ''),
      date: data.dateTaken, paymentType: 'transfer', recordState: 'cleared',
      type: isBorrowed ? 'income' : 'expense',
      transferPairId: null, tags: ['debt'], splits: null,
      debtId, debtRole: 'initial',
    };
    state.transactions.push(tx);
    this.#applyBalances(tx, state);

    state.debts.push({
      id: debtId, type: data.type, counterparty: data.counterparty,
      principal, currency, accountId: data.accountId,
      dateTaken: data.dateTaken, dueDate: data.dueDate || null,
      note: data.note || '', status: 'active', initialTxId: txId,
    });

    this.#store.persist();
    this.closeModal(); this.#render();
    this.#toast.show(isBorrowed ? 'Debt recorded · account credited' : 'Loan recorded · account debited');
    this.#sync.schedulePush?.();
  }

  submitDebtPayment(event, debtId) {
    event.preventDefault();
    const fd    = new FormData(event.target);
    const data  = Object.fromEntries(fd.entries());
    const state = this.#store.getState();
    const debt  = state.debts?.find((x) => x.id === debtId);
    if (!debt) return;
    const amount = this.#fx.toMinor(data.amount, debt.currency);
    if (!isFinite(amount) || amount <= 0) return this.#toast.show('Amount must be positive');
    const isBorrowed = debt.type === 'borrowed';

    const tx = {
      id: IdGenerator.generate('tx'), accountId: data.accountId, categoryId: null,
      amount, currency: debt.currency,
      exchangeRate: (FX[debt.currency] || 1) / (FX[state.user.homeCurrency] || 1),
      refAmount: this.#fx.convert(amount, debt.currency, state.user.homeCurrency),
      payee: debt.counterparty,
      note: (isBorrowed ? 'Payment to ' : 'Repayment from ') + debt.counterparty + (data.note ? ' — ' + data.note : ''),
      date: data.date, paymentType: 'transfer', recordState: 'cleared',
      type: isBorrowed ? 'expense' : 'income',
      transferPairId: null, tags: ['debt-payment'], splits: null,
      debtId, debtRole: 'payment',
    };
    state.transactions.push(tx);
    this.#applyBalances(tx, state);

    // Check if fully repaid
    const payments = state.transactions.filter((t) => t.debtId === debtId && t.id !== debt.initialTxId);
    const paid     = payments.reduce((s, t) => s + t.amount, 0);
    if (paid >= debt.principal - 1) debt.status = 'paid';

    this.#store.persist();
    this.closeModal(); this.#render();
    this.#toast.show(debt.status === 'paid'
      ? 'Payment recorded · debt cleared'
      : `Payment of ${this.#fx.formatMoney(amount, debt.currency)} recorded`);
    this.#sync.schedulePush?.();
  }

  deleteDebt(id, destroyPayments = false) {
    const state = this.#store.getState();
    const debt  = state.debts.find((d) => d.id === id);
    if (!debt) return;
    const payments = state.transactions.filter((t) => t.debtId === id && t.id !== debt.initialTxId);
    const msg = destroyPayments
      ? `Delete this debt AND destroy ${payments.length} linked payment transaction${payments.length === 1 ? '' : 's'}? Account balances will be restored.`
      : 'Delete this debt? The initial transaction is reverted; existing payment transactions are kept but unlinked.';
    if (!confirm(msg)) return;
    const initial = state.transactions.find((t) => t.id === debt.initialTxId);
    if (initial) {
      this.#revertBalances(initial, state);
      state.transactions = state.transactions.filter((t) => t.id !== debt.initialTxId);
    }
    if (destroyPayments) {
      payments.forEach((p) => this.#revertBalances(p, state));
      state.transactions = state.transactions.filter((t) => t.debtId !== id);
    } else {
      state.transactions.forEach((t) => { if (t.debtId === id) { t.debtId = null; t.debtRole = null; } });
    }
    state.debts = state.debts.filter((d) => d.id !== id);
    this.#store.persist();
    this.closeModal(); this.#render();
    this.#toast.show(destroyPayments ? `Debt and ${payments.length} payment(s) destroyed` : 'Debt deleted');
    this.#sync.schedulePush?.();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Family CRUD
  // ──────────────────────────────────────────────────────────────────────────

  submitFamilyMember(event, id) {
    event.preventDefault();
    const fd      = new FormData(event.target);
    const data    = Object.fromEntries(fd.entries());
    const state   = this.#store.getState();
    const perms   = this.#familyModal?.getPendingPerms?.() ?? {};

    const permissions = Object.entries(perms)
      .filter(([, v]) => v)
      .map(([accountId, access]) => ({ accountId, access }));

    if (id) {
      const m = state.family.find((x) => x.id === id);
      if (!m) return;
      Object.assign(m, {
        name:        data.name,
        email:       data.email || '',
        initials:    data.initials || data.name.slice(0, 2).toUpperCase(),
        color:       data.color || m.color,
        permissions,
      });
    } else {
      state.family.push({
        id: IdGenerator.generate('mbr'),
        name:        data.name,
        email:       data.email || '',
        initials:    data.initials || data.name.slice(0, 2).toUpperCase(),
        color:       data.color || MEMBER_COLORS[state.family.length % MEMBER_COLORS.length],
        permissions,
      });
    }
    this.#store.persist();
    this.closeModal(); this.#render();
    this.#toast.show(id ? 'Member updated' : 'Member added');
    this.#sync.schedulePush?.();
  }

  deleteFamilyMember(id) {
    if (!confirm('Remove this family member?')) return;
    const state = this.#store.getState();
    state.family = (state.family || []).filter((m) => m.id !== id);
    this.#store.persist();
    this.closeModal(); this.#render();
    this.#sync.schedulePush?.();
  }

  toggleAccountPerm(accountId, enabled) {
    const levelsDiv = document.getElementById(`accLevels_${accountId}`);
    if (levelsDiv) levelsDiv.classList.toggle('hidden', !enabled);
    const perms = this.#familyModal?.getPendingPerms?.() ?? {};
    if (!enabled) {
      delete perms[accountId];
    } else if (!perms[accountId]) {
      perms[accountId] = 'view';
      const radio = document.querySelector(`input[name="perm_${accountId}"][value="view"]`);
      if (radio) radio.checked = true;
    }
    // FamilyModal stores perms internally; we just update DOM
  }

  updatePermLevel(accountId, level) {
    // Update label borders and propagate to FamilyModal pendingPerms
    if (this.#familyModal?.setPendingPerm) {
      this.#familyModal.setPendingPerm(accountId, level);
    }
    document.querySelectorAll(`input[name="perm_${accountId}"]`).forEach((r) => {
      const lbl = r.closest('label');
      if (!lbl) return;
      if (r.checked) {
        // Color from FAMILY_ACCESS_LEVELS
        const acc = document.querySelector(`#accLevels_${accountId} input[value="${level}"]`);
        // We can't easily get lvl.color here without re-importing, so use CSS data or just use the checked state
        lbl.style.color = r.value === level ? '' : '';
      } else {
        lbl.style.color = '';
        lbl.style.borderColor = '';
      }
    });
  }

  pickMemberColor(color) {
    const inp = document.getElementById('memberColorInput');
    const av  = document.getElementById('memberAvatar');
    if (inp) inp.value = color;
    if (av)  av.style.background = color;
    document.querySelectorAll('[data-color]').forEach((btn) => {
      btn.style.borderColor = btn.dataset.color === color ? '#09090b' : 'transparent';
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Regular items CRUD
  // ──────────────────────────────────────────────────────────────────────────

  submitRegularItem(event, id) {
    event.preventDefault();
    const fd    = new FormData(event.target);
    const data  = Object.fromEntries(fd.entries());
    const state = this.#store.getState();
    if (!Array.isArray(state.regularItems)) state.regularItems = [];

    const currency = data.currency || state.user.homeCurrency;
    const payload = {
      name:          (data.name || '').trim(),
      defaultAmount: this.#fx.toMinor(parseFloat(data.defaultAmount) || 0, currency),
      currency,
      accountId:     data.accountId  || null,
      categoryId:    data.categoryId || null,
      icon:          data.icon  || 'coffee',
      color:         data.color || '#f97316',
    };

    if (!payload.name) return this.#toast.show('Name is required');

    if (id) {
      const item = state.regularItems.find((i) => i.id === id);
      if (item) Object.assign(item, payload);
    } else {
      state.regularItems.push({ id: IdGenerator.generate('ri'), ...payload });
    }

    this.#store.persist();
    this.closeModal();
    this.#render();
    this.#toast.show(id ? 'Item updated' : 'Item added');
    this.#sync.schedulePush?.();
  }

  deleteRegularItem(id) {
    if (!confirm('Delete this regular item?')) return;
    const state = this.#store.getState();
    state.regularItems = (state.regularItems || []).filter((i) => i.id !== id);
    this.#store.persist();
    this.closeModal();
    this.#render();
    this.#sync.schedulePush?.();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Calendar view
  // ──────────────────────────────────────────────────────────────────────────

  shiftCalMonth(delta) {
    const v = this.#getOrCreateView('calendar');
    v.shiftMonth?.(delta);
    this.#render();
  }

  setCalTab(tab) {
    const v = this.#getOrCreateView('calendar');
    v.setTab?.(tab);
    this.#render();
  }

  resetCalFocus() {
    const v = this.#getOrCreateView('calendar');
    v.resetFocus?.();
    this.#render();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reports view
  // ──────────────────────────────────────────────────────────────────────────

  setReportRange(r) {
    this.#reportRange = r;
    const v = this.#getOrCreateView('reports');
    v.setRange?.(r);
    this.#render();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Swipe-to-delete (touch)
  // ──────────────────────────────────────────────────────────────────────────

  onTxSwipeStart(event, id) {
    this.#swipeTxId  = id;
    this.#swipeStartX = event.touches[0]?.clientX ?? 0;
    this.#swipeDeltaX = 0;
  }

  onTxSwipeMove(event) {
    if (!this.#swipeTxId) return;
    this.#swipeDeltaX = (event.touches[0]?.clientX ?? 0) - this.#swipeStartX;
    const el = document.getElementById(`tx-row-${this.#swipeTxId}`);
    if (el) el.style.transform = `translateX(${Math.min(0, this.#swipeDeltaX)}px)`;
  }

  onTxSwipeEnd() {
    if (!this.#swipeTxId) return;
    const el = document.getElementById(`tx-row-${this.#swipeTxId}`);
    if (this.#swipeDeltaX < -80) {
      this.deleteTx(this.#swipeTxId);
    } else if (el) {
      el.style.transform = '';
    }
    this.#swipeTxId   = null;
    this.#swipeDeltaX = 0;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Data: export / import / reset
  // ──────────────────────────────────────────────────────────────────────────

  exportJson() {
    const state = this.#store.getState();
    const blob  = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a     = document.createElement('a');
    a.href      = URL.createObjectURL(blob);
    a.download  = 'pocket-export-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    this.#toast.show('Export downloaded');
  }

  importJson(input) {
    const file = input?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.accounts || !parsed.transactions) throw new Error('Invalid structure');
        this.#store.replaceState(parsed);
        this.#store.persist();
        this.closeModal(); this.#render();
        this.#toast.show('Data imported');
      } catch { this.#toast.show('Invalid JSON file'); }
    };
    reader.readAsText(file);
  }

  exportCsv(range) {
    const state = this.#store.getState();
    const home  = state.user.homeCurrency;

    const COLS  = [
      ['Date','date'],['Type','type'],['Account','account'],['ToAccount','toaccount'],
      ['ToAmount','toamount'],['ToCurrency','tocurrency'],
      ['Category','category'],['Subcategory','subcategory'],['Payee','payee'],['Note','note'],
      ['Amount','amount'],['Currency','currency'],['PaymentType','paymenttype'],['Tags','tags'],
      ['DueDate','duedate'],['DebtRef','debtref'],['SplitOf','splitof'],
      ['CreatedAt','createdAt'],['AddedBy','addedBy'],
    ];

    const effectiveRange = range === 'current' ? this.#reportRange : range;
    const txs = state.transactions
      .filter((t) => this.#withinRange(t.date, effectiveRange))
      .sort((a, b) => a.date.localeCompare(b.date));

    const catPair = (id) => {
      const cat = state.categories.find((c) => c.id === id);
      if (!cat) return ['', ''];
      if (cat.parentId) {
        const parent = state.categories.find((c) => c.id === cat.parentId);
        return [parent?.name || '', cat.name];
      }
      return [cat.name, ''];
    };
    const minorDig = (c) => this.#fx.minorFactor(c) === 1 ? 0 : this.#fx.minorFactor(c) === 1000 ? 3 : 2;
    const cellStr  = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const buildRow = (o) => COLS.map(([, k]) => cellStr(o[k] != null ? o[k] : ''));

    const rows    = [COLS.map((c) => c[0])];
    const emitted = new Set();

    txs.forEach((t) => {
      if (emitted.has(t.id)) return;
      if (t.type === 'transfer' && t.transferPairId) {
        if (t.transferDir === 'in') return;
        const pair    = state.transactions.find((x) => x.id === t.transferPairId);
        const accFrom = state.accounts.find((a) => a.id === t.accountId);
        const accTo   = pair ? state.accounts.find((a) => a.id === pair.accountId) : null;
        const crossCcy= pair && pair.currency !== t.currency;
        rows.push(buildRow({
          date: t.date, type: 'transfer',
          account: accFrom?.name || '', toaccount: accTo?.name || '',
          toamount: crossCcy ? this.#fx.fromMinor(pair.amount, pair.currency).toFixed(minorDig(pair.currency)) : '',
          tocurrency: crossCcy ? pair.currency : '',
          payee: t.payee || '', note: (t.note || '').replace(/[\r\n]+/g, ' '),
          amount: this.#fx.fromMinor(t.amount, t.currency).toFixed(minorDig(t.currency)),
          currency: t.currency, paymenttype: t.paymentType || 'transfer',
          tags: (t.tags || []).join(','), createdAt: t.createdAt || '', addedBy: t.addedBy || '',
        }));
        emitted.add(t.id); if (pair) emitted.add(pair.id);
        return;
      }
      if (t.debtId) {
        const debt = state.debts?.find((x) => x.id === t.debtId);
        if (debt) {
          const acc = state.accounts.find((a) => a.id === t.accountId);
          if (t.debtRole === 'initial') {
            rows.push(buildRow({
              date: t.date, type: debt.type, account: acc?.name || '',
              payee: debt.counterparty || t.payee || '',
              note: (t.note || debt.note || '').replace(/[\r\n]+/g, ' '),
              amount: this.#fx.fromMinor(t.amount, t.currency).toFixed(minorDig(t.currency)),
              currency: t.currency, paymenttype: t.paymentType || 'transfer',
              tags: (t.tags || []).join(','), duedate: debt.dueDate || '', debtref: debt.id,
              createdAt: t.createdAt || '', addedBy: t.addedBy || '',
            }));
          } else {
            rows.push(buildRow({
              date: t.date, type: t.type, account: acc?.name || '',
              payee: t.payee || '', note: (t.note || '').replace(/[\r\n]+/g, ' '),
              amount: this.#fx.fromMinor(t.amount, t.currency).toFixed(minorDig(t.currency)),
              currency: t.currency, paymenttype: t.paymentType || '',
              tags: (t.tags || []).join(','), debtref: debt.id,
              createdAt: t.createdAt || '', addedBy: t.addedBy || '',
            }));
          }
          emitted.add(t.id); return;
        }
      }
      if (Array.isArray(t.splits) && t.splits.length) {
        t.splits.forEach((s) => {
          const acc = state.accounts.find((a) => a.id === (s.accountId || t.accountId));
          const [cn, sn] = catPair(s.categoryId);
          rows.push(buildRow({
            date: t.date, type: t.type, account: acc?.name || '',
            category: cn, subcategory: sn, payee: t.payee || '',
            note: (t.note || '').replace(/[\r\n]+/g, ' '),
            amount: this.#fx.fromMinor(s.amount, t.currency).toFixed(minorDig(t.currency)),
            currency: t.currency, paymenttype: t.paymentType || '',
            tags: (t.tags || []).join(','), splitof: t.id,
            createdAt: t.createdAt || '', addedBy: t.addedBy || '',
          }));
        });
        emitted.add(t.id); return;
      }
      const acc = state.accounts.find((a) => a.id === t.accountId);
      const [cn, sn] = catPair(t.categoryId);
      rows.push(buildRow({
        date: t.date, type: t.type, account: acc?.name || '',
        category: cn, subcategory: sn, payee: t.payee || '',
        note: (t.note || '').replace(/[\r\n]+/g, ' '),
        amount: this.#fx.fromMinor(t.amount, t.currency).toFixed(minorDig(t.currency)),
        currency: t.currency, paymenttype: t.paymentType || '',
        tags: (t.tags || []).join(','),
        createdAt: t.createdAt || '', addedBy: t.addedBy || '',
      }));
      emitted.add(t.id);
    });

    const csv  = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'transactions-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    this.closeModal();
    this.#toast.show('CSV downloaded');
  }

  downloadImportTemplate() {
    const today = new Date().toISOString().slice(0, 10);
    const lines = [
      'Date,Type,Account,ToAccount,ToAmount,ToCurrency,Category,Subcategory,Payee,Note,Amount,Currency,PaymentType,Tags,DueDate,DebtRef,SplitOf',
      `${today},expense,Main Checking,,,,Food & Drink,Groceries,Whole Foods,Weekly groceries,87.45,USD,card,,,,`,
      `${today},income,Main Checking,,,,Salary,,Acme Corp,Monthly payroll,5800.00,USD,transfer,,,,`,
      `${today},transfer,Main Checking,High-Yield Save,,,,,,Move to savings,500.00,USD,transfer,,,,`,
    ];
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'pocket-import-template.csv';
    a.click();
  }

  startImport(input) {
    const file = input?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = this.#parseCsv(String(reader.result));
        if (!parsed.data.length) return this.#toast.show('No data rows found in CSV');
        const plan = this.#buildImportPlan(parsed.data, parsed.headers);
        this.#importPlan = plan;
        this.#openImportPreview(plan);
      } catch (e) {
        this.#toast.show('Could not parse CSV: ' + e.message);
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  commitImport() {
    const plan = this.#importPlan;
    if (!plan) return;
    const replaceEl       = document.getElementById('importReplace');
    const includeDupesEl  = document.getElementById('importIncludeDupes');
    const replace         = replaceEl?.checked;
    const includeDupes    = includeDupesEl?.checked;
    if (replace && !confirm('Replace ALL existing data with the import? This cannot be undone.')) return;

    const state = this.#store.getState();
    if (replace) {
      state.accounts      = [];
      state.categories    = [];
      state.transactions  = [];
      state.budgets       = [];
      state.debts         = [];
      state.merchantCategories = {};
      plan.txDrafts.forEach((d) => { d.isDuplicate = false; });
    }

    // Create new accounts
    const accMap = {};
    const norm   = (s) => String(s || '').toLowerCase().trim();
    state.accounts.forEach((a) => { accMap[norm(a.name)] = a.id; });
    plan.newAccounts.forEach((na) => {
      if (!accMap[norm(na.name)]) {
        const id = IdGenerator.generate('acc');
        state.accounts.push({ id, name: na.name, type: na.type, currency: na.currency, color: na.color, icon: na.icon || 'wallet', archived: false, balance: 0 });
        accMap[norm(na.name)] = id;
      }
    });

    // Create new categories (parents first)
    const catMap = {};
    state.categories.forEach((c) => { catMap[norm(c.name) + '|' + c.type + '|' + (c.parentId ? 'sub' : 'root')] = c.id; });
    plan.newCategories
      .sort((a, b) => (a.parentName ? 1 : 0) - (b.parentName ? 1 : 0))
      .forEach((nc) => {
        const rk = norm(nc.name) + '|' + nc.type + '|root';
        const sk = nc.parentName ? (norm(nc.parentName) + '|' + norm(nc.name) + '|' + nc.type + '|sub') : rk;
        if (!catMap[sk]) {
          const parentId = nc.parentName ? (catMap[norm(nc.parentName) + '|' + nc.type + '|root'] || null) : null;
          const id = IdGenerator.generate('cat');
          state.categories.push({ id, name: nc.name, type: nc.type, color: nc.color, icon: nc.icon, parentId, budgetLimit: null });
          catMap[sk] = id; if (!parentId) catMap[rk] = id;
        }
      });

    // Import transactions (skip dupes unless includeDupes)
    let txCount = 0;
    plan.txDrafts.forEach((draft) => {
      if (draft.isDuplicate && !includeDupes) return;
      const accId = accMap[norm(draft.accountName)];
      if (!accId) return;
      const acc = state.accounts.find((a) => a.id === accId);
      if (!acc) return;
      const minor   = draft.amount;
      const exRate  = (FX[draft.currency] || 1) / (FX[state.user.homeCurrency] || 1);
      const refAmt  = this.#fx.convert(minor, draft.currency, state.user.homeCurrency);

      if (draft.type === 'transfer') {
        const toAccId = accMap[norm(draft.toAccountName)];
        if (!toAccId) return;
        const toAcc = state.accounts.find((a) => a.id === toAccId);
        if (!toAcc) return;
        const fromId = IdGenerator.generate('tx');
        const toId   = IdGenerator.generate('tx');
        const dstMinor = draft.toAmountMinor ?? minor;
        const toCcy    = draft.toCurrency ?? draft.currency;
        const txF = { id: fromId, accountId: accId, categoryId: null, amount: minor, currency: draft.currency, exchangeRate: exRate, refAmount: refAmt, payee: draft.payee, note: draft.note, date: draft.date, paymentType: draft.paymentType, recordState: 'cleared', type: 'transfer', transferPairId: toId, transferDir: 'out', tags: draft.tags || [], createdAt: draft.createdAt || new Date().toISOString(), addedBy: draft.addedBy || null };
        const txT = { id: toId, accountId: toAccId, categoryId: null, amount: dstMinor, currency: toCcy, exchangeRate: (FX[toCcy] || 1) / (FX[state.user.homeCurrency] || 1), refAmount: this.#fx.convert(dstMinor, toCcy, state.user.homeCurrency), payee: draft.payee, note: draft.note, date: draft.date, paymentType: draft.paymentType, recordState: 'cleared', type: 'transfer', transferPairId: fromId, transferDir: 'in', tags: draft.tags || [], createdAt: draft.createdAt || new Date().toISOString(), addedBy: draft.addedBy || null };
        state.transactions.push(txF, txT);
        acc.balance    -= this.#fx.convert(minor, draft.currency, acc.currency);
        toAcc.balance  += this.#fx.convert(dstMinor, toCcy, toAcc.currency);
        txCount++;
      } else if (Array.isArray(draft.splits)) {
        const splits = draft.splits.map((s) => ({
          categoryId: s.catId ? catMap[norm(s.catId)] || null : null,
          accountId: accMap[norm(s.accountName || draft.accountName)] || accId,
          amount: s.amount,
        }));
        const tx = { id: IdGenerator.generate('tx'), accountId: accId, categoryId: null, amount: minor, currency: draft.currency, exchangeRate: exRate, refAmount: refAmt, payee: draft.payee, note: draft.note, date: draft.date, paymentType: draft.paymentType, recordState: 'cleared', type: draft.type, transferPairId: null, tags: draft.tags || [], splits, createdAt: draft.createdAt || new Date().toISOString(), addedBy: draft.addedBy || null };
        state.transactions.push(tx);
        this.#applyBalances(tx, state);
        txCount++;
      } else {
        const catKey = draft.catName
          ? (draft.subName
            ? (norm(draft.catName) + '|' + norm(draft.subName) + '|' + draft.type + '|sub')
            : (norm(draft.catName) + '|' + draft.type + '|root'))
          : null;
        const catId = catKey ? (catMap[catKey] || null) : null;
        const tx = { id: IdGenerator.generate('tx'), accountId: accId, categoryId: catId, amount: minor, currency: draft.currency, exchangeRate: exRate, refAmount: refAmt, payee: draft.payee, note: draft.note, date: draft.date, paymentType: draft.paymentType, recordState: 'cleared', type: draft.type, transferPairId: null, tags: draft.tags || [], splits: null, createdAt: draft.createdAt || new Date().toISOString(), addedBy: draft.addedBy || null };
        state.transactions.push(tx);
        this.#applyBalances(tx, state);
        txCount++;
      }
    });

    this.#store.persist();
    this.#sync.schedulePush?.();
    this.#renderImportDone({ transactions: txCount, accounts: plan.newAccounts.length, categories: plan.newCategories.length, debts: 0 });
    this.#render();
  }

  resetData() {
    if (!confirm('Reset ALL data? This cannot be undone.')) return;
    this.#store.replaceState(SeedFactory.create());
    this.#store.persist();
    this.#render();
    this.#toast.show('Data reset');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: render
  // ──────────────────────────────────────────────────────────────────────────

  #render() {
    // Inject live shared data so views can read state._sharedData
    this.#store.getState()._sharedData = this.#sync.sharedData;
    const route = this.#router.current || 'dashboard';
    this.#renderView(route);
    this.#nav.render(route);
    lucide?.createIcons?.();
  }

  #renderView(routeId) {
    const view    = this.#getOrCreateView(routeId);
    const content = document.getElementById('viewContent');
    if (!content) return;
    const html = view.render?.() ?? '';
    content.innerHTML = html;
    view.onAfterRender?.();
    lucide?.createIcons?.();
  }

  #getOrCreateView(id) {
    if (this.#views.has(id)) return this.#views.get(id);
    let view;
    switch (id) {
      case 'dashboard':    view = new DashboardView();    break;
      case 'transactions': view = new TransactionsView(); break;
      case 'accounts':     view = new AccountsView();     break;
      case 'accountDetail':view = new AccountDetailView();break;
      case 'budgets':      view = new BudgetsView();      break;
      case 'categories':   view = new CategoriesView();   break;
      case 'reports':      view = new ReportsView();      break;
      case 'debts':        view = new DebtsView();        break;
      case 'calendar':     view = new CalendarView();     break;
      case 'family':       view = new FamilyView();       break;
      default:             view = { render: () => `<div class="p-6 text-zinc-400">View not found: ${id}</div>` };
    }
    this.#views.set(id, view);
    return view;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: theme
  // ──────────────────────────────────────────────────────────────────────────

  #applyTheme() {
    const t    = this.#store.getState().user.theme;
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: state migrations / defaults
  // ──────────────────────────────────────────────────────────────────────────

  #ensureUserDefaults() {
    const state = this.#store.getState();
    state.user  = Object.assign({
      homeCurrency: 'USD', defaultCurrency: 'USD',
      theme: 'system', showHijri: true, calendarMode: 'both',
      dateFormat: 'auto', geminiApiKey: '',
      supabaseUrl: '', supabaseKey: '',
    }, state.user);
    if (!state.user.defaultCurrency) state.user.defaultCurrency = state.user.homeCurrency;
    if (!state.user.calendarMode) state.user.calendarMode = state.user.showHijri ? 'both' : 'gregorian';
    if (!Array.isArray(state.debts))              state.debts              = [];
    if (!Array.isArray(state.regularItems))       state.regularItems       = [];
    if (!Array.isArray(state.accountGroups))      state.accountGroups      = [];
    if (!Array.isArray(state.family))             state.family             = [];
    if (!Array.isArray(state.user.collapsedAccountGroups)) state.user.collapsedAccountGroups = [];
    if (!state.merchantCategories) state.merchantCategories = {};

    // One-time backfill: infer transfer direction from creation order
    if (!state._transferDirBackfilled) {
      state.transactions.forEach((t, i) => {
        if (t.type !== 'transfer' || !t.transferPairId || t.transferDir) return;
        const pairIdx = state.transactions.findIndex((x) => x.id === t.transferPairId);
        if (pairIdx < 0) return;
        const pair = state.transactions[pairIdx];
        if (pair.transferDir) return;
        if (i < pairIdx) { t.transferDir = 'out'; pair.transferDir = 'in'; }
        else             { t.transferDir = 'in';  pair.transferDir = 'out'; }
      });
      state._transferDirBackfilled = true;
    }

    this.#store.persist();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: balance helpers
  // ──────────────────────────────────────────────────────────────────────────

  #applyBalances(tx, state) {
    if (Array.isArray(tx.splits) && tx.splits.length) {
      for (const s of tx.splits) {
        const acc = state.accounts.find((a) => a.id === (s.accountId || tx.accountId));
        if (!acc) continue;
        const m = this.#fx.convert(s.amount, tx.currency, acc.currency);
        if (tx.type === 'expense') acc.balance -= m;
        else if (tx.type === 'income') acc.balance += m;
      }
      return;
    }
    const a = state.accounts.find((x) => x.id === tx.accountId);
    if (!a) return;
    const m = this.#fx.convert(tx.amount, tx.currency, a.currency);
    if (tx.type === 'expense') a.balance -= m;
    else if (tx.type === 'income') a.balance += m;
  }

  #revertBalances(tx, state) {
    if (Array.isArray(tx.splits) && tx.splits.length) {
      for (const s of tx.splits) {
        const acc = state.accounts.find((a) => a.id === (s.accountId || tx.accountId));
        if (!acc) continue;
        const m = this.#fx.convert(s.amount, tx.currency, acc.currency);
        if (tx.type === 'expense') acc.balance += m;
        else if (tx.type === 'income') acc.balance -= m;
        else if (tx.type === 'transfer' && tx.transferPairId) acc.balance += m;
      }
      return;
    }
    const a = state.accounts.find((x) => x.id === tx.accountId);
    if (!a) return;
    const m = this.#fx.convert(tx.amount, tx.currency, a.currency);
    if (tx.type === 'expense') a.balance += m;
    else if (tx.type === 'income') a.balance -= m;
    else if (tx.type === 'transfer' && tx.transferPairId) a.balance += m;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: account group helper
  // ──────────────────────────────────────────────────────────────────────────

  #resolveAccountGroupId(data, state) {
    let { groupId } = data;
    if (!groupId) return { groupId: null };
    if (groupId === '__new__') {
      const name = (data.newGroupName || '').trim();
      if (!name) return { error: 'New group name is required' };
      const norm   = (s) => s.toLowerCase().trim();
      const exists = (state.accountGroups || []).find((g) => norm(g.name) === norm(name));
      if (exists) return { groupId: exists.id };
      const id = IdGenerator.generate('grp');
      if (!Array.isArray(state.accountGroups)) state.accountGroups = [];
      state.accountGroups.push({ id, name, color: this.#deterministicColor(name) });
      return { groupId: id };
    }
    return { groupId };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: range helper
  // ──────────────────────────────────────────────────────────────────────────

  #withinRange(iso, days) {
    if (days === 'all') return true;
    const d     = new Date(iso);
    const start = new Date();
    start.setDate(start.getDate() - Number(days));
    return d >= start;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: CSV import helpers
  // ──────────────────────────────────────────────────────────────────────────

  #parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [];
    let cur = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], nx = text[i + 1];
      if (inQ) {
        if (c === '"' && nx === '"') { field += '"'; i++; }
        else if (c === '"') inQ = false;
        else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { cur.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
          if (c === '\r' && nx === '\n') i++;
          cur.push(field); field = '';
          if (cur.length > 1 || cur[0].trim() !== '') rows.push(cur);
          cur = [];
        } else field += c;
      }
    }
    if (field !== '' || cur.length) { cur.push(field); if (cur.some((v) => v.trim() !== '')) rows.push(cur); }
    if (!rows.length) return { headers: [], data: [] };
    const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s_\-]+/g, ''));
    const data    = rows.slice(1).filter((r) => r.some((v) => (v || '').trim() !== '')).map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
      return obj;
    });
    return { headers, data };
  }

  #buildImportPlan(rows, _headers) {
    const state       = this.#store.getState();
    const norm        = (s) => String(s || '').toLowerCase().trim();
    const txDrafts    = [];
    const newAccs     = {};
    const newCats     = {};
    const splitGroups = {};
    const userPref    = state.user?.dateFormat || 'auto';

    const accByName   = (n) => state.accounts.find((a) => norm(a.name) === norm(n));

    rows.forEach((r, i) => {
      const date = this.#parseImportDate(r.date, userPref);
      if (!date) return;
      let type = (r.type || 'expense').toLowerCase();
      if (type === 'debit') type = 'expense';
      if (type === 'credit') type = 'income';
      if (!['expense','income','transfer','borrowed','lent'].includes(type)) return;

      const acctName = (r.account || '').trim();
      if (!acctName) return;
      const currency = ((r.currency || state.user.homeCurrency).toUpperCase());
      if (!FX[currency]) return;
      const rawAmt = String(r.amount || '0').replace(/[^0-9.\-]/g, '');
      const amount = this.#fx.toMinor(Math.abs(Number(rawAmt)), currency);
      if (!isFinite(amount) || amount === 0) return;

      if (!accByName(acctName) && !newAccs[norm(acctName)]) {
        const t2 = this.#guessAccountType(acctName);
        newAccs[norm(acctName)] = { name: acctName, type: t2, currency, color: this.#deterministicColor(acctName), icon: this.#defaultAccIcon(t2) };
      }

      const catName = (r.category || '').trim();
      const subName = (r.subcategory || '').trim();
      if (catName && type !== 'transfer') {
        const k = norm(catName) + '|' + type + '|root';
        if (!state.categories.find((c) => !c.parentId && norm(c.name) === norm(catName)) && !newCats[k]) {
          newCats[k] = { name: catName, type, parentName: null, ...this.#guessCatDefaults(catName, type) };
        }
        if (subName) {
          const sk = norm(catName) + '|' + norm(subName) + '|' + type + '|sub';
          const parentForLookup = state.categories.find((c) => !c.parentId && norm(c.name) === norm(catName));
          const existSub = parentForLookup ? state.categories.find((c) => c.parentId === parentForLookup.id && norm(c.name) === norm(subName)) : null;
          if (!existSub && !newCats[sk]) {
            newCats[sk] = { name: subName, type, parentName: catName, ...this.#guessCatDefaults(subName, type) };
          }
        }
      }

      let paymentType = (r.paymenttype || '').toLowerCase();
      if (!['card','cash','transfer'].includes(paymentType)) paymentType = type === 'transfer' ? 'transfer' : 'card';
      const tags = (r.tags || '').split(',').map((t) => t.trim()).filter(Boolean);

      // Handle split grouping
      const splitOf = (r.splitof || '').trim();
      if (splitOf) {
        if (!splitGroups[splitOf]) {
          splitGroups[splitOf] = {
            type: 'split-group', date, accountName: acctName, payee: (r.payee || '').trim(),
            note: (r.note || '').trim(), currency, paymentType, tags, createdAt: r.createdat || '', addedBy: r.addedby || '',
            amount: 0, splits: [],
          };
          txDrafts.push(splitGroups[splitOf]);
        }
        splitGroups[splitOf].amount += amount;
        splitGroups[splitOf].splits.push({
          catId: catName ? (norm(catName) + '|' + (subName ? (norm(subName) + '|' + type + '|sub') : (type + '|root'))) : null,
          accountName: acctName, amount,
        });
        return;
      }

      if (type === 'transfer') {
        const toName = (r.toaccount || '').trim();
        if (!toName) return;
        const rawToAmt = (r.toamount || '').trim();
        const rawToCcy = (r.tocurrency || '').trim().toUpperCase();
        const toCcy    = (rawToCcy && FX[rawToCcy]) ? rawToCcy : currency;
        const toAmountMinor = rawToAmt ? this.#fx.toMinor(Number(rawToAmt.replace(/[^0-9.\-]/g, '')), toCcy) : null;
        if (!accByName(toName) && !newAccs[norm(toName)]) {
          const t3 = this.#guessAccountType(toName);
          newAccs[norm(toName)] = { name: toName, type: t3, currency: toCcy, color: this.#deterministicColor(toName), icon: this.#defaultAccIcon(t3) };
        }
        txDrafts.push({ type: 'transfer', date, accountName: acctName, toAccountName: toName, toAmountMinor, toCurrency: toCcy !== currency ? toCcy : null, payee: (r.payee || '').trim(), note: (r.note || '').trim(), amount, currency, paymentType, tags, isDuplicate: false, catName: null, subName: null, createdAt: r.createdat || '', addedBy: r.addedby || '' });
        return;
      }

      txDrafts.push({ type, date, accountName: acctName, payee: (r.payee || '').trim(), note: (r.note || '').trim(), amount, currency, paymentType, catName: catName || null, subName: subName || null, tags, isDuplicate: false, createdAt: r.createdat || '', addedBy: r.addedby || '' });
    });

    return {
      txDrafts,
      newAccounts:  Object.values(newAccs),
      newCategories: Object.values(newCats),
      failedRows: [],
    };
  }

  #parseImportDate(s, userPref) {
    s = String(s || '').trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    let m = s.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
    if (m) {
      const [, y, mm, dd] = m;
      return `${y}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
    }
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
    if (m) {
      let a = +m[1], b = +m[2]; const y = m[3];
      let dd, mm2;
      if (a > 12 && b <= 12)      { dd = a; mm2 = b; }
      else if (b > 12 && a <= 12) { mm2 = a; dd = b; }
      else if (a > 12 && b > 12)  return null;
      else { if (userPref === 'MM/DD/YYYY') { mm2 = a; dd = b; } else { dd = a; mm2 = b; } }
      return `${y}-${String(mm2).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null
      : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  #openImportPreview(plan) {
    const summary = `${plan.txDrafts.length} transactions · ${plan.newAccounts.length} new accounts · ${plan.newCategories.length} new categories`;
    const modal   = this.#modal;
    // Render a simple preview inline
    modal.open('_raw', {
      html: `
        <div class="p-5">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold">Import preview</h3>
            <button class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
          </div>
          <div class="card-muted p-3 mb-4 text-sm">${summary}</div>
          <div class="flex items-center gap-2 mb-3">
            <input type="checkbox" id="importIncludeDupes">
            <label for="importIncludeDupes" class="text-sm">Include probable duplicates</label>
          </div>
          <div class="flex items-center gap-2 mb-4">
            <input type="checkbox" id="importReplace">
            <label for="importReplace" class="text-sm text-rose-600">Replace all existing data</label>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
            <div class="flex-1"></div>
            <button class="btn btn-primary" onclick="window.__app.commitImport()">
              <i data-lucide="upload"></i> Import
            </button>
          </div>
        </div>`,
    });
    lucide?.createIcons?.();
  }

  #renderImportDone(summary) {
    this.#modal.open('_raw', {
      html: `
        <div class="p-5">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold flex items-center gap-2">
              <i data-lucide="check-circle-2" style="width:18px;height:18px;color:#16a34a"></i> Import complete
            </h3>
            <button class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
          </div>
          <div class="grid grid-cols-2 gap-2 mb-3">
            <div class="card-muted p-3"><div class="text-xs text-zinc-500">Transactions</div><div class="text-xl font-semibold">${summary.transactions}</div></div>
            <div class="card-muted p-3"><div class="text-xs text-zinc-500">New accounts</div><div class="text-xl font-semibold">${summary.accounts}</div></div>
            <div class="card-muted p-3"><div class="text-xs text-zinc-500">New categories</div><div class="text-xl font-semibold">${summary.categories}</div></div>
            <div class="card-muted p-3"><div class="text-xs text-zinc-500">Debts</div><div class="text-xl font-semibold">${summary.debts}</div></div>
          </div>
          <div class="flex justify-end">
            <button class="btn btn-primary" onclick="window.__app.closeModal()"><i data-lucide="check"></i> Done</button>
          </div>
        </div>`,
    });
    lucide?.createIcons?.();
  }

  // ── CSV import keyword helpers ───────────────────────────────────────────

  #guessAccountType(name) {
    const n = name.toLowerCase();
    for (const [type, kws] of Object.entries(ACCOUNT_TYPE_KEYWORDS)) {
      if (kws.some((k) => n.includes(k))) return type;
    }
    return 'bank';
  }

  #deterministicColor(name) {
    const palette = ['#0ea5e9','#22c55e','#a855f7','#f97316','#14b8a6','#ec4899','#ef4444','#0891b2','#8b5cf6','#f59e0b'];
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return palette[h % palette.length];
  }

  #guessCatDefaults(name, type) {
    const n = name.toLowerCase();
    for (const def of CATEGORY_KEYWORD_DEFAULTS) {
      if (def.keys.some((k) => n.includes(k))) return { icon: def.icon, color: def.color };
    }
    if (type === 'income')   return { icon: 'banknote',         color: '#22c55e' };
    if (type === 'transfer') return { icon: 'arrow-right-left', color: '#737373' };
    return { icon: 'tag', color: this.#deterministicColor(name) };
  }

  #defaultAccIcon(type) {
    return ACCOUNT_TYPE_ICONS[type] || 'wallet';
  }
}

// Bootstrap - runs once after the DOM is ready.
// ES module scripts are deferred so DOMContentLoaded may already have fired.
function _showError(err) {
  console.error('[Pocket] Boot failed:', err);
  const target = document.getElementById('viewContent') || document.body;
  const div = document.createElement('div');
  div.style.cssText = 'padding:2rem;font-family:monospace;background:#fef2f2;border:1px solid #fca5a5;border-radius:12px;margin:2rem';
  div.innerHTML = '<strong style="color:#dc2626">Boot error</strong><br><br>'
    + '<pre style="white-space:pre-wrap;color:#7f1d1d;font-size:.8rem">'
    + String(err && err.stack ? err.stack : err)
    + '</pre>';
  target.prepend(div);
}

function _boot() {
  let app;
  try {
    app = Application.getInstance();
  } catch (err) {
    _showError(err);
    return;
  }
  app.init().catch(_showError);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _boot);
} else {
  // Already past DOMContentLoaded (module was defer-loaded)
  _boot();
}
