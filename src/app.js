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
  MEMBER_COLORS, ACCOUNT_TYPE_ICONS,
} from './data/constants.js';
import { RATES }               from './domain/services/FxRates.js';

// ── Domain services ──────────────────────────────────────────────────────────
import { IdGenerator }         from './domain/services/IdGenerator.js';
import { CurrencyService }     from './domain/services/CurrencyService.js';
import { HijriCalendarService }from './domain/services/HijriCalendarService.js';
import { AccountService }      from './domain/services/AccountService.js';
import { CategoryService }     from './domain/services/CategoryService.js';
import { TransactionService }  from './domain/services/TransactionService.js';
import { BudgetService }       from './domain/services/BudgetService.js';
import { RecurringService }    from './domain/services/RecurringService.js';
import { ReceiptScanService }  from './domain/services/ReceiptScanService.js';
import { SyncService }         from './domain/services/SyncService.js';
import { ThemeService }        from './domain/services/ThemeService.js';
import { PaymentTypeService }  from './domain/services/PaymentTypeService.js';
import { DateService }         from './domain/services/DateService.js';
import { ExchangeRateService } from './domain/services/ExchangeRateService.js';

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
import { BudgetDetailView }  from './ui/views/BudgetDetailView.js';
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
import { ReconcileModal }   from './ui/modals/ReconcileModal.js';
import { AuthModal }        from './ui/modals/AuthModal.js';
import { RegularItemModal }     from './ui/modals/RegularItemModal.js';
import { DayLogsModal }         from './ui/modals/DayLogsModal.js';
import { CurrencySetupModal }   from './ui/modals/CurrencySetupModal.js';

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
  /** @type {ThemeService}         */ #themeService;
  /** @type {PaymentTypeService}   */ #paymentTypeService;
  /** @type {ExchangeRateService}  */ #fxRates;

  // ── UI components ──────────────────────────────────────────────────────────
  /** @type {Toast}      */ #toast;
  /** @type {Modal}      */ #modal;
  /** @type {Navigation} */ #nav;

  // ── Views (lazy-created on first navigate) ─────────────────────────────────
  #views = /** @type {Map<string,object>} */ (new Map());

  // ── Modals (registered instances) ─────────────────────────────────────────
  #txModal           = null;  // TransactionModal — kept for split-state access
  #familyModal       = null;  // FamilyModal — kept for pendingPerms access
  #debtModal         = null;  // DebtModal — kept for payment-mode routing
  #reconcileModal    = null;  // ReconcileModal — kept for ledger-sum access
  #dayLogsModal      = null;  // DayLogsModal
  #currencySetupModal= null;  // CurrencySetupModal

  // ── Per-session UI state ──────────────────────────────────────────────────
  #reportRange    = '30';
  #importPlan     = null;
  #swipeTxId          = null;
  #swipeStartX        = 0;
  #swipeStartY        = 0;
  #swipeLastX         = 0;   // updated on every move; used by swipeEnd (no event arg needed)
  #swipeDeltaX        = 0;
  #swipeAxis          = null;   // 'x' | 'y' | null
  #swipeTriggered     = false;
  #swipeShareIndex    = -1;
  #swipeIsOwnContrib  = false;
  #swipeWrapper       = null;   // the .tx-swipe-wrapper element, stored on start

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
    this.#themeService       = new ThemeService(this.#store);
    this.#paymentTypeService = new PaymentTypeService(this.#store);
    this.#fxRates            = new ExchangeRateService();
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

    // 1b. Seed FX from last-saved live rates (offline-friendly), then refresh in
    // the background — stale hardcoded rates (e.g. USD→INR 83) get corrected to
    // the live value and the UI re-renders via state:changed when it lands.
    this.#fxRates.seedFromState();
    this.#fxRates.refresh().catch(() => {});

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
      onSignOut:  ()   => this.signOut(),
    });

    // 6. Register all modals
    this.#txModal        = new TransactionModal();
    this.#familyModal    = new FamilyModal();
    this.#debtModal      = new DebtModal();
    this.#reconcileModal = new ReconcileModal();
    this.#dayLogsModal   = new DayLogsModal({
      store:           this.#store,
      hijriService:    this.#hijri,
      currencyService: this.#fx,
    });
    this.#currencySetupModal = new CurrencySetupModal({ store: this.#store });
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
    this.#modal.register('reconcile',    this.#reconcileModal);
    this.#modal.register('dayLogs',      this.#dayLogsModal);
    this.#modal.register('currencySetup',this.#currencySetupModal);

    // 7. Subscribe to events
    // route:changed → only re-render the view panel (not the whole shell)
    this.#bus.on('route:changed', ({ route }) => this.#renderView(route));
    this.#bus.on('toast',         ({ message }) => this.#toast.show(message));
    // state:changed fires after pull/replaceState completes — full re-render
    this.#bus.on('state:changed',  () => this.#render());
    // auth:changed → only update the auth pill + nav; full re-render happens
    // after restoreSession() resolves (via .then(#render)) to avoid showing
    // seed data briefly before the cloud pull completes
    this.#bus.on('auth:changed', ({ user, showSignIn }) => {
      this.#nav.renderAuthPill(user ?? null);
      if (!user) {
        this.#render(); // show seed/default data immediately
        // If the session was invalidated by the backend (or the user signed out),
        // open the auth modal after a short delay so the UI finishes updating first
        if (showSignIn) {
          setTimeout(() => {
            if (!this.#sync.currentUser) this.openModal('auth');
          }, 300);
        }
      }
    });

    // 8. Initial render (shows locally-cached or seed data while Supabase loads)
    this.#render();

    // 9. Init Supabase — restores session, pulls cloud data, then re-renders
    if (this.#sync.init()) {
      this.#sync.restoreSession().then((result = {}) => {
        const { needsSignIn, isFirstSignIn } = result;
        this.#render();

        // Mirror the reference's updateAuthUI() call after pull() completes:
        // re-render the auth pill so #lastSyncStatus ('synced' or 'error') is
        // applied to the freshly-created syncIndicator element.  Without this,
        // any render() call between emitStatus('synced') and here could leave the
        // indicator blank or stuck on 'Syncing…'.
        this.#nav.renderAuthPill(this.#sync.currentUser);

        // First sign-in → open currency setup wizard
        if (isFirstSignIn) {
          setTimeout(() => this.openModal('currencySetup'), 600);
        }

        // No valid session found on load — prompt the user to sign in
        if (needsSignIn) {
          setTimeout(() => {
            if (!this.#sync.currentUser) this.openModal('auth');
          }, 300);
        }
      });
    }

    // 10. Sign-in hand-off from the marketing site: a "Sign in" link there points
    // to index.html#signin, which we detect here and open the auth modal.
    if (window.location.hash === '#signin') {
      history.replaceState(null, '', window.location.pathname);
      setTimeout(() => { if (!this.#sync.currentUser) this.openModal('auth'); }, 500);
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
          <div class="pt-3 border-t border-zinc-200 dark:border-zinc-800 mt-2">
            <button class="btn btn-outline w-full gap-2"
              onclick="window.__app.closeModal(); setTimeout(()=>window.__app.openModal('settings',{}),50)">
              <i data-lucide="settings"></i> Settings
            </button>
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
  getSbUser()     { return this.#sync.currentUser ?? null; }

  async signInWithGoogle() { await this.#sync.signInWithGoogle(); }

  /**
   * Sign out — always succeeds locally even if the Supabase revocation request
   * fails (network down, session already expired, etc.).
   * The auth pill updates instantly; the sign-in modal is shown automatically
   * via the auth:changed event with showSignIn: true.
   */
  async signOut() {
    // sync.signOut() fires auth.signOut() as fire-and-forget.
    // Supabase calls onAuthStateChange(SIGNED_OUT) synchronously before the network
    // request, so the SIGNED_OUT handler runs before this function returns.
    // That handler (when #user is set) emits auth:changed { showSignIn: true }
    // which schedules the auth modal — so we must NOT open it here too.
    try {
      await this.#sync.signOut();
    } catch (_) { /* safety net — signOut is fire-and-forget internally */ }
    this.#render();
  }

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

  toggleTheme() {
    const next = this.#themeService.toggle();
    this.#toast.show(`Theme: ${next}`);
    this.#render();
  }

  setTheme(v) {
    // ThemeService.set() persists + emits state:changed itself — no extra persist (#15).
    this.#themeService.set(v);
    this.closeModal(); this.#render();
    this.#toast.show(`Theme: ${v}`);
  }

  get paymentTypeService() { return this.#paymentTypeService; }

  addCustomPaymentType(sel) {
    const val = sel.value;
    if (val !== '__add_payment__') {
      sel.dataset.prev = val;
      return;
    }
    const name = prompt('Custom payment type name:');
    if (!name?.trim()) {
      sel.value = sel.dataset.prev || 'card';
      return;
    }
    const added = this.#paymentTypeService.addCustom(name);
    if (added) {
      sel.dataset.prev = added;
      this.#modal.refresh();
    }
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
    this.#render();
    this.#toast.show(`Calendar mode: ${v}`);
  }

  setGeminiKey(v) {
    this.#store.getState().user.geminiApiKey = v;
    this.#store.persist();
  }

  /**
   * Explicit "Save" for the AI key — persists the current input value and gives
   * the user clear confirmation that the app has accepted it (the field also
   * autosaves on input, but the button removes the "did it take?" doubt).
   */
  saveGeminiKey() {
    const inp = document.getElementById('geminiKeyInput');
    const v   = (inp?.value || '').trim();
    this.#store.getState().user.geminiApiKey = v;
    this.#store.persist();
    this.#modal.refresh?.();
    lucide?.createIcons?.();
    if (!v) {
      this.#toast.show('API key cleared');
    } else if (!/^AIza[\w-]{10,}$/.test(v)) {
      this.#toast.show('Saved — but this doesn’t look like a Google AI key');
    } else {
      this.#toast.show('✓ API key saved — receipt scanning enabled');
    }
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
    // When a family member adds a tx to a shared account (via sharedTxMode modal
    // or via the regular FAB modal with a shared account selected), send it to
    // the owner via family_contributions instead of saving locally.
    const sharedMode  = this.#txModal?.sharedTxMode;
    const allShared   = this.#sync.sharedData || [];
    // Find if the selected accountId belongs to any share
    const sharedMatch = !sharedMode && allShared.find((s) =>
      (s.accounts || []).some((a) => a.id === data.accountId),
    );

    if ((sharedMode || sharedMatch) && !id) {
      const currency  = data.currency;
      const minor     = this.#fx.toMinor(data.amount, currency);
      const sharedAcc = sharedMode
        ? allShared[sharedMode.shareIndex]
        : sharedMatch;
      if (!sharedAcc?._ownerId) return this.#toast.show('Shared account not found');
      const accountId = sharedMode ? (sharedMode.accountId || data.accountId) : data.accountId;
      // The tx lives in the OWNER's book, so exchangeRate/refAmount must be
      // relative to the owner's home currency (carried in the share snapshot),
      // not the contributing member's home currency (#21).
      const ownerHome = sharedAcc.homeCurrency || state.user.homeCurrency;
      const tx = {
        id:          IdGenerator.generate('tx'),
        accountId:   accountId,
        categoryId:  data.categoryId || null,
        amount:      minor,
        currency,
        exchangeRate: (RATES[currency] || 1) / (RATES[ownerHome] || 1),
        refAmount:   this.#fx.convert(minor, currency, ownerHome),
        payee:       data.payee || '',
        note:        data.note || '',
        date:        data.date,
        type:        data.type || 'expense',
        paymentType: data.paymentType || 'card',
        recordState: 'cleared',
        createdAt:   new Date().toISOString(),
        addedBy:     this.#sync.currentUser?.email || null,
      };
      try {
        await this.#sync.submitContribution(sharedAcc._ownerId, tx);
        this.closeModal();
        this.#toast.show('Transaction submitted');
        // Navigate to the shared account detail so the user can see the pending tx
        this.navigateToSharedAccount(sharedMode?.shareIndex ?? 0, accountId);
        // Schedule re-pulls so the member sees the owner's confirmed snapshot quickly
        this.#sync.scheduleSharesRefresh(3000);
        this.#sync.scheduleSharesRefresh(8000);
      } catch (e) {
        this.#toast.show('Failed to submit: ' + (e.message || e));
      }
      return;
    }

    const currency = data.currency;
    const minor    = this.#fx.toMinor(data.amount, currency);
    const exchRate = (RATES[currency] || 1) / (RATES[state.user.homeCurrency] || 1);
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
      if (!isFinite(rate) || rate <= 0) rate = (RATES[toCcy] || 1) / (RATES[currency] || 1);
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
      // Validate every split references a real, existing account (#13)
      const missingAcc = cleaned.find((s) => !s.accountId || !state.accounts.find((a) => a.id === s.accountId));
      if (missingAcc) return this.#toast.show('Pick an account for every split');
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
        // Revert both legs honoring their direction (works whether the edited
        // leg is 'out' or 'in') before re-normalizing tx='out' / pair='in'.
        this.#revertTransferPair(tx, pair, state);
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
            exchangeRate: ((RATES[xfer?.toCcy || currency] || 1)) / ((RATES[state.user.homeCurrency] || 1)),
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
        // Non-transfer edit → TransactionService.update reverts old balances,
        // applies the new ones, and persists+notifies (single source of truth).
        this.#transactions.update(id, {
          accountId: data.accountId,
          categoryId: splits ? null : (data.categoryId || null),
          amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
          payee: data.payee, note: data.note, date: data.date,
          paymentType: data.paymentType, type: data.type,
          splits, recurring,
        });
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
          createdAt: now, addedBy: this.#sync.currentUser?.email || null,
        };
        const txTo = {
          id: toId, accountId: data.transferToAccountId, categoryId: null,
          amount: dst, currency: toCcy,
          exchangeRate: ((RATES[toCcy] || 1)) / ((RATES[state.user.homeCurrency] || 1)),
          refAmount: this.#fx.convert(dst, toCcy, state.user.homeCurrency),
          payee: data.payee || 'Transfer', note: data.note, date: data.date,
          paymentType: 'transfer', recordState: 'cleared', type: 'transfer',
          transferPairId: fromId, transferRate: xfer?.rate ?? null, transferDir: 'in', tags: [],
          createdAt: now, addedBy: this.#sync.currentUser?.email || null,
        };
        state.transactions.push(txFrom, txTo);
        const fa = state.accounts.find((a) => a.id === data.accountId);
        if (fa) fa.balance -= this.#fx.convert(minor, currency, fa.currency);
        const ta = state.accounts.find((a) => a.id === data.transferToAccountId);
        if (ta) ta.balance += this.#fx.convert(dst, toCcy, ta.currency);
      } else {
        // New simple/split tx → TransactionService.create (pushes, applies
        // balances, persists+notifies). recordState/tags/transferPairId defaults
        // are supplied by the service.
        this.#transactions.create({
          accountId: data.accountId,
          categoryId: splits ? null : (data.categoryId || null),
          amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
          payee: data.payee, note: data.note, date: data.date,
          paymentType: data.paymentType, type: data.type,
          splits, recurring,
          addedBy: this.#sync.currentUser?.email || null,
        });
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
    if (!this.#transactions.find(id)) return;
    // TransactionService.delete reverts the leg (and its transfer pair) via the
    // shared balance engine, removes both rows, and persists+notifies.
    this.#transactions.delete(id);
    this.closeModal();
    this.#render();
    this.#toast.show('Transaction deleted');
    this.#sync.schedulePush?.();
  }

  /**
   * Member-side delete for a transaction they contributed to a shared account.
   * Sends a delete-marker contribution row to the owner and applies an
   * optimistic removal to the local shared view immediately.
   */
  async deleteSharedContrib(shareIndex, txId) {
    if (!confirm('Delete this transaction?')) return;
    const state = this.#store.getState();
    const share = (state._sharedData || [])[shareIndex];
    if (!share?._ownerId) return this.#toast.show('Shared account not found');
    try {
      await this.#sync.deleteContribution(share._ownerId, txId);
      this.#render();
      this.#toast.show('Transaction deleted');
    } catch (e) {
      this.#toast.show('Failed to delete: ' + (e.message || e));
    }
  }

  // Bulk delete — collects selectedIds from whichever view is active
  bulkDeleteTx() {
    const view = this.#views.get(this.#router.current);
    const ids  = view?.selectedIds ?? new Set();
    if (!ids.size) return;
    if (!confirm(`Delete ${ids.size} transaction${ids.size === 1 ? '' : 's'}?`)) return;
    const count = ids.size;
    // TransactionService.bulkDelete also reverts any transfer pairs of the
    // selected legs via the shared balance engine.
    this.#transactions.bulkDelete([...ids]);
    if (view?.clearMultiSelect) view.clearMultiSelect();
    this.#render();
    this.#toast.show(`${count} transactions deleted`);
    this.#sync.schedulePush?.();
  }

  // Shared (family) tx ops — delegate to SyncService.
  // Full-access members delete another member's tx by sending the owner a
  // delete-marker contribution (SyncService.deleteContribution), which also
  // applies an optimistic local revert.
  async deleteSharedTx(shareIndex, txId) {
    if (!confirm('Delete this transaction?')) return;
    const share = this.#sync.sharedData?.[shareIndex];
    if (!share?._ownerId) return this.#toast.show('Shared account not found');
    try {
      await this.#sync.deleteContribution(share._ownerId, txId);
      this.#render();
      this.#toast.show('Transaction deleted');
    } catch (e) {
      this.#toast.show('Failed to delete: ' + (e.message || e));
    }
  }

  /** Submit a delete contribution for a shared-account transaction. */
  async deleteSharedTxContrib(shareIndex, txId) {
    if (!confirm('Delete this transaction from the shared account?')) return;
    const sharedData = this.#sync.sharedData;
    const share = sharedData?.[shareIndex];
    if (!share?._ownerId) return this.#toast.show('Shared account not found');
    try {
      await this.#sync.submitContribution(share._ownerId, { _delete: true, targetId: txId, id: txId });
      this.closeModal();
      this.#toast.show('Delete request submitted to owner');
    } catch (e) {
      this.#toast.show('Failed: ' + (e.message || e));
    }
  }

  openSharedTxModal(shareIndex, accountId) {
    this.openModal('transaction', { sharedTxMode: { shareIndex, accountId } });
  }

  openSharedTxEdit(shareIndex, accountId, txId) {
    this.openModal('transaction', { sharedTxMode: { shareIndex, accountId, editTxId: txId } });
  }

  /**
   * Called by submitTx after a shared-account tx edit succeeds.
   * Navigates to the shared account detail so the member can see the updated tx.
   * The shareIndex/accountId are passed so we can set the correct view state.
   */
  navigateToSharedAccount(shareIndex, accountId) {
    const v = this.#getOrCreateView('accountDetail');
    v.setAccount(accountId, { shareIndex });
    this.#router.navigate('accountDetail');
    this.#render();
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
    const v = this.#views.get('accountDetail');
    v?.toggleMultiSelect?.();
    this.#render();
  }

  selectAllAccTx() {
    const v = this.#views.get('accountDetail');
    v?.selectAll?.();
    this.#render();
  }

  deselectAllAccTx() {
    const v = this.#views.get('accountDetail');
    v?.deselectAll?.();
    this.#render();
  }

  bulkDeleteAccTx() {
    const v = this.#views.get('accountDetail');
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

  /** Bulk delete selected transactions in a shared account view. */
  async bulkDeleteSharedAccTx(shareIndex) {
    const v = this.#views.get('accountDetail');
    if (!v) return;
    const ids = [...(v.selectedIds ?? new Set())];
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} transaction${ids.length === 1 ? '' : 's'}?`)) return;
    const state = this.#store.getState();
    const share = (state._sharedData || [])[shareIndex];
    if (!share?._ownerId) { this.#toast.show('Shared account not found'); return; }
    let done = 0, failed = 0;
    for (const txId of ids) {
      try {
        await this.#sync.deleteContribution(share._ownerId, txId);
        done++;
      } catch (_) { failed++; }
    }
    v.clearMultiSelect?.();
    this.#render();
    if (failed) this.#toast.show(`${done} deleted, ${failed} failed`);
    else this.#toast.show(`${done} transaction${done > 1 ? 's' : ''} deleted`);
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

  addSplit(defaultAccountId = null) {
    this.#txModal?.addSplit?.(defaultAccountId || document.querySelector('[name=accountId]')?.value || null);
    this.#modal.refresh();
    lucide?.createIcons?.();
  }

  removeSplit(i) {
    this.#txModal?.removeSplit?.(i);
    this.#modal.refresh();
    lucide?.createIcons?.();
  }

  setSplitAmount(i, val, currency) {
    this.#txModal?.setSplitAmount?.(i, val, currency);
    // updateSplitTotal() is called inline by oninput on the amount field,
    // so no full refresh needed here — avoids losing input focus.
  }

  setSplitField(i, field, val) { this.#txModal?.setSplitField?.(i, field, val); }

  /**
   * Lightweight DOM patch for the split tracker bar — called by oninput on each
   * split amount field.  Patches only #splitTotalBar and #splitDiffLine so focus
   * is never lost (no full modal re-render).
   */
  updateSplitTotal() {
    const modal   = this.#txModal;
    if (!modal) return;
    const barEl   = document.getElementById('splitTotalBar');
    const diffEl  = document.getElementById('splitDiffLine');
    if (!barEl && !diffEl) return;

    const form     = document.getElementById('txForm');
    const currency = form?.elements?.currency?.value ||
                     this.#store.getState().user.defaultCurrency || 'USD';
    const totalMinor = this.#fx.toMinor(Number(form?.elements?.amount?.value || 0), currency);

    // Re-read split amounts live from the form (don't rely on stale in-memory state)
    const splits = modal.splits || [];
    let sumMinor = 0;
    for (let i = 0; i < splits.length; i++) {
      const v = form?.elements?.[`split_amt_${i}`]?.value;
      sumMinor += this.#fx.toMinor(Number(v || 0), currency);
    }

    const diff    = totalMinor - sumMinor;
    const diffAbs = Math.abs(diff);
    const sumFmt  = this.#fx.formatMoney(sumMinor, currency);
    const totFmt  = this.#fx.formatMoney(totalMinor, currency);

    if (barEl) {
      barEl.innerHTML = `
        <div class="text-xs text-zinc-500">Split total</div>
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold">${sumFmt}</span>
          <span class="text-xs text-zinc-400">of</span>
          <span class="text-sm font-semibold">${totFmt}</span>
        </div>`;
    }

    if (diffEl) {
      if (diffAbs < 1) {
        diffEl.innerHTML = `<div class="flex items-center gap-1 text-xs mt-1 text-emerald-500"><i data-lucide="check" style="width:11px;height:11px"></i> Splits match total</div>`;
      } else {
        const color = diff < 0 ? 'text-rose-500' : 'text-amber-500';
        const label = diff < 0
          ? `${this.#fx.formatMoney(diffAbs, currency)} over`
          : `${this.#fx.formatMoney(diffAbs, currency)} remaining`;
        diffEl.innerHTML = `<div class="flex items-center gap-1 text-xs mt-1"><span class="${color} font-medium">${label}</span></div>`;
      }
      lucide?.createIcons?.();
    }
  }

  /**
   * Switch transaction type while preserving all current form values — payee,
   * note, date, payment, amount, and split state.
   */
  setTxType(type) {
    const form = document.getElementById('txForm');
    // Snapshot live form values before the re-render wipes them
    const snapshot = form ? Object.fromEntries(new FormData(form).entries()) : {};
    snapshot.type   = type;
    snapshot.amount = Number(snapshot.amount) || 0;

    // Preserve recurring rule state
    if (form?.elements?.recurringEnabled?.checked) {
      snapshot.recurring = {
        rule:     form.elements.recurringRule?.value     || 'monthly',
        interval: Number(form.elements.recurringInterval?.value) || 1,
        until:    form.elements.recurringUntil?.value   || null,
      };
    }

    // Re-open with the snapshot as a prefill so nothing is lost
    const savedSharedMode = this.#txModal?.sharedTxMode;
    this.#txModal?.setType?.(type);
    this.#modal.refresh();
    lucide?.createIcons?.();

    // Restore the fields that refresh() would otherwise blank (payee, note, date, etc.)
    if (form && snapshot.payee)       { const el = document.querySelector('[name=payee]');       if (el) el.value = snapshot.payee; }
    if (form && snapshot.note)        { const el = document.querySelector('[name=note]');        if (el) el.value = snapshot.note; }
    if (form && snapshot.date)        { const el = document.querySelector('[name=date]');        if (el) el.value = snapshot.date; }
    if (form && snapshot.paymentType) { const el = document.querySelector('[name=paymentType]'); if (el) el.value = snapshot.paymentType; }
  }

  toggleRecurringFields() {
    const el = document.getElementById('recurringFields');
    const inp = document.getElementById('recurringEnabled');
    if (el && inp) el.classList.toggle('hidden', !inp.checked);
  }

  /**
   * Keyword + merchant-learning category suggestion shown below the payee field.
   * Learned mappings (state.merchantCategories) take priority over keyword hints.
   */
  suggestCategory(payee) {
    const el = document.getElementById('catSuggest');
    if (!el) return;
    if (!payee || payee.length < 2) { el.innerHTML = ''; return; }

    const state = this.#store.getState();
    const p     = payee.toLowerCase();

    // 1. Learned mapping from previous saves
    const learned = state.merchantCategories?.[p];
    if (learned) {
      const cat = state.categories.find((c) => c.id === learned);
      if (cat) {
        el.innerHTML = `<i data-lucide="sparkles" style="width:12px;height:12px;display:inline"></i>
          Suggested: <button type="button" class="underline"
            onclick="window.__app.applySuggestedCategory('${cat.id}')">
            ${this.#esc(cat.name)}
          </button> <span class="text-zinc-500">(learned)</span>`;
        lucide?.createIcons?.();
        return;
      }
    }

    // 2. Keyword hints
    const KEYWORDS = {
      'Food & Drink':   ['food','market','grocery','starbucks','coffee','chipotle','trader','whole foods','restaurant','cafe','pizza','burger'],
      'Transport':      ['uber','lyft','shell','gas','fuel','metro','taxi','parking','transit'],
      'Shopping':       ['amazon','h&m','zara','target','walmart','store','shop','clothing'],
      'Entertainment':  ['netflix','spotify','cinema','movie','game','disney','hbo'],
      'Health':         ['pharmacy','walgreens','cvs','clinic','doctor','dentist'],
      'Housing':        ['rent','mortgage','landlord'],
      'Bills':          ['electric','internet','wifi','phone','utility','water'],
      'Education':      ['coursera','udemy','school','tuition','book'],
    };
    for (const [name, words] of Object.entries(KEYWORDS)) {
      if (words.some((w) => p.includes(w))) {
        const cat = state.categories.find((c) => c.name === name);
        if (cat) {
          el.innerHTML = `<i data-lucide="sparkles" style="width:12px;height:12px;display:inline"></i>
            Suggested: <button type="button" class="underline"
              onclick="window.__app.applySuggestedCategory('${cat.id}')">
              ${this.#esc(cat.name)}
            </button> <span class="text-zinc-500">(AI · 0.86 conf)</span>`;
          lucide?.createIcons?.();
          return;
        }
      }
    }
    el.innerHTML = '';
  }

  /** Apply a category suggestion — sets the category select in the open tx modal. */
  applySuggestedCategory(id) {
    const sel = document.querySelector('select[name=categoryId]');
    if (sel) { sel.value = id; this.#toast.show('Category applied'); }
  }

  updateHijriPreview(iso) {
    const el = document.getElementById('hijriDatePreview');
    if (!el || !iso) return;
    try {
      const state = this.#store.getState();
      if (!state.user.showHijri) { el.textContent = ''; return; }
      const h = this.#hijri.toHijri(new Date(iso));
      el.textContent = `${h.day} ${this.#hijri.monthsLong[h.month]} ${h.year}`;
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
    const autoRate = (RATES[toCcy] || 1) / (RATES[fromCcy] || 1);

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
      rateInp.value = ((RATES[toAcc.currency] || 1) / (RATES[fromAcc.currency] || 1)).toFixed(6);
    }
    this.updateTransferFxPanel(false);
  }

  onTxAccountChange(accId) {
    const state = this.#store.getState();
    // Check own accounts first, then shared accounts
    const acc = state.accounts.find((a) => a.id === accId)
      || (state._sharedData || []).flatMap((s) => s.accounts || []).find((a) => a.id === accId);
    const curEl = document.querySelector('[name=currency]');
    if (curEl && acc?.currency) curEl.value = acc.currency;
  }

  /**
   * Receipt scan — UI coordinator.
   *
   * Delegates all Gemini API interaction to ReceiptScanService (domain layer).
   * This method is responsible only for:
   *   1. Checking the API key and opening Settings if missing
   *   2. Updating the scan-label button text during the async call
   *   3. Opening a fresh pre-filled transaction modal on success
   *   4. Showing a specific error toast and restoring the button on failure
   */
  async scanReceipt(input) {
    const file = input?.files?.[0];
    if (!file) return;

    // ── No API key → open Settings immediately (mirror reference behaviour) ──
    if (!this.#store.getState().user.geminiApiKey?.trim()) {
      this.#toast.show('Add your free Google AI key in Settings first');
      this.openModal('settings');
      input.value = '';
      return;
    }

    // ── Scanning feedback: update the button label (mirror reference) ─────
    const scanLabel = input.closest('label');
    const scanText  = scanLabel?.querySelector('.scan-label-text');
    if (scanText) scanText.textContent = 'Scanning…';
    this.#toast.show('Scanning receipt with Gemini AI…');

    try {
      const scanner = new ReceiptScanService();
      const prefill = await scanner.scan(file);

      // Close the current modal (if open) and open a fresh, fully pre-filled one
      this.closeModal();
      this.openModal('transaction', { prefill });
      this.#toast.show('Receipt scanned · review and save');
    } catch (e) {
      // ── Specific error for missing key (thrown by ReceiptScanService) ──
      if (e.message === 'NO_API_KEY') {
        this.#toast.show('Add your free Google AI key in Settings first');
        this.openModal('settings');
      } else {
        this.#toast.show('Scan failed: ' + (e.message || 'Unknown error'));
      }
      // Restore button label on any failure
      if (scanText) scanText.textContent = 'Scan receipt with Gemini AI';
    } finally {
      input.value = '';
    }
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
    const today   = DateService.todayIso();

    // Resolve group
    const groupRes = this.#resolveAccountGroupId(data, state);
    if (groupRes.error) return this.#toast.show(groupRes.error);
    const { groupId } = groupRes;

    if (id) {
      const a = state.accounts.find((x) => x.id === id);
      if (!a) return;
      const wasMajor = a.balance;
      // Delegate the entity update to AccountService (mutates the same object);
      // the balance-adjustment ledger entry is orchestrated here.
      this.#accounts.update(id, { name: data.name, type: data.type, currency: data.currency, color: data.color, archived: !!data.archived, groupId });
      if (newMinor !== wasMajor) {
        const delta    = newMinor - wasMajor;
        const positive = delta > 0;
        const tx = {
          id: IdGenerator.generate('tx'), accountId: a.id, categoryId: null,
          amount: Math.abs(delta), currency: a.currency,
          exchangeRate: (RATES[a.currency] || 1) / (RATES[state.user.homeCurrency] || 1),
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

    // New account — AccountService owns the entity row; opening-balance ledger
    // entry is orchestrated here.
    const a     = this.#accounts.create({ name: data.name, type: data.type, currency: data.currency, color: data.color, icon: 'wallet', groupId });
    const newId = a.id;
    if (newMinor !== 0) {
      const positive = newMinor > 0;
      const tx = {
        id: IdGenerator.generate('tx'), accountId: newId, categoryId: null,
        amount: Math.abs(newMinor), currency: a.currency,
        exchangeRate: (RATES[a.currency] || 1) / (RATES[state.user.homeCurrency] || 1),
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
    // Also guard against accounts referenced only by a split leg, not just the
    // primary accountId — otherwise deleting orphans those splits (#25).
    const referenced = state.transactions.some((t) =>
      t.accountId === id ||
      (Array.isArray(t.splits) && t.splits.some((s) => (s.accountId || t.accountId) === id)),
    );
    if (referenced) {
      return this.#toast.show('Archive instead — account has transactions');
    }
    if (!confirm('Delete this account?')) return;
    this.#accounts.delete(id);
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

  /** Opens the ReconcileModal — the modal computes the residual via AccountService.ledgerSum(). */
  reconcileAccount(id) {
    const state  = this.#store.getState();
    const a      = state.accounts.find((x) => x.id === id);
    if (!a) return;
    const ledger = this.#accounts.ledgerSum(a, state.transactions);
    if (Math.abs(a.balance - ledger) < 1) {
      this.#toast.show('Already reconciled — no residual to log');
      return;
    }
    this.#modal.open('reconcile', { id });
  }

  /** Reconcile option A — called by ReconcileModal's "Add entry" button. */
  reconcileAddEntry(id) {
    const state  = this.#store.getState();
    const a      = state.accounts.find((x) => x.id === id);
    if (!a) return;
    const ledger   = this.#accounts.ledgerSum(a, state.transactions);
    const residual = a.balance - ledger;
    if (Math.abs(residual) < 1) { this.closeModal(); this.#toast.show('No residual to log'); return; }

    // Date: one day before earliest tx on this account, or today
    const earliest = state.transactions
      .filter((t) => t.accountId === a.id && t.date)
      .sort((x, y) => x.date.localeCompare(y.date))[0];
    let dateIso = DateService.todayIso();
    if (earliest) {
      const d = new Date(earliest.date + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      dateIso = DateService.toIso(d);
    }

    const absResidual = Math.abs(residual);
    const tx = {
      id:          IdGenerator.generate('tx'),
      accountId:   a.id,
      categoryId:  null,
      amount:      absResidual,
      currency:    a.currency,
      exchangeRate: (RATES[a.currency] || 1) / (RATES[state.user.homeCurrency] || 1),
      refAmount:   this.#fx.convert(absResidual, a.currency, state.user.homeCurrency),
      payee:       'Opening balance',
      note:        'Reconciled from existing account balance',
      date:        dateIso,
      paymentType: 'cash',
      recordState: 'cleared',
      type:        residual > 0 ? 'income' : 'expense',
      transferPairId: null,
      splits:      null,
      tags:        ['opening-balance', 'reconciled'],
      createdAt:   new Date().toISOString(),
    };
    // Don't applyBalances — a.balance is already correct; we're adding the missing ledger entry.
    state.transactions.push(tx);
    this.#store.persist();
    this.#sync.schedulePush?.();
    this.closeModal();
    this.#render();
    const sign = residual >= 0 ? '+' : '-';
    this.#toast.show(`Reconciled · added ${sign}${this.#fx.formatMoney(absResidual, a.currency)} opening balance entry`);
  }

  /** Reconcile option B — called by ReconcileModal's "Recalculate" button. */
  reconcileRecalculate(id) {
    const state  = this.#store.getState();
    const a      = state.accounts.find((x) => x.id === id);
    if (!a) return;
    const ledger   = this.#accounts.ledgerSum(a, state.transactions);
    const residual = a.balance - ledger;
    if (Math.abs(residual) < 1) { this.closeModal(); this.#toast.show('No residual'); return; }
    if (!confirm(`Balance will change from ${this.#fx.formatMoney(a.balance, a.currency)} to ${this.#fx.formatMoney(ledger, a.currency)}. No transactions are modified. Continue?`)) return;
    a.balance = ledger;
    this.#store.persist();
    this.closeModal();
    this.#render();
    this.#toast.show(`Balance recalculated to ${this.#fx.formatMoney(ledger, a.currency)}`);
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
    const state    = this.#store.getState();
    const groupIds = (state.accountGroups || []).map((g) => g.id);
    const validIds = new Set(groupIds);
    // Include '__none__' if any accounts are ungrouped, so Collapse All is truly complete
    const hasUngrouped = state.accounts.some((a) => !a.groupId || !validIds.has(a.groupId));
    state.user.collapsedAccountGroups = hasUngrouped ? [...groupIds, '__none__'] : groupIds.slice();
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
    // Delegate the actual mutation to CategoryService (single source of truth).
    const payload = { name: data.name, type: data.type, color: data.color, icon: data.icon, parentId };
    if (id) this.#categories.update(id, payload);
    else    this.#categories.create(payload);
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
    this.#categories.delete(id);  // also re-parents any orphaned children to root
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
    if (!Array.isArray(state.user.collapsedCategories)) state.user.collapsedCategories = [];
    const parentIds = state.categories
      .filter(c => !c.parentId && state.categories.some(ch => ch.parentId === c.id))
      .map(c => c.id);
    state.user.collapsedCategories = [...new Set([...state.user.collapsedCategories, ...parentIds])];
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
    // Checkbox group → use getAll (fromEntries keeps only the last value).
    const categoryIds = fd.getAll('categoryIds');
    if (!categoryIds.length) return this.#toast.show('Pick at least one category');
    const minor  = this.#fx.toMinor(data.amount, data.currency);
    const period = data.period === 'hijri' ? 'hijri' : 'gregorian';
    // Delegate to BudgetService (it also normalizes period on create). categoryId
    // is kept in sync with the first selection for backward compatibility.
    const payload = { categoryIds, categoryId: categoryIds[0], amount: minor, currency: data.currency, period, rollover: !!data.rollover };
    if (id) this.#budgets.update(id, payload);
    else    this.#budgets.create(payload);
    this.closeModal(); this.#render();
    this.#toast.show(id ? 'Budget updated' : 'Budget added');
    this.#sync.schedulePush?.();
  }

  deleteBudget(id) {
    if (!confirm('Delete this budget?')) return;
    this.#budgets.delete(id);
    this.closeModal(); this.#render();
    this.#sync.schedulePush?.();
  }

  /** Open the drill-in detail view for a single budget (its transactions). */
  openBudgetDetail(id) {
    const v = this.#getOrCreateView('budgetDetail');
    v.setBudget(id);
    this.#router.navigate('budgetDetail');
    this.#render();
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
    const exRate  = (RATES[currency] || 1) / (RATES[state.user.homeCurrency] || 1);
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
      exchangeRate: (RATES[debt.currency] || 1) / (RATES[state.user.homeCurrency] || 1),
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
    // Convert each payment into the debt's currency before comparing against the
    // principal — summing raw cross-currency amounts triggers auto-paid at the
    // wrong threshold (#11).
    const paid = payments.reduce((s, t) => s + this.#fx.convert(t.amount, t.currency, debt.currency), 0);
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
    if (!enabled) {
      this.#familyModal?.removePendingPerm(accountId);
    } else {
      // Default to 'view' when first enabling
      this.#familyModal?.setPendingPerm(accountId, 'view');
      this.#familyModal?.highlightPermLevel(accountId, 'view');
    }
  }

  updatePermLevel(accountId, level) {
    this.#familyModal?.setPendingPerm(accountId, level);
    this.#familyModal?.highlightPermLevel(accountId, level);
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
      frequency:     data.frequency  || 'monthly',
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
    const s = this.#store.getState();
    // Revert balances for all transactions linked to this regular item
    const linked = (s.transactions || []).filter(t => t.regularItemId === id);
    linked.forEach(t => this.#revertBalances(t, s));
    s.transactions = (s.transactions || []).filter(t => t.regularItemId !== id);
    s.regularItems = (s.regularItems || []).filter(i => i.id !== id);
    this.#store.persist();
    this.closeModal();
    this.#render();
    this.#sync.schedulePush?.();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Regular item log methods (DayLogsModal handlers)
  // ──────────────────────────────────────────────────────────────────────────

  submitRegularLog(e, date) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const itemId = fd.get('itemId');
    const s = this.#store.getState();
    const item = (s.regularItems || []).find(i => i.id === itemId);
    if (!item) return;
    const qty = parseFloat(fd.get('qty')) || 1;
    const unitPrice = parseFloat(fd.get('unitPrice')) || 0;
    const currency = item.currency || s.user.homeCurrency;
    const unitMinor = this.#fx.toMinor(unitPrice, currency);
    const totalMinor = Math.round(unitMinor * qty);
    const accountId = item.accountId || s.accounts[0]?.id;
    const tx = {
      id: IdGenerator.generate('tx'),
      regularItemId: itemId,
      accountId,
      date,
      amount: totalMinor,
      unitAmount: unitMinor,
      qty,
      currency,
      description: item.name,
      payee: item.name,
      note: '',
      type: 'expense',
      categoryId: item.categoryId || null,
      splits: [],
      paymentType: 'cash',
      recurring: false,
      recordState: 'cleared',
      createdAt: new Date().toISOString(),
    };
    this.#applyBalances(tx, s);
    s.transactions.push(tx);
    this.#store.persist();
    this.#sync.schedulePush?.();
    this.openModal('dayLogs', { date });
  }

  deleteRegularLog(logId, date) {
    const s = this.#store.getState();
    const tx = s.transactions.find(t => t.id === logId);
    if (tx) {
      this.#revertBalances(tx, s);
      s.transactions = s.transactions.filter(t => t.id !== logId);
      this.#store.persist();
      this.#sync.schedulePush?.();
    }
    this.openModal('dayLogs', { date });
  }

  prefillRegularLog(sel) {
    const opt = sel.options[sel.selectedIndex];
    const price = parseFloat(opt?.dataset?.price) || 0;
    const unitEl  = document.getElementById('dayLogUnit');
    const qtyEl   = document.getElementById('dayLogQty');
    const totalEl = document.getElementById('dayLogTotal');
    if (unitEl)  unitEl.value  = price > 0 ? price.toFixed(2) : '';
    if (totalEl && qtyEl) {
      const qty = parseFloat(qtyEl.value) || 1;
      totalEl.value = price > 0 ? (price * qty).toFixed(2) : '';
    }
  }

  updateRegularLogTotal() {
    const qty  = parseFloat(document.getElementById('dayLogQty')?.value)  || 1;
    const unit = parseFloat(document.getElementById('dayLogUnit')?.value) || 0;
    const el   = document.getElementById('dayLogTotal');
    if (el) el.value = (qty * unit).toFixed(2);
  }

  saveCurrencySetup() {
    const sel = document.getElementById('setupCurrency');
    if (sel) this.#store.getState().user.homeCurrency = sel.value;
    this.#store.persist();
    this.closeModal();
    this.#toast.show(`Home currency set to ${sel?.value || ''}`);
    this.#render();
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

  /**
   * @param {TouchEvent} event
   * @param {string}     id            Transaction ID
   * @param {number}     shareIndex    Index into _sharedData (-1 for owned tx)
   * @param {boolean}    isOwnContrib  True if this is a member's own contribution
   */
  onTxSwipeStart(event, id, shareIndex = -1, isOwnContrib = false) {
    if (event.touches.length !== 1) return;
    this.#swipeTxId         = id;
    this.#swipeShareIndex   = shareIndex;
    this.#swipeIsOwnContrib = !!isOwnContrib;
    this.#swipeStartX       = event.touches[0].clientX;
    this.#swipeStartY       = event.touches[0].clientY;
    this.#swipeLastX        = this.#swipeStartX;
    this.#swipeDeltaX       = 0;
    this.#swipeAxis         = null;
    this.#swipeTriggered    = false;
    // Store the wrapper element so swipeEnd can find .tx-row-content without needing event.currentTarget
    this.#swipeWrapper      = event.currentTarget;
  }

  onTxSwipeMove(event) {
    if (!this.#swipeTxId || this.#swipeTriggered) return;
    const touch = event.touches[0];
    const dx = touch.clientX - this.#swipeStartX;
    const dy = touch.clientY - this.#swipeStartY;
    this.#swipeLastX = touch.clientX;

    // Lock axis after 4 px of movement
    if (!this.#swipeAxis) {
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4)
        this.#swipeAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      return;
    }
    if (this.#swipeAxis !== 'x') return;

    this.#swipeDeltaX = dx;
    if (dx < 0) {
      event.preventDefault();
      const c = this.#swipeWrapper?.querySelector('.tx-row-content');
      if (c) c.style.transform = `translateX(${Math.max(dx, -80)}px)`;
    }
  }

  // Called from ontouchend with no arguments — uses stored state instead of event.
  onTxSwipeEnd() {
    if (!this.#swipeTxId || this.#swipeTriggered) return;
    const dx = this.#swipeLastX - this.#swipeStartX;
    const c  = this.#swipeWrapper?.querySelector('.tx-row-content');

    if (dx < -55) {
      this.#swipeTriggered = true;
      if (c) {
        c.style.transition = 'transform .15s ease, opacity .18s ease';
        c.style.transform  = 'translateX(-80px)';
        c.style.opacity    = '0';
      }
      const id  = this.#swipeTxId;
      const si  = this.#swipeShareIndex;
      const own = this.#swipeIsOwnContrib;
      setTimeout(() => {
        if (si >= 0 && own) this.deleteSharedContrib(si, id);
        else if (si >= 0)   this.deleteSharedTx(si, id);
        else                this.deleteTx(id);
        this.#swipeTxId = null;
      }, 200);
    } else {
      if (c) { c.style.transition = ''; c.style.transform = ''; }
      this.#swipeTxId = null;
    }
    this.#swipeDeltaX    = 0;
    this.#swipeAxis      = null;
    this.#swipeTriggered = false;
    this.#swipeWrapper   = null;
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
    const today = DateService.todayIso();
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

    // Override new-account currencies with the most-used currency from their transactions
    const currencyVotes = {}; // norm(accName) → { currency → count }
    plan.txDrafts.forEach((d) => {
      const key = norm(d.accountName);
      if (!currencyVotes[key]) currencyVotes[key] = {};
      if (d.currency) currencyVotes[key][d.currency] = (currencyVotes[key][d.currency] || 0) + 1;
    });
    state.accounts.forEach((a) => {
      const votes = currencyVotes[norm(a.name)];
      if (!votes) return;
      const dominant = Object.entries(votes).sort((x, y) => y[1] - x[1])[0]?.[0];
      if (dominant) a.currency = dominant;
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
      const exRate  = (RATES[draft.currency] || 1) / (RATES[state.user.homeCurrency] || 1);
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
        const txT = { id: toId, accountId: toAccId, categoryId: null, amount: dstMinor, currency: toCcy, exchangeRate: (RATES[toCcy] || 1) / (RATES[state.user.homeCurrency] || 1), refAmount: this.#fx.convert(dstMinor, toCcy, state.user.homeCurrency), payee: draft.payee, note: draft.note, date: draft.date, paymentType: draft.paymentType, recordState: 'cleared', type: 'transfer', transferPairId: fromId, transferDir: 'in', tags: draft.tags || [], createdAt: draft.createdAt || new Date().toISOString(), addedBy: draft.addedBy || null };
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
    const state = this.#store.getState();
    state._sharedData        = this.#sync.sharedData;
    state._currentUserEmail  = this.#sync.currentUser?.email || null;
    const route = this.#router.current || 'dashboard';
    this.#renderView(route);
    // Navigation.render() reads the active route from the Router itself; passing
    // a stale route arg here was ignored and risked an active-state race (#24).
    this.#nav.render();
    lucide?.createIcons?.();
  }

  #renderView(routeId) {
    const view    = this.#getOrCreateView(routeId);
    const content = document.getElementById('viewContent');
    if (!content) return;

    // ── Save focus state before replacing innerHTML ────────────────────
    const active   = document.activeElement;
    const focusKey = active?.dataset?.focusKey || null;
    let selStart = null, selEnd = null;
    if (focusKey) {
      try { selStart = active.selectionStart; selEnd = active.selectionEnd; } catch (_) {}
    }

    const html = view.render?.() ?? '';
    content.innerHTML = html;
    view.onAfterRender?.();
    lucide?.createIcons?.();

    // ── Restore focus after render ─────────────────────────────────────
    if (focusKey) {
      const el = content.querySelector(`[data-focus-key="${focusKey}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        if (selStart != null && typeof el.setSelectionRange === 'function') {
          try { el.setSelectionRange(selStart, selEnd); } catch (_) {}
        }
      }
    }
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
      case 'budgetDetail': view = new BudgetDetailView(); break;
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
    this.#themeService.apply();
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

    // customPaymentTypes back-fill
    if (!Array.isArray(state.user.customPaymentTypes)) state.user.customPaymentTypes = [];

    // collapsedCategories back-fill
    if (!Array.isArray(state.user.collapsedCategories)) state.user.collapsedCategories = [];

    // regularItems.accountId back-fill
    if (Array.isArray(state.regularItems)) {
      state.regularItems.forEach(it => {
        if (!it.accountId && Array.isArray(state.accounts) && state.accounts[0]?.id) {
          it.accountId = state.accounts[0].id;
        }
      });
    }

    // Migrate legacy regularLogs → real transactions
    if (Array.isArray(state.regularLogs) && state.regularLogs.length > 0) {
      if (!Array.isArray(state.transactions)) state.transactions = [];
      state.regularLogs.forEach(log => {
        const exists = state.transactions.some(t => t.id === log.id || t.regularLogId === log.id);
        if (!exists) {
          state.transactions.push({
            id: log.id,
            regularLogId: log.id,
            regularItemId: log.regularItemId,
            accountId: log.accountId || state.accounts?.[0]?.id,
            date: log.date,
            amount: log.amount,
            currency: log.currency || state.user?.homeCurrency || 'USD',
            description: log.note || '',
            payee: log.note || '',
            note: '',
            type: 'expense',
            categoryId: null,
            splits: [],
            paymentType: 'cash',
            recurring: false,
            qty: log.qty || 1,
            unitAmount: log.unitAmount || log.amount,
            recordState: 'cleared',
            createdAt: new Date().toISOString(),
          });
        }
      });
      delete state.regularLogs;
    }

    // Budget period schema: collapse legacy 'monthly' to the canonical
    // 'gregorian'. Only 'hijri' is special-cased everywhere else, so this keeps
    // a single non-hijri value and stops the first edit from silently mutating
    // the stored period (#12/#18).
    if (Array.isArray(state.budgets)) {
      state.budgets.forEach((b) => {
        if (b && b.period !== 'hijri') b.period = 'gregorian';
        // Multi-category budgets: backfill categoryIds from the legacy single id.
        if (b && !Array.isArray(b.categoryIds)) b.categoryIds = b.categoryId ? [b.categoryId] : [];
      });
    }

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

  // Balance mutations delegate to AccountService — the single source of truth
  // (I1). AccountService operates on the same Store state instance, so the
  // `state` argument is accepted for call-site compatibility but unused here.
  // It handles splits, transfers (direction-aware), and FX conversion.
  /** Minimal HTML-escape for user-supplied strings interpolated into innerHTML (B6). */
  #esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (m) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  #applyBalances(tx, _state) {
    this.#accounts.applyBalances(tx);
  }

  #revertBalances(tx, _state) {
    this.#accounts.revertBalances(tx);
  }

  #revertTransferPair(tx, pair, _state) {
    this.#accounts.revertTransferPair(tx, pair);
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
    // Anchor at local noon so dates on the 1st aren't dropped in UTC- zones (#27).
    const d     = new Date(iso + 'T12:00:00');
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
      if (type === 'debit')                   type = 'expense';
      if (type === 'credit')                  type = 'income';
      if (type === 'borrow')                  type = 'borrowed';
      if (type === 'lend' || type === 'loan') type = 'lent';
      if (!['expense','income','transfer','borrowed','lent'].includes(type)) return;

      const acctName = (r.account || '').trim();
      if (!acctName) return;
      const currency = ((r.currency || state.user.homeCurrency).toUpperCase());
      if (!RATES[currency]) return;
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
        const toCcy    = (rawToCcy && RATES[rawToCcy]) ? rawToCcy : currency;
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

// ── Window globals for HTML onclick= wrappers ──────────────────────────────
window.toggleTheme           = ()      => window.__app.toggleTheme();
window.setTheme              = (m)     => window.__app.setTheme(m);
window.addCustomPaymentType  = (s)     => window.__app.addCustomPaymentType(s);
window.submitRegularLog      = (e, d)  => window.__app.submitRegularLog(e, d);
window.deleteRegularLog      = (id, d) => window.__app.deleteRegularLog(id, d);
window.prefillRegularLog     = (s)     => window.__app.prefillRegularLog(s);
window.updateRegularLogTotal = ()      => window.__app.updateRegularLogTotal();
window.saveCurrencySetup     = ()      => window.__app.saveCurrencySetup();

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
