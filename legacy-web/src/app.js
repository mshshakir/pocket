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
import { StateMigrator } from './data/StateMigrator.js';
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
import { AccountRef }          from './domain/services/AccountRef.js';
import { RegularLogService }   from './domain/services/RegularLogService.js';
import { ReceiptScanService }  from './domain/services/ReceiptScanService.js';
import { SyncService }         from './domain/services/SyncService.js';
import { ThemeService }        from './domain/services/ThemeService.js';
import { PaymentTypeService }  from './domain/services/PaymentTypeService.js';
import { AccountGroupService } from './domain/services/AccountGroupService.js';
import { FamilyShareService }  from './domain/services/FamilyShareService.js';
import { DateService }         from './domain/services/DateService.js';
import { ExchangeRateService } from './domain/services/ExchangeRateService.js';

// ── UI components ────────────────────────────────────────────────────────────
import { Toast }      from './ui/components/Toast.js';
import { Modal }      from './ui/components/Modal.js';
import { Navigation } from './ui/components/Navigation.js';
import { CategoryPickerSheet } from './ui/components/CategoryPickerSheet.js';
import { AccountGroupSheet }   from './ui/components/AccountGroupSheet.js';
import { AccountShareSheet }   from './ui/components/AccountShareSheet.js';
import { PaymentMethodSheet }  from './ui/components/PaymentMethodSheet.js';
import { CategoryField }       from './ui/components/CategoryField.js';
import { VoiceRecorder }       from './ui/components/VoiceRecorder.js';
import { VoiceOverlay }        from './ui/components/VoiceOverlay.js';
import { SwipeRowController }  from './ui/components/SwipeRowController.js';
import { Space }               from './domain/services/Space.js';
import { SpaceRegistry }       from './domain/services/SpaceRegistry.js';
import { SpaceSheet }          from './ui/components/SpaceSheet.js';

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
  /** @type {RegularLogService}    */ #regularLogs;
  /** @type {SyncService}          */ #sync;
  /** @type {ThemeService}         */ #themeService;
  /** @type {PaymentTypeService}   */ #paymentTypeService;
  /** @type {AccountGroupService}  */ #accountGroups;
  /** @type {FamilyShareService}   */ #familyShares;
  /** @type {ExchangeRateService}  */ #fxRates;

  // ── UI components ──────────────────────────────────────────────────────────
  /** @type {Toast}      */ #toast;
  /** @type {Modal}      */ #modal;
  /** @type {Navigation} */ #nav;
  /** @type {CategoryPickerSheet} */ #catPicker;
  /** @type {PaymentMethodSheet}  */ #paymentSheet;
  /** @type {AccountGroupSheet}   */ #accountGroupSheet;
  /** @type {AccountShareSheet}   */ #accountShareSheet;

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
  /** @type {SwipeRowController} — owns all row-swipe gesture + reveal state */
  #swipe              = null;
  /** @type {SpaceRegistry} */
  #spaces             = null;
  /** @type {SpaceSheet} */
  #spaceSheet         = null;
  #filterRenderTimer  = null;   // debounce for the transaction search box
  #voice              = null;   // { recorder, overlay, done } while a voice entry is in progress
  /** @type {ReceiptScanService|null} lazily built — see get receiptScanner() */
  #receipts           = null;

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
    this.#regularLogs = new RegularLogService({ store: this.#store });
    this.#sync        = new SyncService();
    this.#themeService       = new ThemeService(this.#store);
    this.#paymentTypeService = new PaymentTypeService(this.#store);
    this.#accountGroups      = new AccountGroupService(this.#store);
    this.#familyShares       = new FamilyShareService(this.#store);
    this.#fxRates            = new ExchangeRateService();
    // Which book the UI is showing. Reads flow through it (BaseView.state);
    // writes never do — the services keep talking to real local state.
    this.#spaces             = new SpaceRegistry({
      store: this.#store,
      sync:  this.#sync,
      spaceFactory: (opts) => new Space(opts),
    });
    this.#toast       = new Toast();
    this.#modal       = new Modal();
    this.#nav         = new Navigation();
    this.#catPicker   = new CategoryPickerSheet({
      store:           this.#store,
      categoryService: this.#categories,
    });
    this.#paymentSheet = new PaymentMethodSheet({
      paymentTypeService: this.#paymentTypeService,
    });
    this.#accountGroupSheet = new AccountGroupSheet({
      store:               this.#store,
      accountGroupService: this.#accountGroups,
      currencyService:     this.#fx,
    });
    this.#accountShareSheet = new AccountShareSheet({
      store:              this.#store,
      familyShareService: this.#familyShares,
      syncService:        this.#sync,
    });
    this.#spaceSheet = new SpaceSheet({ spaceRegistry: this.#spaces });
    // The controller owns the gesture; the app owns what deleting means. The
    // revealed button is itself the confirmation, so these are the no-dialog
    // variants of the delete methods.
    this.#swipe = new SwipeRowController({
      onDelete: ({ id, shareIndex, isOwnContrib }) => {
        if (shareIndex >= 0 && isOwnContrib) this.deleteSharedContrib(shareIndex, id, { confirm: false });
        else if (shareIndex >= 0)            this.deleteSharedTx(shareIndex, id, { confirm: false });
        else                                 this.deleteTx(id, { confirm: false });
      },
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Initialisation
  // ──────────────────────────────────────────────────────────────────────────

  /** Boot the application. Call once after DOMContentLoaded. */
  async init() {
    // 0. Register the derive hook so the Store recomputes account balances from
    //    the ledger on every persist (balances are derived, not stored).
    this.#store.setDeriveHook(() => this.#accounts.recompute());

    // 0b. Every LOCAL mutation schedules a cloud push from one place. Roughly
    //     twenty mutations (home currency, Hijri offset, debt edits, reconcile,
    //     group changes…) previously persisted without calling schedulePush,
    //     so the next pull silently reverted them. replaceState()/reset() are
    //     excluded by Store, since those apply remote or seed data.
    this.#store.setLocalChangeHook(() => this.#sync.schedulePush?.());

    // 1. Load or seed state (StateMigrator back-fills schema + openingBalance)
    this.#store.init(() => SeedFactory.create(), (s) => StateMigrator.migrate(s));
    this.#ensureUserDefaults();
    // Heal any pre-existing balance inconsistency by deriving once up front.
    this.#accounts.recompute();
    if (this.#store.repositoryCorrupted) {
      this.#bus.emit('toast', { message: 'Saved data was unreadable — a backup was kept (pocket.v1.corrupt)' });
    }

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
    // Mounted after Modal so their overlays stack above any open modal — a
    // sheet must not tear down the transaction form underneath it.
    this.#catPicker.mount(container);
    this.#paymentSheet.mount(container);
    this.#accountGroupSheet.mount(container);
    this.#accountShareSheet.mount(container);
    this.#spaceSheet.mount(container);
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
      store:              this.#store,
      hijriService:       this.#hijri,
      currencyService:    this.#fx,
      regularLogService:  this.#regularLogs,
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
    this.#bus.on('state:changed',  () => {
      // A pull may have removed the space the user is standing in. Check before
      // rendering, or the first frame after a revocation renders against a
      // snapshot that is already gone.
      this.#reconcileSpaces();
      this.#render();
    });
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

  /**
   * Modals that create or edit something in the CURRENT book. In a guest space
   * they have no meaning: the services they submit to write to real local
   * state, so opening one there would quietly file the user's edit into their
   * own book while the screen showed someone else's.
   *
   * Phase 1 refuses them rather than routing them. Making budgets, debts,
   * categories and regulars editable in a guest space needs a contribution
   * payload and an authorisation branch per kind — that is phase 2.
   */
  static #HOME_ONLY_MODALS = new Set([
    'account', 'budget', 'category', 'debt', 'debtPayment', 'regularItem',
    'csv', 'reconcile', 'family', 'currencySetup',
  ]);

  openModal(name, opts = {}) {
    const space = this.#spaces?.active?.();
    if (space && !space.isHome && Application.#HOME_ONLY_MODALS.has(name)) {
      this.#toast.show(`Switch to your own space to change that — you're in ${space.label}`);
      return;
    }
    // A new transaction inside a guest space is a CONTRIBUTION to the owner,
    // not a row in the member's book. Route it before the modal opens, so the
    // form comes up pointed at the right ledger instead of being corrected
    // afterwards by the account-change handler.
    if (space && !space.isHome && name === 'transaction' && !opts.id
        && !opts.sharedTxMode && !opts.editTxId) {
      const target = space.accounts.find((a) => space.canAdd(a.id));
      if (!target) {
        this.#toast.show(`You have view-only access to ${space.label}`);
        return;
      }
      return this.#modal.open('transaction', {
        ...opts,
        sharedTxMode: { shareIndex: this.#shareIndexForOwner(space.id), accountId: target.id, ownerId: space.id },
      });
    }
    // debtPayment needs to route to DebtModal in payment mode
    if (name === 'debtPayment') {
      this.#modal.open('debtPayment', { ...opts, mode: 'payment' });
    } else {
      this.#modal.open(name, opts);
    }
    lucide?.createIcons?.();
  }

  closeModal() {
    if (this.#catPicker?.isOpen)         this.#catPicker.close();
    if (this.#paymentSheet?.isOpen)      this.#paymentSheet.close();
    if (this.#accountGroupSheet?.isOpen) this.#accountGroupSheet.close();
    if (this.#accountShareSheet?.isOpen) this.#accountShareSheet.close();
    this.#modal.close();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Category picker
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * The sheet instance — inline onclick handlers inside the sheet call through
   * window.__app.catPicker.*, which keeps the Application surface uncluttered.
   * @returns {CategoryPickerSheet}
   */
  get catPicker() { return this.#catPicker; }

  /**
   * Regular-item logs across both books (local + contributions to shared
   * accounts). CalendarView and DayLogsModal read through this so an entry
   * logged against a shared account doesn't disappear from the calendar.
   * @returns {RegularLogService}
   */
  get regularLogs() { return this.#regularLogs; }

  /**
   * The category list a field should browse.
   *
   * A row destined for someone else's book must carry one of THEIR category
   * ids — a local id is meaningless there and the owner sees the transaction as
   * "Uncategorised". The owner's whole tree (parents AND subcategories) travels
   * in the family-share snapshot, so resolve it by stable owner id.
   *
   * @param {string|null} ownerId  '' / null → the local book
   * @returns {object[]}
   */
  categoriesForOwner(ownerId) {
    if (!ownerId) return this.#store.getState().categories;
    const share = this.#sync.shareByOwner?.(ownerId)
      || (this.#sync.sharedData || []).find((s) => s._ownerId === ownerId);
    return share?.categories || [];
  }

  /**
   * Owner id of the share that holds `accountId`, or null when the account is
   * one of the user's own (or unknown).
   * @param {string} accountId
   * @returns {string|null}
   */
  ownerIdForAccount(accountId) {
    if (!accountId) return null;
    if (this.#store.getState().accounts.some((a) => a.id === accountId)) return null;
    const share = (this.#sync.sharedData || []).find((s) =>
      (s.accounts || []).some((a) => a.id === accountId),
    );
    return share?._ownerId || null;
  }

  /**
   * Open the two-step category picker for a CategoryField.
   *
   * Everything the picker needs is read from the field's data-* attributes, so
   * any modal can drop in a field without adding a bespoke handler here. The
   * result is written straight back into the field's hidden inputs — no modal
   * refresh, so a half-filled transaction form survives the round trip.
   *
   * When the field carries data-ownerid it belongs to a shared account, so the
   * sheet browses that owner's categories (read-only) rather than the local book.
   *
   * @param {string} fieldId
   */
  openCategoryPicker(fieldId) {
    const field = document.getElementById(fieldId);
    if (!field) return;

    const mode    = field.dataset.mode === 'multi' ? 'multi' : 'single';
    const type    = field.dataset.type || null;
    const title   = field.dataset.title || '';
    const onPick  = field.dataset.onpick || '';
    const ownerId = field.dataset.ownerid || '';
    const catList = this.categoriesForOwner(ownerId);

    this.#catPicker.open({
      mode,
      type,
      title,
      selected: CategoryField.getValue(field),
      // null → local book (the picker keeps its own CategoryService and can add)
      categories: ownerId ? catList : null,
      onSelect: (ids) => {
        // Re-resolve the element: the sheet may have created a category, which
        // flushes the store and re-renders the background view.
        const live = document.getElementById(fieldId) || field;
        // Label from the SAME book the ids came from, so a shared pick doesn't
        // fall back to the "Uncategorised" placeholder.
        CategoryField.setValue(live, ids, ownerId ? catList : this.#store.getState().categories);
        lucide?.createIcons?.();
        if (onPick && typeof this[onPick] === 'function') this[onPick](fieldId, ids);
      },
    });
  }

  /**
   * onPick hook for split rows — mirrors the chosen category back into the
   * in-memory split model. The field id encodes the row index (splitCat_<i>).
   * @param {string} fieldId
   * @param {string[]} ids
   */
  onSplitCategoryPicked(fieldId, ids) {
    const i = Number(fieldId.split('_')[1]);
    if (Number.isInteger(i)) this.#txModal?.setSplitField?.(i, 'categoryId', ids[0] || null);
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

  /**
   * Preferred account for new entry forms. '' means "no preference — use the
   * first account", which is what the app did unconditionally before.
   * @param {string} v  account id, or '' to clear the preference
   */
  setDefaultAccount(v) {
    const state = this.#store.getState();
    state.user.defaultAccountId = v || '';
    this.#store.persist();
    // Unlike the currency rows this keeps Settings open — the two default
    // pickers sit next to each other and are usually set together.
    this.#refreshModal();
    const acc = state.accounts.find((a) => a.id === v);
    this.#toast.show(acc ? `Default account: ${acc.name}` : 'Default account: first in list');
  }

  /** @param {string} v  payment method name */
  setDefaultPaymentType(v) {
    this.#store.getState().user.defaultPaymentType = v || 'card';
    this.#store.persist();
    this.#refreshModal();
    this.#toast.show('Default payment: ' + (v || 'card'));
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
  /** The space registry — BaseView reads through this on every render. */
  get spaces() { return this.#spaces; }
  /** Which modal is open, if any — used by the smoke suites. */
  get modalActive() { return this.#modal?.active ?? null; }
  /** The transaction modal instance, for suites that inspect sharedTxMode. */
  get txModal() { return this.#txModal; }
  /** The Store singleton, so a suite can assert projection identity. */
  get store() { return this.#store; }
  /** SyncService, for suites that drive a pull directly. */
  get sync() { return this.#sync; }
  /** Exposed so modals can resolve the Settings default-account preference. */
  get accountService() { return this.#accounts; }
  /**
   * One scanner instance for both the receipt and voice paths, rather than a
   * fresh object per invocation. Also gives the smoke suites a seam to drive
   * parseVoice() directly instead of faking a microphone.
   */
  get receiptScanner() {
    if (!this.#receipts) this.#receipts = new ReceiptScanService();
    return this.#receipts;
  }

  /**
   * The manage sheet — inline handlers inside it dispatch through
   * window.__app.paymentSheet.*.
   * @returns {PaymentMethodSheet}
   */
  get paymentSheet() { return this.#paymentSheet; }

  /**
   * Router for the payment <select>. Two of its entries are commands rather
   * than values: "Add custom…" and "Manage methods…". Both restore the previous
   * selection first, so cancelling out of either leaves the form untouched.
   * @param {HTMLSelectElement} sel
   */
  /**
   * Payment-type chip tapped (mobile-style selector). Plain values update the
   * hidden `paymentType` input + chip styling in place (no re-render); the two
   * command chips route to add / manage.
   * @param {string} value
   */
  pickPaymentType(value) {
    if (value === '__add_payment__')    return this.addCustomPaymentType();
    if (value === '__manage_payment__') return this.openPaymentTypeManager();
    const hidden = document.getElementById('paymentTypeInput');
    if (hidden) hidden.value = value;
    document.querySelectorAll('[data-pay-chip]').forEach((el) => {
      const on = el.getAttribute('data-pay-chip') === value;
      el.className = 'px-3 py-1.5 rounded-full border text-sm ' + (on
        ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900'
        : 'border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800');
    });
  }

  addCustomPaymentType() {
    const name = prompt('Custom payment type name:');
    if (!name?.trim()) return;
    const added = this.#paymentTypeService.addCustom(name);
    if (!added) return;
    if (this.#modal.active === 'transaction') {
      // Preserve typed fields, then select the new method and re-render so the
      // chip appears and is active.
      this.#txModal?.captureForm?.();
      this.#txModal?.setPaymentType?.(added);
      this.#refreshModal({ capture: false });
    } else {
      this.#render();
    }
  }

  /**
   * Open the payment-method manager over the current modal.
   *
   * Methods are stored on transactions as plain strings, so a rename inside the
   * sheet also has to move the form's own selection — the sheet reports what it
   * renamed and the selection follows. A method deleted while selected falls
   * back to the first one still available.
   */
  openPaymentTypeManager() {
    const wasTx = this.#modal.active === 'transaction';
    const before = wasTx ? (document.getElementById('paymentTypeInput')?.value || null) : null;
    if (wasTx) this.#txModal?.captureForm?.();

    this.#paymentSheet.open({
      onClose: (renames) => {
        if (!wasTx) { this.#render(); return; }
        const available = this.#paymentTypeService.allTypes();
        let next = renames.get(before) || before;
        if (!next || !available.includes(next)) next = available[0] || 'card';
        this.#txModal?.setPaymentType?.(next);
        this.#refreshModal({ capture: false });
      },
    });
  }

  toggleHijri() {
    const u = this.#store.getState().user;
    u.showHijri = !u.showHijri;
    this.#store.persist();
    this.closeModal(); this.#render();
  }

  /**
   * Adjust the Hijri date offset by delta days (−1 or +1 from the stepper).
   * Clamps to the range −7 … +7.
   * Immediately re-renders so the preview updates live.
   * @param {number} delta
   */
  adjustHijriOffset(delta) {
    const s = this.#store.getState();
    const current = s.user.hijriOffset ?? 0;
    s.user.hijriOffset = Math.max(-7, Math.min(7, current + delta));
    this.#store.persist();
    // Re-render the open modal so the preview date updates live
    this.#refreshModal();
  }

  /**
   * Explicitly set the Hijri offset (called from the stepper input).
   * @param {number} value
   */
  setHijriOffset(value) {
    const n = parseInt(value, 10);
    if (isNaN(n)) return;
    const s = this.#store.getState();
    s.user.hijriOffset = Math.max(-7, Math.min(7, n));
    this.#store.persist();
    this.#refreshModal();
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
      // Prefer the owner id captured when the sheet opened; the positional
      // index is only a fallback for older call sites.
      const sharedAcc = sharedMode
        ? (this.#sync.shareByOwner?.(sharedMode.ownerId) || allShared[sharedMode.shareIndex])
        : sharedMatch;
      if (!sharedAcc?._ownerId) return this.#toast.show('Shared account not found');
      if (sharedMode?.ownerId && sharedAcc._ownerId !== sharedMode.ownerId) {
        return this.#toast.show('Shared account changed — reopen and try again');
      }
      const accountId = sharedMode ? (sharedMode.accountId || data.accountId) : data.accountId;
      // The tx lives in the OWNER's book, so exchangeRate/refAmount must be
      // relative to the owner's home currency (carried in the share snapshot),
      // not the contributing member's home currency (#21).
      const ownerHome = sharedAcc.homeCurrency || state.user.homeCurrency;
      // An edit of a previously-contributed row must REPLACE it. The modal
      // carries the original id in sharedTxMode.editTxId; reusing it (rather
      // than minting a new one) is what stops the owner ending up with both the
      // original and the "edited" copy.
      const editingSharedId = sharedMode?.editTxId || null;
      const tx = {
        id:          editingSharedId || IdGenerator.generate('tx'),
        accountId:   accountId,
        categoryId:  data.categoryId || null,
        amount:      minor,
        currency,
        exchangeRate: (RATES[currency] || 1) / (RATES[ownerHome] || 1),
        refAmount:   this.#fx.convert(minor, currency, ownerHome),
        payee:       data.payee || '',
        note:        data.note || '',
        date:        data.date,
        hijriDate:   this.#hijri.toHijri(data.date),
        type:        data.type || 'expense',
        paymentType: data.paymentType || 'card',
        recordState: 'cleared',
        createdAt:   new Date().toISOString(),
        addedBy:     this.#sync.currentUser?.email || null,
      };
      try {
        if (editingSharedId) {
          await this.#sync.updateContribution(sharedAcc._ownerId, editingSharedId, tx);
        } else {
          await this.#sync.submitContribution(sharedAcc._ownerId, tx);
        }
        this.closeModal();
        this.#toast.show(editingSharedId ? 'Change submitted' : 'Transaction submitted');
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

    // A transfer moves money OUT of the source account, so the amount can only
    // be denominated in that account's currency. The FX panel always derived
    // its rate from source→destination account currencies, while the amount was
    // read in whatever the currency dropdown held (defaulting to the user's
    // default currency) — so a 10,000 INR transfer could debit ₹831,200 and
    // credit AED 441.89, legs ~$9,880 apart. The currency field is now locked
    // to the source account for transfers; this coercion is the backstop.
    const srcAcc   = data.type === 'transfer'
      ? state.accounts.find((a) => a.id === data.accountId)
      : null;
    const currency = srcAcc ? srcAcc.currency : data.currency;
    const minor    = this.#fx.toMinor(data.amount, currency);
    const exchRate = (RATES[currency] || 1) / (RATES[state.user.homeCurrency] || 1);
    const refAmt   = this.#fx.convert(minor, currency, state.user.homeCurrency);

    // Cross-currency transfer rate
    let xfer = null;
    if (data.type === 'transfer') {
      if (!data.accountId || !data.transferToAccountId || data.accountId === data.transferToAccountId) {
        return this.#toast.show('Pick two different accounts');
      }
      if (!srcAcc) return this.#toast.show('Pick a source account');
      const toAcc = state.accounts.find((a) => a.id === data.transferToAccountId);
      if (!toAcc) return this.#toast.show('Pick a destination account');
      const toCcy    = toAcc.currency;
      const autoRate = (RATES[toCcy] || 1) / (RATES[currency] || 1);
      let rate = Number(data.transferRate);
      if (!isFinite(rate) || rate <= 0) {
        rate = autoRate;
      } else if (rate === Number(autoRate.toFixed(6))) {
        // The field still holds the auto rate exactly as displayed, so the user
        // never overrode it — book the full-precision value instead of the
        // 6dp rendering. On high-magnitude pairs that truncation was material:
        // 100,000,000 LBP → USD booked $1,100.00 against an exact $1,117.32.
        rate = autoRate;
      }
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
      // Splits must add up EXACTLY. The old ±1-minor slack let the parent's
      // amount and its split legs disagree, so list totals (which read
      // tx.amount) drifted from balances (which read the splits).
      if (sum !== minor) {
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

    // Foreign-currency single-account tx: freeze the amount actually booked to
    // the account using the FX-panel rate (manual or auto). For same-currency or
    // split transactions this stays undefined and the ledger derives it.
    let txAcctMinor;
    if (data.type !== 'transfer' && !splits) {
      const accForFx = state.accounts.find((a) => a.id === data.accountId);
      let   txRate   = parseFloat(data.txFxRate);
      if (accForFx && accForFx.currency !== currency && isFinite(txRate) && txRate > 0) {
        // Same 6dp-truncation guard as the transfer path: an untouched auto
        // rate books at full precision rather than at what the field displays.
        const autoRate = (RATES[accForFx.currency] || 1) / (RATES[currency] || 1);
        if (txRate === Number(autoRate.toFixed(6))) txRate = autoRate;
        txAcctMinor = this.#fx.toMinor(this.#fx.fromMinor(minor, currency) * txRate, accForFx.currency);
      }
    }

    if (id) {
      // Edit existing
      let tx = state.transactions.find((x) => x.id === id);
      if (!tx) return;

      // A transfer is two rows; always operate on the OUT leg. Opening the IN
      // leg for edit would otherwise flip source↔destination and re-book the
      // money at the wrong rate (the update below assumes tx is the out leg).
      if (tx.type === 'transfer' && tx.transferDir === 'in' && tx.transferPairId) {
        const outLeg = state.transactions.find((x) => x.id === tx.transferPairId);
        if (outLeg) { id = outLeg.id; tx = outLeg; }
      }

      // A transfer is two rows; everything else is one. When an edit crosses
      // that boundary the row structure has to be rebuilt, not patched — the
      // old code only handled transfer→transfer, so switching a transfer to
      // Expense left the paired leg alive (money created out of nothing) and
      // switching an expense to Transfer produced a leg-less row that
      // LedgerMath scored as zero (money silently vanished).
      const wasTransfer = tx.type === 'transfer';
      const nowTransfer = data.type === 'transfer';

      if (nowTransfer && !wasTransfer) {
        // Became a transfer → drop the single row and create both legs.
        state.transactions = state.transactions.filter((t) => t.id !== tx.id);
        state.transactions.push(
          ...this.#buildTransferPair(data, { minor, currency, exchRate, refAmt, xfer, state }),
        );
      } else if (!nowTransfer && wasTransfer) {
        // No longer a transfer → delete the counter-leg, then update normally.
        if (tx.transferPairId) {
          state.transactions = state.transactions.filter((t) => t.id !== tx.transferPairId);
        }
        this.#transactions.update(id, {
          accountId: data.accountId,
          categoryId: splits ? null : (data.categoryId || null),
          amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
          payee: data.payee, note: data.note, date: data.date,
          hijriDate: this.#hijri.toHijri(data.date),
          paymentType: data.paymentType, type: data.type,
          splits, recurring,
          // Clear every transfer-only field so no dangling pair reference remains.
          transferPairId: null, transferDir: null, transferRate: null,
          ...(txAcctMinor !== undefined ? { acctMinor: txAcctMinor } : {}),
        });
      } else if (data.type === 'transfer' && tx.type === 'transfer' && tx.transferPairId) {
        const pair = state.transactions.find((x) => x.id === tx.transferPairId);
        // Re-normalize tx='out' / pair='in'. Balances are derived, so the
        // flush() below recomputes both accounts from the ledger — no manual revert.
        Object.assign(tx, {
          accountId: data.accountId, categoryId: null,
          amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
          payee: data.payee || 'Transfer', note: data.note, date: data.date,
          // Refresh the Hijri snapshot — editing a transfer's date used to
          // leave both legs showing the old Hijri date.
          hijriDate: this.#hijri.toHijri(data.date),
          paymentType: 'transfer', type: 'transfer', splits: null,
          transferRate: xfer?.rate ?? null, transferDir: 'out',
          // Amount/currency changed → drop the frozen impact so it re-freezes.
          acctMinor: undefined,
        });
        if (pair) {
          Object.assign(pair, {
            accountId: data.transferToAccountId, categoryId: null,
            amount: xfer ? xfer.dstMinor : minor,
            currency: xfer ? xfer.toCcy : currency,
            exchangeRate: ((RATES[xfer?.toCcy || currency] || 1)) / ((RATES[state.user.homeCurrency] || 1)),
            refAmount: this.#fx.convert(xfer ? xfer.dstMinor : minor, xfer ? xfer.toCcy : currency, state.user.homeCurrency),
            payee: data.payee || 'Transfer', note: data.note, date: data.date,
            hijriDate: this.#hijri.toHijri(data.date),
            paymentType: 'transfer', type: 'transfer', splits: null,
            transferRate: xfer?.rate ?? null, transferDir: 'in',
            acctMinor: undefined,
          });
        }
      } else {
        // Non-transfer edit → TransactionService.update reverts old balances,
        // applies the new ones, and persists+notifies (single source of truth).
        this.#transactions.update(id, {
          accountId: data.accountId,
          categoryId: splits ? null : (data.categoryId || null),
          amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
          payee: data.payee, note: data.note, date: data.date,
          hijriDate: this.#hijri.toHijri(data.date), // refresh snapshot when date changes
          paymentType: data.paymentType, type: data.type,
          splits, recurring,
          ...(txAcctMinor !== undefined ? { acctMinor: txAcctMinor } : {}),
        });
      }
    } else {
      // New transaction
      if (data.type === 'transfer') {
        // Balances are derived; the flush() below recomputes both accounts.
        state.transactions.push(
          ...this.#buildTransferPair(data, { minor, currency, exchRate, refAmt, xfer, state }),
        );
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
          acctMinor: txAcctMinor,
          addedBy: this.#sync.currentUser?.email || null,
        });
        if (data.payee && !splits && data.categoryId) {
          if (!state.merchantCategories) state.merchantCategories = {};
          state.merchantCategories[data.payee.toLowerCase()] = data.categoryId;
        }
      }
    }

    if (recurring) this.#recurring.process();
    this.#store.flush();  // flush() = persist + emit state:changed (persist() was silent)
    this.closeModal();
    this.#render();
    this.#toast.show(id ? 'Transaction updated' : 'Transaction added');
    this.#sync.schedulePush?.();
  }

  /**
   * Build the two rows that make up a transfer.
   *
   * Shared by "new transfer" and by an edit that converts an expense/income
   * into a transfer, so both paths always produce a fully-paired structure.
   *
   * @param {object} data   form values (accountId, transferToAccountId, …)
   * @param {object} ctx
   * @param {number} ctx.minor     source amount in minor units
   * @param {string} ctx.currency  source currency
   * @param {number} ctx.exchRate  source→home rate
   * @param {number} ctx.refAmt    source amount in home currency
   * @param {{rate:number,toCcy:string,dstMinor:number}|null} ctx.xfer
   * @param {object} ctx.state
   * @returns {[object, object]} [outgoing leg, incoming leg]
   */
  #buildTransferPair(data, { minor, currency, exchRate, refAmt, xfer, state }) {
    const fromId = IdGenerator.generate('tx');
    const toId   = IdGenerator.generate('tx');
    const toCcy  = xfer?.toCcy ?? currency;
    const dst    = xfer?.dstMinor ?? minor;
    const now    = new Date().toISOString();
    const shared = {
      categoryId: null,
      payee: data.payee || 'Transfer', note: data.note, date: data.date,
      hijriDate: this.#hijri.toHijri(data.date),
      paymentType: 'transfer', recordState: 'cleared', type: 'transfer',
      transferRate: xfer?.rate ?? null, tags: [],
      createdAt: now, addedBy: this.#sync.currentUser?.email || null,
    };

    return [
      {
        ...shared,
        id: fromId, accountId: data.accountId,
        amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
        transferPairId: toId, transferDir: 'out',
      },
      {
        ...shared,
        id: toId, accountId: data.transferToAccountId,
        amount: dst, currency: toCcy,
        exchangeRate: (RATES[toCcy] || 1) / (RATES[state.user.homeCurrency] || 1),
        refAmount: this.#fx.convert(dst, toCcy, state.user.homeCurrency),
        transferPairId: fromId, transferDir: 'in',
      },
    ];
  }

  /**
   * @param {string} id
   * @param {{confirm?: boolean}} [opts]
   *   `confirm:false` is used by the swipe reveal, where the deliberate tap on
   *   the exposed Delete button already IS the confirmation. Every other caller
   *   keeps the dialog.
   */
  deleteTx(id, { confirm: ask = true } = {}) {
    if (ask && !confirm('Delete this transaction?')) return;
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
  async deleteSharedContrib(shareIndex, txId, { confirm: ask = true } = {}) {
    if (ask && !confirm('Delete this transaction?')) return;
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
  async deleteSharedTx(shareIndex, txId, { confirm: ask = true } = {}) {
    if (ask && !confirm('Delete this transaction?')) return;
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
      await this.#sync.deleteContribution(share._ownerId, txId);
      this.closeModal();
      this.#toast.show('Delete request submitted to owner');
    } catch (e) {
      this.#toast.show('Failed: ' + (e.message || e));
    }
  }

  /**
   * Resolve the stable owner id for a positional shareIndex, captured at the
   * moment a sheet opens. sharedData is rebuilt on every pull, so carrying the
   * index alone meant a refresh landing before submit could file the
   * contribution against a different owner's book entirely.
   * @param {number} shareIndex
   * @returns {string|null}
   */
  /**
   * Positional index for an owner id — the inverse of #ownerIdForShare.
   * The shared UI still addresses snapshots by array position; this is the one
   * place that conversion happens, so the fragility stays contained.
   * @param {string} ownerId
   * @returns {number}
   */
  #shareIndexForOwner(ownerId) {
    return (this.#sync.sharedData || []).findIndex((s) => s._ownerId === ownerId);
  }

  #ownerIdForShare(shareIndex) {
    return (this.#sync.sharedData || [])[shareIndex]?._ownerId ?? null;
  }

  openSharedTxModal(shareIndex, accountId) {
    this.openModal('transaction', {
      sharedTxMode: { shareIndex, accountId, ownerId: this.#ownerIdForShare(shareIndex) },
    });
  }

  openSharedTxEdit(shareIndex, accountId, txId) {
    this.openModal('transaction', {
      sharedTxMode: {
        shareIndex, accountId, editTxId: txId,
        ownerId: this.#ownerIdForShare(shareIndex),
      },
    });
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
    const count = ids.size;
    // Delegate to TransactionService so transfer-pair legs are also reverted
    // and removed — previously this loop only deleted one leg and left
    // dangling transferPairId references on the partner (Bug 13).
    this.#transactions.bulkDelete([...ids]);
    v.clearMultiSelect?.();
    this.#render();
    this.#toast.show(`${count} transactions deleted`);
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

  /**
   * Debounced variant for the search box. Every keystroke used to re-run the
   * whole filter/sort/group pipeline and re-serialise every transaction row
   * synchronously — O(all transactions) per character. The value is stored
   * immediately so nothing is lost; only the re-render waits.
   * @param {string} key
   * @param {string} value
   */
  txFilterSetDebounced(key, value) {
    const v = this.#views.get('transactions');
    v?.setFilter?.(key, value);
    clearTimeout(this.#filterRenderTimer);
    this.#filterRenderTimer = setTimeout(() => this.#render(), 150);
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

  /**
   * Re-render the open modal without losing what the user has typed.
   *
   * Modal.refresh() rebuilds the card from the options it was opened with, so
   * on the transaction form it used to reset every field to its opening state —
   * toggling splits silently wiped an amount already entered. Snapshotting the
   * live form into the modal's draft first makes the refresh non-destructive.
   * Safe to call for any modal: only the transaction modal captures anything.
   *
   * @param {object}  [opts]
   * @param {boolean} [opts.capture=true]  set false when the caller has already
   *   captured and then adjusted the draft — re-capturing would read the stale
   *   DOM back over the adjustment.
   */
  #refreshModal({ capture = true } = {}) {
    if (capture && this.#modal.active === 'transaction') this.#txModal?.captureForm?.();
    this.#modal.refresh();
    lucide?.createIcons?.();
    if (this.#modal.active === 'transaction') {
      // The FX panels are DOM-patched, not rendered, so re-run them against the
      // restored values. Each is a no-op when its panel isn't present.
      this.updateTransferFxPanel(false);
      this.updateTxFxPanel(false);
    }
  }

  toggleSplits() {
    this.#txModal?.toggleSplits?.();
    this.#refreshModal();
  }

  addSplit(defaultAccountId = null) {
    this.#txModal?.addSplit?.(defaultAccountId || document.querySelector('[name=accountId]')?.value || null);
    this.#refreshModal();
  }

  removeSplit(i) {
    this.#txModal?.removeSplit?.(i);
    this.#refreshModal();
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
      if (diffAbs === 0) {
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
    // Snapshot first, then switch: setType() inspects the captured draft to
    // drop a category that doesn't belong to the new type.
    this.#txModal?.captureForm?.();
    this.#txModal?.setType?.(type);
    this.#refreshModal({ capture: false });
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

  /** Apply a category suggestion — sets the category field in the open tx modal. */
  applySuggestedCategory(id) {
    const field = document.getElementById('txCategory');
    if (field) {
      CategoryField.setValue(field, [id], this.#store.getState().categories);
      lucide?.createIcons?.();
      this.#toast.show('Category applied');
      return;
    }
    // Fallback for any remaining plain <select name=categoryId>.
    const sel = document.querySelector('select[name=categoryId]');
    if (sel) { sel.value = id; this.#toast.show('Category applied'); }
  }

  updateHijriPreview(iso) {
    const el = document.getElementById('hijriDatePreview');
    if (!el || !iso) return;
    try {
      const state = this.#store.getState();
      if (!state.user.showHijri) { el.textContent = ''; return; }
      const h = this.#hijri.toHijri(iso); // pass ISO string directly — toHijri anchors to noon avoiding UTC± day-shift
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
    // Keep any existing/typed rate; only auto-fill when the field is empty
    // (mirrors updateTxFxPanel). A pair change clears the field first, so the
    // new auto rate still fills — but editing the amount no longer wipes a
    // manually-entered transfer rate and re-books the leg at the auto rate.
    if (rateInp && !(parseFloat(rateInp.value) > 0)) {
      rateInp.value = autoRate.toFixed(6);
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
    const rateInp  = document.getElementById('fxRate');

    // Nothing to convert: the pair is incomplete, or both legs are already in
    // the same currency.
    //
    // This used to `return` outright, which was the bug. updateTransferFxPanel()
    // is the ONLY code that sets display:none on #fxPanel, so skipping it left
    // the panel on screen — still showing the previous pair's rate — until the
    // next full modal re-render. Tapping "Transfer" a second time triggered
    // that re-render, which is why a second click appeared to be the fix.
    //
    // The rate field is cleared too: it stays in the DOM and is still submitted
    // even while hidden, so a leftover cross-rate would stamp a bogus
    // transferRate onto a same-currency transfer.
    if (!fromAcc || !toAcc || fromAcc.currency === toAcc.currency) {
      if (rateInp) rateInp.value = '';
      this.updateTransferFxPanel(false);
      return;
    }

    if (rateInp) {
      rateInp.value = ((RATES[toAcc.currency] || 1) / (RATES[fromAcc.currency] || 1)).toFixed(6);
    }
    this.updateTransferFxPanel(false);
  }

  /**
   * Source account changed on a transfer: re-point the locked currency at it
   * before refreshing the FX panel, so the amount and the quoted rate always
   * describe the same currency.
   * @param {string} accId
   */
  onTransferSourceChange(accId) {
    const state = this.#store.getState();
    const acc   = state.accounts.find((a) => a.id === accId);
    if (acc?.currency) {
      const hidden = document.getElementById('txCurrencyLocked');
      const label  = document.getElementById('txCurrencyLabel');
      if (hidden) hidden.value = acc.currency;
      if (label) {
        label.innerHTML =
          `<i data-lucide="lock" style="width:11px;height:11px"></i>${this.#esc(acc.currency)}`;
        lucide?.createIcons?.();
      }
      // The stored rate belonged to the old pair — clear it so the panel
      // refills the auto rate for the new one.
      const rateInp = document.getElementById('fxRate');
      if (rateInp) rateInp.value = '';
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

    // Moving between books re-homes the category field. The previously-picked
    // id belongs to the old book, so CategoryField.setOwner clears it rather
    // than sending an id the destination book has never heard of.
    const ownerId = this.ownerIdForAccount(accId);
    const catEl   = document.getElementById('txCategory');
    if (catEl) {
      CategoryField.setOwner(catEl, ownerId, this.categoriesForOwner(ownerId));
      const note = catEl.parentElement?.querySelector('[data-shared-cat-note]');
      if (note) note.style.display = ownerId ? '' : 'none';
      lucide?.createIcons?.();
    }

    // A contribution is one row in someone else's book — submitTx has no split
    // path there, so splits must not survive the switch.
    const splitBtn = document.querySelector('[data-split-toggle]');
    if (splitBtn) splitBtn.style.display = ownerId ? 'none' : '';
    if (ownerId && this.#txModal?.splitsEnabled) {
      this.#txModal.toggleSplits?.();
      this.#toast.show('Splits removed — a shared-account entry is a single row');
      this.#refreshModal();
      return;
    }

    // Account changed → currency snapped to it (they now match), so refresh the
    // single-account FX panel (it will hide itself).
    this.updateTxFxPanel(false);
  }

  /**
   * Combined handler for the amount / currency inputs: refresh whichever FX
   * panel is in the DOM (transfer or single-account). Each is a no-op when its
   * panel isn't rendered.
   */
  onTxFormChange() {
    this.updateTransferFxPanel(false);
    this.updateTxFxPanel(false);
  }

  /**
   * Currency changed: the stored/auto rate belonged to the old currency pair, so
   * clear it and let updateTxFxPanel refill the auto rate for the new pair.
   */
  onTxCurrencyChange() {
    const rateInp = document.getElementById('fxTxRate');
    if (rateInp) rateInp.value = '';
    this.updateTransferFxPanel(false);
    this.updateTxFxPanel(false);
  }

  /**
   * Show/refresh the single-account FX panel when a non-transfer transaction's
   * currency differs from its account's currency. Mirrors updateTransferFxPanel.
   * @param {boolean} userChangedRate  true when the user typed in the rate field
   */
  updateTxFxPanel(userChangedRate = false) {
    const panel = document.getElementById('fxTxPanel');
    if (!panel) return;

    const state = this.#store.getState();
    const accId = document.querySelector('[name=accountId]')?.value;
    const acc   = state.accounts.find((a) => a.id === accId)
      || (state._sharedData || []).flatMap((s) => s.accounts || []).find((a) => a.id === accId);
    const txCcy = document.querySelector('[name=currency]')?.value;

    if (!acc || !txCcy || acc.currency === txCcy) {
      panel.style.display = 'none';
      return;
    }

    panel.style.display = '';
    const accCcy   = acc.currency;
    const autoRate = (RATES[accCcy] || 1) / (RATES[txCcy] || 1);

    const rateInp = document.getElementById('fxTxRate');
    // Keep any existing/stored rate (so opening an edit doesn't re-value the tx);
    // only auto-fill when the field is empty. Changing currency clears it first.
    if (rateInp && !(parseFloat(rateInp.value) > 0)) {
      rateInp.value = autoRate.toFixed(6);
    }

    const rate    = parseFloat(rateInp?.value) || autoRate;
    const amt     = parseFloat(document.querySelector('[name=amount]')?.value) || 0;
    const booked  = amt * rate;

    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('fxTxFromCcy', txCcy);
    set('fxTxToCcy',   accCcy);
    set('fxTxToAmount', this.#fx.formatMoney(this.#fx.toMinor(booked, accCcy), accCcy));
    set('fxTxRateNote', `Auto: 1 ${txCcy} = ${autoRate.toFixed(4)} ${accCcy}`);
  }

  resetTxFx() {
    const state = this.#store.getState();
    const accId = document.querySelector('[name=accountId]')?.value;
    const acc   = state.accounts.find((a) => a.id === accId)
      || (state._sharedData || []).flatMap((s) => s.accounts || []).find((a) => a.id === accId);
    const txCcy = document.querySelector('[name=currency]')?.value;
    const rateInp = document.getElementById('fxTxRate');
    if (acc && txCcy && rateInp) {
      rateInp.value = ((RATES[acc.currency] || 1) / (RATES[txCcy] || 1)).toFixed(6);
    }
    this.updateTxFxPanel(false);
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
      const scanner = this.receiptScanner;
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

  /**
   * Voice entry — a two-tap toggle on the transaction form.
   *   Tap 1: request the mic and start recording ("Listening…").
   *   Tap 2: stop, send the clip to Gemini, and open a pre-filled modal.
   *
   * Capture (MediaRecorder) is a UI concern handled by VoiceRecorder; the
   * interpretation is delegated to the shared ReceiptScanService.parseVoice,
   * so web and mobile produce the same prefill shape.
   *
   * @param {HTMLElement} btn  the button the user tapped (label is mutated)
   */
  async voiceEntry() {
    if (this.#voice) return;   // a recording is already in progress

    // ── No API key → open Settings (mirror scanReceipt) ──
    if (!this.#store.getState().user.geminiApiKey?.trim()) {
      this.#toast.show('Add your free Google AI key in Settings first');
      this.openModal('settings');
      return;
    }

    const recorder = new VoiceRecorder();
    const overlay  = new VoiceOverlay();
    this.#voice = { recorder, overlay, done: false };

    const finish = () => { overlay.close(); this.#voice = null; };

    // X / backdrop → discard the clip, no API call.
    overlay.onCancel = () => { try { recorder.cancel(); } catch (_) {} finish(); };

    // Stop → freeze the meter, transcribe, then open the pre-filled form.
    overlay.onStop = async () => {
      if (!this.#voice || this.#voice.done) return;
      this.#voice.done = true;
      overlay.setProcessing();

      let blob;
      try { blob = await recorder.stop(); }
      catch (_) { finish(); this.#toast.show('Recording failed — please try again'); return; }
      if (!blob || !blob.size) { finish(); this.#toast.show('No audio captured — please try again'); return; }

      try {
        const prefill = await this.receiptScanner.parseVoice(blob);
        finish();
        this.closeModal();
        this.openModal('transaction', { prefill });
        this.#toast.show('Heard it · review and save');
      } catch (e) {
        finish();
        if (e.message === 'NO_API_KEY') {
          this.#toast.show('Add your free Google AI key in Settings first');
          this.openModal('settings');
        } else {
          this.#toast.show('Voice failed: ' + (e.message || 'Unknown error'));
        }
      }
    };

    // Request the mic FIRST; only show the overlay once recording is live, so a
    // denied-permission prompt doesn't leave an empty meter on screen.
    try {
      await recorder.start();
      overlay.open(() => recorder.getLevel());
    } catch (e) {
      this.#voice = null;
      this.#toast.show('Microphone unavailable: ' + (e.message || 'permission denied'));
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

      // Capture the pre-edit balance IN THE NEW CURRENCY. a.balance is in minor
      // units of the account's CURRENT currency, while newMinor comes from the
      // form in minor units of the currency being saved. Diffing them directly
      // meant that merely switching a ¥500,000 account to USD logged a
      // $495,000 "Balance adjustment" — the two numbers weren't comparable.
      const currencyChanged = a.currency !== data.currency;
      const wasMinor = currencyChanged
        ? this.#fx.convert(a.balance, a.currency, data.currency)
        : a.balance;

      // Delegate the entity update to AccountService (mutates the same object);
      // the balance-adjustment ledger entry is orchestrated here.
      this.#accounts.update(id, { name: data.name, type: data.type, currency: data.currency, color: data.color, archived: !!data.archived, groupId });

      // A pure currency switch re-denominates the account; it is not a
      // real-world balance change, so it must not mint a ledger entry. The
      // form's prefilled figure is in the OLD currency and is ignored here.
      if (!currencyChanged && newMinor !== wasMinor) {
        const wasMajor = wasMinor;
        const delta    = newMinor - wasMinor;
        const positive = delta > 0;
        const tx = {
          id: IdGenerator.generate('tx'), accountId: a.id, categoryId: null,
          amount: Math.abs(delta), currency: a.currency,
          exchangeRate: (RATES[a.currency] || 1) / (RATES[state.user.homeCurrency] || 1),
          refAmount: this.#fx.convert(Math.abs(delta), a.currency, state.user.homeCurrency),
          payee: 'Balance adjustment',
          note: `Manual balance set: ${this.#fx.formatMoney(wasMajor, a.currency)} → ${this.#fx.formatMoney(newMinor, a.currency)}`,
          date: today, hijriDate: this.#hijri.toHijri(today),
          paymentType: 'cash', recordState: 'cleared',
          type: positive ? 'income' : 'expense',
          transferPairId: null, splits: null, tags: ['balance-adjustment'],
        };
        state.transactions.push(tx);
      }
      this.#store.persist();
      this.closeModal(); this.#render();
      const logged = !currencyChanged && newMinor !== wasMinor;
      this.#toast.show(
        currencyChanged
          ? `Account updated · re-denominated to ${data.currency}`
          : 'Account updated' + (logged ? ' · adjustment logged' : ''),
      );
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
        date: today, hijriDate: this.#hijri.toHijri(today),
        paymentType: 'cash', recordState: 'cleared',
        type: positive ? 'income' : 'expense',
        transferPairId: null, splits: null, tags: ['opening-balance'],
      };
      state.transactions.push(tx);
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
    if (!confirm('Delete this group? Accounts will become ungrouped.')) return;
    const res = this.#accountGroups.delete(id);
    if (!res.ok) return this.#toast.show(res.reason);
    this.#render();
  }

  /**
   * The group manager sheet — inline handlers inside it dispatch through
   * window.__app.accountGroupSheet.*.
   * @returns {AccountGroupSheet}
   */
  get accountGroupSheet() { return this.#accountGroupSheet; }

  /** Open the group manager (create / rename / delete / bulk-assign). */
  openAccountGroups() {
    this.#accountGroupSheet.open({ onClose: () => this.#render() });
  }

  /**
   * The account-share sheet — inline handlers dispatch through
   * window.__app.accountShareSheet.*.
   * @returns {AccountShareSheet}
   */
  get accountShareSheet() { return this.#accountShareSheet; }

  /**
   * "Who can see this account?" — the account-first counterpart to editing a
   * family member's permissions. Both write the same storage.
   * @param {string} accountId
   */
  shareAccount(accountId) {
    if (!this.#sync.currentUser) {
      return this.#toast.show('Sign in to share accounts with family');
    }
    this.#accountShareSheet.open(accountId, {
      onClose: () => {
        this.#render();
        // Republish snapshots so the change reaches their device immediately
        // rather than at their next cold start.
        this.#sync.schedulePush?.();
      },
    });
  }

  /**
   * Toast passthrough so components that aren't views can surface a message
   * without reaching into the Toast instance directly.
   * @param {string} message
   */
  showToast(message) { this.#toast.show(message); }

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
      hijriDate:   this.#hijri.toHijri(dateIso),
      paymentType: 'cash',
      recordState: 'cleared',
      type:        residual > 0 ? 'income' : 'expense',
      transferPairId: null,
      splits:      null,
      tags:        ['opening-balance', 'reconciled'],
      createdAt:   new Date().toISOString(),
    };
    // Derived model: the residual was the implicit opening balance. We now make
    // it an explicit ledger entry, so zero the opening to avoid double-counting.
    // balance = 0 + (ledger + residual) = original balance (unchanged).
    state.transactions.push(tx);
    a.openingBalance = 0;
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
    // Derived model: "recalculate to ledger" means discarding the residual,
    // i.e. zeroing the opening balance. The persist hook then sets balance=ledger.
    a.openingBalance = 0;
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
    // Counts split legs as well as whole-transaction references.
    const used = this.#categories.usageCount(id);
    if (used > 0) {
      return this.#toast.show(
        `${used} transaction${used === 1 ? '' : 's'} still use this — reassign them first`,
      );
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
    // Multi-value field → use getAll (fromEntries keeps only the last value).
    // The CategoryField emits a single empty input when nothing is selected,
    // so blanks are filtered out before the "pick at least one" check.
    const categoryIds = fd.getAll('categoryIds').filter(Boolean);
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

      const wasPaid   = debt.status === 'paid';
      const nowPaid   = !!data.markPaid;
      const remaining = this.#debtOutstanding(debt);

      // Closing a debt that still has a balance used to write nothing at all:
      // the debt left the "owed" total while the money never moved in the
      // ledger. Ask what actually happened rather than guessing.
      if (nowPaid && !wasPaid && remaining > 0) {
        const settled = this.#settleDebtRemainder(debt, remaining, data.accountId);
        if (settled === null) return; // user cancelled — leave the debt open
      }
      debt.status = nowPaid ? 'paid' : 'active';
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
      date: data.dateTaken, hijriDate: this.#hijri.toHijri(data.dateTaken),
      paymentType: 'transfer', recordState: 'cleared',
      type: isBorrowed ? 'income' : 'expense',
      transferPairId: null, tags: ['debt'], splits: null,
      debtId, debtRole: 'initial',
    };
    state.transactions.push(tx);

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
      date: data.date, hijriDate: this.#hijri.toHijri(data.date),
      paymentType: 'transfer', recordState: 'cleared',
      type: isBorrowed ? 'expense' : 'income',
      transferPairId: null, tags: ['debt-payment'], splits: null,
      debtId, debtRole: 'payment',
    };
    state.transactions.push(tx);

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

  /**
   * Outstanding balance on a debt, in the debt's own currency.
   * Payments in other currencies are converted before summing.
   * @param {object} debt
   * @returns {number} minor units still owed (never negative)
   */
  #debtOutstanding(debt) {
    const state    = this.#store.getState();
    const payments = state.transactions.filter(
      (t) => t.debtId === debt.id && t.id !== debt.initialTxId,
    );
    const paid = payments.reduce(
      (s, t) => s + this.#fx.convert(t.amount, t.currency, debt.currency), 0,
    );
    return Math.max(0, debt.principal - paid);
  }

  /**
   * Ask how a debt's remaining balance was settled, and record it accordingly.
   *
   * Three real-world cases, because "mark as paid" means different things:
   *  1. Paid now from a tracked account → write a real payment transaction.
   *  2. Settled outside the app (cash, forgiven, untracked account) → close it
   *     with no ledger entry, but record that it was settled externally.
   *  3. Cancel → leave the debt open.
   *
   * @param {object} debt
   * @param {number} remaining  minor units outstanding
   * @param {string} [accountId] account hinted by the form
   * @returns {object|null} the created transaction, null when cancelled
   */
  #settleDebtRemainder(debt, remaining, accountId) {
    const state  = this.#store.getState();
    const amount = this.#fx.formatMoney(remaining, debt.currency);
    const payNow = window.confirm(
      `This debt still has ${amount} outstanding.\n\n`
      + 'OK — I just paid it: log a payment transaction now.\n'
      + 'Cancel — it was settled outside the app: close it with no transaction.',
    );

    if (!payNow) {
      // Case 2: close it honestly, without inventing a ledger movement.
      debt.settledExternally = true;
      debt.settledAt         = DateService.todayIso();
      return { external: true };
    }

    // Case 1: a real payment. Prefer the account the debt originated on.
    const initial = state.transactions.find((t) => t.id === debt.initialTxId);
    const accId   = accountId || initial?.accountId || state.accounts[0]?.id;
    const acc     = state.accounts.find((a) => a.id === accId);
    if (!acc) { this.#toast.show('No account to pay from'); return null; }

    const today      = DateService.todayIso();
    const isBorrowed = debt.kind === 'borrowed' || debt.direction === 'borrowed';
    const tx = {
      id: IdGenerator.generate('tx'), accountId: acc.id, categoryId: null,
      amount: remaining, currency: debt.currency,
      exchangeRate: (RATES[debt.currency] || 1) / (RATES[state.user.homeCurrency] || 1),
      refAmount: this.#fx.convert(remaining, debt.currency, state.user.homeCurrency),
      payee: debt.counterparty || 'Debt settlement',
      note:  'Final settlement',
      date: today, hijriDate: this.#hijri.toHijri(today),
      paymentType: 'transfer', recordState: 'cleared',
      type: isBorrowed ? 'expense' : 'income',
      transferPairId: null, tags: ['debt-payment'], splits: null,
      debtId: debt.id, debtRole: 'payment',
    };
    state.transactions.push(tx);
    return tx;
  }

  deleteDebt(id, destroyPayments = false) {
    const state = this.#store.getState();
    const debt  = state.debts.find((d) => d.id === id);
    if (!debt) return;
    const payments = state.transactions.filter((t) => t.debtId === id && t.id !== debt.initialTxId);
    const linked   = payments.length + (debt.initialTxId ? 1 : 0);
    const msg = destroyPayments
      ? `Delete this debt AND its ${linked} linked transaction${linked === 1 ? '' : 's'} `
        + `(the original${payments.length ? ` plus ${payments.length} payment${payments.length === 1 ? '' : 's'}` : ''})?\n\n`
        + 'Account balances will be restored as if the debt never existed.'
      : `Delete this debt but KEEP its ${linked} transaction${linked === 1 ? '' : 's'}?\n\n`
        + 'They stay in your ledger as ordinary transactions and your balances do not change.';
    if (!confirm(msg)) return;

    if (destroyPayments) {
      // Remove the whole footprint: the original and every repayment.
      state.transactions = state.transactions.filter(
        (t) => t.debtId !== id && t.id !== debt.initialTxId,
      );
    } else {
      // Keep everything, just unlink. Previously the original was deleted while
      // the repayments were kept, so the account balance dropped by the
      // borrowed amount for no real-world event.
      state.transactions.forEach((t) => {
        if (t.debtId === id || t.id === debt.initialTxId) { t.debtId = null; t.debtRole = null; }
      });
    }
    state.debts = state.debts.filter((d) => d.id !== id);
    this.#store.persist();
    this.closeModal(); this.#render();
    this.#toast.show(destroyPayments
      ? `Debt and ${linked} transaction${linked === 1 ? '' : 's'} removed`
      : `Debt deleted · ${linked} transaction${linked === 1 ? '' : 's'} kept`);
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
    const state  = this.#store.getState();
    const member = (state.family || []).find((m) => m.id === id);
    state.family = (state.family || []).filter((m) => m.id !== id);
    this.#store.persist();
    // Dropping them from local state does NOT revoke access — their
    // family_shares row has to go too, or their client keeps serving the last
    // snapshot (accounts, transactions and all categories) indefinitely.
    if (member?.email) this.#sync.revokeMemberShare?.(member.email);
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

  /**
   * The regular-item form's account moved between books: re-home the default
   * category field (the old id means nothing in the new book) and snap the
   * currency to the chosen account.
   * @param {string} value  raw <select> value — see AccountRef
   */
  onRegularAccountChange(value) {
    const ref     = AccountRef.parse(value);
    const ownerId = ref.ownerId;
    const state   = this.#store.getState();

    const catEl = document.getElementById('regularItemCategory');
    if (catEl) {
      CategoryField.setOwner(catEl, ownerId, this.categoriesForOwner(ownerId));
      lucide?.createIcons?.();
    }

    const note = document.querySelector('[data-regular-shared-note]');
    if (note) note.style.display = ref.isShared ? '' : 'none';

    const acc = ownerId
      ? ((this.#sync.shareByOwner?.(ownerId)?.accounts) || []).find((a) => a.id === ref.accountId)
      : state.accounts.find((a) => a.id === ref.accountId);
    const curEl = document.querySelector('#regularItemForm [name=currency]');
    if (curEl && acc?.currency) curEl.value = acc.currency;
  }

  submitRegularItem(event, id) {
    event.preventDefault();
    const fd    = new FormData(event.target);
    const data  = Object.fromEntries(fd.entries());
    const state = this.#store.getState();
    if (!Array.isArray(state.regularItems)) state.regularItems = [];

    const currency = data.currency || state.user.homeCurrency;
    // The select carries "shared:<ownerId>:<accountId>" for a family member's
    // account, so the id and the book it belongs to are stored separately.
    const accRef   = AccountRef.parse(data.accountId);
    const payload = {
      name:          (data.name || '').trim(),
      defaultAmount: this.#fx.toMinor(parseFloat(data.defaultAmount) || 0, currency),
      currency,
      accountId:     accRef.accountId || null,
      sharedOwnerId: accRef.ownerId   || null,
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
    const s      = this.#store.getState();
    // Count across both books — an item on a shared account has all of its
    // entries in the owner's, so a local-only count read as "0 logged".
    const logged = this.#regularLogs.all().filter((t) => t.regularItemId === id).length;

    // Deleting the template used to destroy every transaction ever logged from
    // it, while the prompt only said "Delete this regular item?" — real spending
    // silently disappeared from the ledger and balances moved. The template is
    // a shortcut for creating transactions; removing it must not unmake them.
    const msg = logged
      ? `Delete this regular item?\n\nThe ${logged} transaction${logged === 1 ? '' : 's'} `
        + 'already logged from it stay in your ledger.'
      : 'Delete this regular item?';
    if (!confirm(msg)) return;

    (s.transactions || []).forEach((t) => { if (t.regularItemId === id) t.regularItemId = null; });
    s.regularItems = (s.regularItems || []).filter((i) => i.id !== id);
    this.#store.persist();
    this.closeModal();
    this.#render();
    this.#toast.show(logged
      ? `Item deleted · ${logged} transaction${logged === 1 ? '' : 's'} kept`
      : 'Item deleted');
    this.#sync.schedulePush?.();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Regular item log methods (DayLogsModal handlers)
  // ──────────────────────────────────────────────────────────────────────────

  async submitRegularLog(e, date) {
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
    const ref = AccountRef.fromRecord(item);

    // ── Shared default account → contribute to the OWNER's book ───────────
    // The account doesn't exist locally, so a local row would be orphaned. The
    // rate/refAmount must also be relative to the OWNER's home currency, since
    // that is the book the row is reported in (same rule as submitTx).
    if (ref.isShared) {
      const share = this.#sync.shareByOwner?.(ref.ownerId);
      if (!share?._ownerId) return this.#toast.show('Shared account not found');
      const ownerHome = share.homeCurrency || s.user.homeCurrency;
      const tx = {
        id:            IdGenerator.generate('tx'),
        regularItemId: itemId,
        accountId:     ref.accountId,
        date,
        hijriDate:     this.#hijri.toHijri(date),
        amount:        totalMinor,
        unitAmount:    unitMinor,
        qty,
        currency,
        exchangeRate:  (RATES[currency] || 1) / (RATES[ownerHome] || 1),
        refAmount:     this.#fx.convert(totalMinor, currency, ownerHome),
        description:   item.name,
        payee:         item.name,
        note:          '',
        type:          'expense',
        categoryId:    item.categoryId || null,
        splits:        null,
        paymentType:   'cash',
        recurring:     null,
        recordState:   'cleared',
        createdAt:     new Date().toISOString(),
        addedBy:       this.#sync.currentUser?.email || null,
      };
      try {
        await this.#sync.submitContribution(share._ownerId, tx);
        this.#toast.show('Entry submitted to the shared account');
        this.#sync.scheduleSharesRefresh?.(3000);
        this.#sync.scheduleSharesRefresh?.(8000);
      } catch (err) {
        return this.#toast.show('Failed to submit: ' + (err.message || err));
      }
      this.openModal('dayLogs', { date });
      return;
    }

    const accountId = item.accountId || s.accounts[0]?.id;
    const exRate3  = (RATES[currency] || 1) / (RATES[s.user.homeCurrency] || 1);
    const tx = {
      id: IdGenerator.generate('tx'),
      regularItemId: itemId,
      accountId,
      date,
      hijriDate:    this.#hijri.toHijri(date),
      amount:       totalMinor,
      unitAmount:   unitMinor,
      qty,
      currency,
      exchangeRate: exRate3,
      refAmount:    this.#fx.convert(totalMinor, currency, s.user.homeCurrency),
      description:  item.name,
      payee:        item.name,
      note:         '',
      type:         'expense',
      categoryId:   item.categoryId || null,
      splits:       null,
      paymentType:  'cash',
      recurring:    null,
      recordState:  'cleared',
      createdAt:    new Date().toISOString(),
    };
    s.transactions.push(tx);
    this.#store.flush();
    this.#sync.schedulePush?.();
    this.openModal('dayLogs', { date });
  }

  async deleteRegularLog(logId, date) {
    const s = this.#store.getState();
    const tx = s.transactions.find(t => t.id === logId);
    if (tx) {
      s.transactions = s.transactions.filter(t => t.id !== logId);
      this.#store.flush();  // flush() so other views reflect the reverted balance
      this.#sync.schedulePush?.();
      this.openModal('dayLogs', { date });
      return;
    }

    // Not local → it was contributed to a shared account, so the removal has to
    // travel back through the same channel rather than being dropped silently.
    const shared = this.#regularLogs.find(logId);
    if (shared?._shared) {
      try {
        await this.#sync.deleteContribution(shared._ownerId, logId);
        this.#toast.show('Delete request submitted to owner');
        this.#sync.scheduleSharesRefresh?.(3000);
      } catch (err) {
        this.#toast.show('Failed: ' + (err.message || err));
      }
    }
    this.openModal('dayLogs', { date });
  }

  prefillRegularLog(sel) {
    const opt   = sel.options[sel.selectedIndex];
    const price = parseFloat(opt?.dataset?.price) || 0;
    // Round to the CURRENCY's precision. A hard-coded toFixed(2) silently
    // dropped the third decimal, so a KWD item priced 1.234 prefilled 1.23 and
    // lost 4 fils on every log.
    const ccy    = opt?.dataset?.currency || this.#store.getState().user.homeCurrency || 'USD';
    const digits = this.#fx.minorDigits(ccy);
    const unitEl  = document.getElementById('dayLogUnit');
    const qtyEl   = document.getElementById('dayLogQty');
    const totalEl = document.getElementById('dayLogTotal');
    if (unitEl)  unitEl.value  = price > 0 ? price.toFixed(digits) : '';
    if (totalEl && qtyEl) {
      const qty = parseFloat(qtyEl.value) || 1;
      totalEl.value = price > 0 ? (price * qty).toFixed(digits) : '';
    }
  }

  updateRegularLogTotal() {
    const qty  = parseFloat(document.getElementById('dayLogQty')?.value)  || 1;
    const unit = parseFloat(document.getElementById('dayLogUnit')?.value) || 0;
    const el   = document.getElementById('dayLogTotal');
    if (el) el.value = (qty * unit).toFixed(2);
  }

  /**
   * Step 1 → Step 2: save selected currency then advance to the
   * Hijri calibration step by calling advanceToStep2() on the modal
   * and refreshing in-place (no close/reopen flash).
   */
  currencySetupNext() {
    const sel = document.getElementById('setupCurrency');
    if (sel) this.#store.getState().user.homeCurrency = sel.value;
    this.#store.persist();
    this.#currencySetupModal.advanceToStep2();
    this.#modal.refresh();
  }

  /**
   * Step 2 done: close the onboarding modal and enter the app.
   */
  saveCurrencySetup() {
    this.#store.persist();
    this.closeModal();
    this.#toast.show('All set — welcome to Pocket!');
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
  // Swipe row actions (touch)
  //
  // Thin delegates for the inline ontouch* attributes in TransactionRowRenderer.
  // All gesture state and the reveal lifecycle live in SwipeRowController; the
  // app only supplies what "delete this row" means.
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * @param {TouchEvent} event
   * @param {string}     id            Transaction ID
   * @param {number}     shareIndex    Index into _sharedData (-1 for owned tx)
   * @param {boolean}    isOwnContrib  True if this is a member's own contribution
   */
  onTxSwipeStart(event, id, shareIndex = -1, isOwnContrib = false) {
    this.#swipe.start(event, id, shareIndex, isOwnContrib);
  }

  onTxSwipeMove(event)   { this.#swipe.move(event); }
  onTxSwipeEnd()         { this.#swipe.end(); }
  onTxSwipeCancel()      { this.#swipe.cancel(); }

  /**
   * The revealed Delete button was tapped. Reaching this point already required
   * a deliberate swipe followed by a deliberate tap on an 80px target, so there
   * is no confirm() dialog — the second tap IS the confirmation.
   */
  commitSwipeDelete() { this.#swipe.commitDelete(); }

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
        if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.transactions)) {
          throw new Error('Invalid structure');
        }
        // replaceState() deletes every key the incoming object omits, so an
        // older or partial export used to wipe user settings, categories,
        // budgets, debts and regular items. Running the migrator back-fills
        // those (and openingBalance, without which every balance collapses to
        // the bare ledger sum) before the swap.
        this.#store.replaceState(parsed, (s) => StateMigrator.migrate(s));
        this.#ensureUserDefaults();
        this.#accounts.recompute();
        this.#store.persist();
        this.closeModal(); this.#render();
        this.#toast.show('Data imported');
      } catch { this.#toast.show('Invalid JSON file'); }
    };
    reader.readAsText(file);
  }

  /** Conflict-backup recovery (SyncService keeps timestamped copies). */
  conflictBackups() { return this.#sync.conflictBackups?.() || []; }

  restoreConflictBackup(key) {
    const parsed = this.#sync.readConflictBackup?.(key);
    if (!parsed || !Array.isArray(parsed.accounts) || !Array.isArray(parsed.transactions)) {
      this.#toast.show('That backup is missing or unreadable');
      return;
    }
    if (!confirm('Restore this saved copy? It replaces the data currently on this device.')) return;
    this.#store.replaceState(parsed, (s) => StateMigrator.migrate(s));
    this.#ensureUserDefaults();
    this.#accounts.recompute();
    this.#store.persist();
    this.#sync.discardConflictBackup?.(key);
    this.closeModal(); this.#render();
    this.#toast.show('Backup restored');
  }

  discardConflictBackup(key) {
    this.#sync.discardConflictBackup?.(key);
    this.#render();
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
    // Only accounts this import actually created may have their currency
    // inferred below — see the comment on the vote loop.
    const createdAccountIds = new Set();
    plan.newAccounts.forEach((na) => {
      if (!accMap[norm(na.name)]) {
        const id = IdGenerator.generate('acc');
        state.accounts.push({ id, name: na.name, type: na.type, currency: na.currency, color: na.color, icon: na.icon || 'wallet', archived: false, balance: 0 });
        accMap[norm(na.name)] = id;
        createdAccountIds.add(id);
      }
    });

    // Infer each NEW account's currency from the most-used currency across its
    // imported rows. This must never touch a pre-existing account: it used to
    // iterate every account, so importing a single USD row for a name matching
    // an existing JPY account silently re-denominated that account (and,
    // because it assigned a.currency directly instead of going through
    // AccountService.update, left every frozen acctMinor stale).
    const currencyVotes = {}; // norm(accName) → { currency → count }
    plan.txDrafts.forEach((d) => {
      const key = norm(d.accountName);
      if (!currencyVotes[key]) currencyVotes[key] = {};
      if (d.currency) currencyVotes[key][d.currency] = (currencyVotes[key][d.currency] || 0) + 1;
    });
    state.accounts.forEach((a) => {
      if (!createdAccountIds.has(a.id)) return; // never re-denominate existing accounts
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
        const txF = { id: fromId, accountId: accId, categoryId: null, amount: minor, currency: draft.currency, exchangeRate: exRate, refAmount: refAmt, payee: draft.payee, note: draft.note, date: draft.date, hijriDate: this.#hijri.toHijri(draft.date), paymentType: draft.paymentType, recordState: 'cleared', type: 'transfer', transferPairId: toId, transferDir: 'out', tags: draft.tags || [], createdAt: draft.createdAt || new Date().toISOString(), addedBy: draft.addedBy || null };
        const txT = { id: toId, accountId: toAccId, categoryId: null, amount: dstMinor, currency: toCcy, exchangeRate: (RATES[toCcy] || 1) / (RATES[state.user.homeCurrency] || 1), refAmount: this.#fx.convert(dstMinor, toCcy, state.user.homeCurrency), payee: draft.payee, note: draft.note, date: draft.date, hijriDate: this.#hijri.toHijri(draft.date), paymentType: draft.paymentType, recordState: 'cleared', type: 'transfer', transferPairId: fromId, transferDir: 'in', tags: draft.tags || [], createdAt: draft.createdAt || new Date().toISOString(), addedBy: draft.addedBy || null };
        state.transactions.push(txF, txT);
        // Balances are derived; the persist() after the loop recomputes accounts.
        txCount++;
      } else if (Array.isArray(draft.splits)) {
        const splits = draft.splits.map((s) => ({
          categoryId: s.catId ? catMap[norm(s.catId)] || null : null,
          accountId: accMap[norm(s.accountName || draft.accountName)] || accId,
          amount: s.amount,
        }));
        const tx = { id: IdGenerator.generate('tx'), accountId: accId, categoryId: null, amount: minor, currency: draft.currency, exchangeRate: exRate, refAmount: refAmt, payee: draft.payee, note: draft.note, date: draft.date, hijriDate: this.#hijri.toHijri(draft.date), paymentType: draft.paymentType, recordState: 'cleared', type: draft.type, transferPairId: null, tags: draft.tags || [], splits, createdAt: draft.createdAt || new Date().toISOString(), addedBy: draft.addedBy || null };
        state.transactions.push(tx);
        txCount++;
      } else {
        const catKey = draft.catName
          ? (draft.subName
            ? (norm(draft.catName) + '|' + norm(draft.subName) + '|' + draft.type + '|sub')
            : (norm(draft.catName) + '|' + draft.type + '|root'))
          : null;
        const catId = catKey ? (catMap[catKey] || null) : null;
        const tx = { id: IdGenerator.generate('tx'), accountId: accId, categoryId: catId, amount: minor, currency: draft.currency, exchangeRate: exRate, refAmount: refAmt, payee: draft.payee, note: draft.note, date: draft.date, hijriDate: this.#hijri.toHijri(draft.date), paymentType: draft.paymentType, recordState: 'cleared', type: draft.type, transferPairId: null, tags: draft.tags || [], splits: null, createdAt: draft.createdAt || new Date().toISOString(), addedBy: draft.addedBy || null };
        state.transactions.push(tx);
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
    // Migrate the seed too, so a reset lands on the current schema rather than
    // whatever shape SeedFactory happens to emit.
    this.#store.replaceState(SeedFactory.create(), (s) => StateMigrator.migrate(s));
    this.#ensureUserDefaults();
    this.#accounts.recompute();
    this.#store.persist();
    this.#render();
    this.#toast.show('Data reset');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: render
  // ──────────────────────────────────────────────────────────────────────────

  #render() {
    // Any revealed swipe row is about to have its DOM node replaced, so drop
    // the reference rather than leave the controller holding a detached node.
    this.#swipe?.reset();
    this.#renderSpaceBar();
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

  /**
   * The space switcher bar.
   *
   * Stays hidden entirely when nobody shares anything with you — a solo user
   * should never see a control for a concept they don't have. Inside a guest
   * space it is deliberately loud: the whole screen is showing someone else's
   * money, and that must never be ambiguous.
   */
  #renderSpaceBar() {
    const el = document.getElementById('spaceBar');
    if (!el) return;
    if (!this.#spaces?.hasGuestSpaces) { el.innerHTML = ''; return; }

    const space = this.#spaces.active();
    const label = this.#esc(space.label);
    if (space.isHome) {
      el.innerHTML = `
        <button class="w-full flex items-center gap-2 mb-4 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm"
                onclick="window.__app.openSpaceSheet()">
          <i data-lucide="wallet" style="width:15px;height:15px"></i>
          <span class="font-medium">${label}</span>
          <span class="text-xs text-zinc-500 ml-auto">Switch space</span>
          <i data-lucide="chevron-down" style="width:14px;height:14px"></i>
        </button>`;
    } else {
      const perm = space.canAddAnywhere ? 'You can add entries here' : 'View only';
      el.innerHTML = `
        <button class="w-full flex items-center gap-2 mb-4 px-3 py-2 rounded-xl text-sm"
                style="background:#818cf815;border:1px solid #818cf855"
                onclick="window.__app.openSpaceSheet()">
          <i data-lucide="users" style="width:15px;height:15px;color:#818cf8"></i>
          <span class="font-medium">${label}</span>
          <span class="text-xs text-zinc-500">· ${this.#esc(perm)}</span>
          <span class="text-xs ml-auto" style="color:#818cf8">Switch space</span>
          <i data-lucide="chevron-down" style="width:14px;height:14px"></i>
        </button>`;
    }
    lucide?.createIcons?.();
  }

  // ── Spaces ────────────────────────────────────────────────────────────

  openSpaceSheet()  { this.#spaceSheet?.open(); }
  closeSpaceSheet() { this.#spaceSheet?.close(); }
  beginSpaceRename(id) { this.#spaceSheet?.beginRename(id); }
  commitSpaceRename(id) { this.#spaceSheet?.commitRename(id); }
  cancelSpaceRename()   { this.#spaceSheet?.cancelRename(); }

  /**
   * Switch books. Anything open belongs to the space being left, so it closes:
   * a half-filled form pointed at the previous ledger is worse than no form.
   * @param {string|null} spaceId
   */
  switchSpace(spaceId) {
    if (!this.#spaces?.activate(spaceId)) { this.closeSpaceSheet(); return; }
    this.closeSpaceSheet();
    this.closeModal();
    // Detail routes address a specific account/budget in the space we just
    // left, so land somewhere that exists in either book.
    if (['accountDetail', 'budgetDetail'].includes(this.#router.current)) {
      this.#router.navigate('accounts');
    }
    this.#render();
    this.#toast.show(`Now viewing ${this.#spaces.active().label}`);
  }

  /** Re-render after a label change, without switching. */
  refreshAfterSpaceChange() { this.#render(); }

  /**
   * Called after every pull. If the space the user was standing in has been
   * revoked, say so plainly rather than silently relocating them — they were
   * looking at a screenful of someone else's data a moment ago.
   */
  #reconcileSpaces() {
    const lost = this.#spaces?.reconcile?.();
    if (!lost) return;
    this.closeSpaceSheet();
    this.closeModal();
    if (['accountDetail', 'budgetDetail'].includes(this.#router.current)) {
      this.#router.navigate('accounts');
    }
    // The caller re-renders; doing it here too would double-render every
    // revocation.
    this.#toast.show(`${lost.lostLabel} removed your access — switched back to your own space`);
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
      hijriOffset: 0,
    }, state.user);
    if (!state.user.defaultCurrency) state.user.defaultCurrency = state.user.homeCurrency;
    if (!state.user.calendarMode) state.user.calendarMode = state.user.showHijri ? 'both' : 'gregorian';
    if (!Array.isArray(state.debts))              state.debts              = [];
    if (!Array.isArray(state.regularItems))       state.regularItems       = [];
    if (!Array.isArray(state.accountGroups))      state.accountGroups      = [];
    if (!Array.isArray(state.family))             state.family             = [];
    if (!Array.isArray(state.user.collapsedAccountGroups)) state.user.collapsedAccountGroups = [];
    if (!state.merchantCategories) state.merchantCategories = {};

    // hijriOffset back-fill
    if (typeof state.user.hijriOffset !== 'number') state.user.hijriOffset = 0;

    // new-entry defaults back-fill. Kept as strings so a preference pointing at
    // a since-deleted account or payment method degrades to the service
    // fallback (AccountService.defaultId / PaymentTypeService.defaultType).
    if (typeof state.user.defaultAccountId !== 'string')   state.user.defaultAccountId = '';
    if (typeof state.user.defaultPaymentType !== 'string') state.user.defaultPaymentType = 'card';

    // payment-method back-fill (added + deleted/renamed-away built-ins)
    if (!Array.isArray(state.user.customPaymentTypes)) state.user.customPaymentTypes = [];
    if (!Array.isArray(state.user.hiddenPaymentTypes)) state.user.hiddenPaymentTypes = [];

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

    // Back-fill hijriDate on transactions that predate the snapshot system.
    // Use toHijriRaw() (offset=0) since these were created before the offset
    // feature existed — the offset was implicitly 0 at that time.
    const needsHijriBackfill = (state.transactions || []).some((t) => !t.hijriDate);
    if (needsHijriBackfill) {
      (state.transactions || []).forEach((t) => {
        if (!t.hijriDate && t.date) {
          t.hijriDate = this.#hijri.toHijriRaw(t.date);
        }
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

  // ──────────────────────────────────────────────────────────────────────────
  // Private: account group helper
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Resolve the account form's group field. '__new__' means "create the group
   * named in newGroupName"; AccountGroupService.create() owns the naming rules
   * (trimmed, case-insensitively unique) so the form and the manage sheet
   * cannot drift apart.
   */
  #resolveAccountGroupId(data, _state) {
    const { groupId } = data;
    if (!groupId) return { groupId: null };
    if (groupId === '__new__') {
      const res = this.#accountGroups.create(data.newGroupName || '');
      if (!res.ok) return { error: res.reason };
      return { groupId: res.group.id };
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
            // Real ledger type (expense/income) — NOT a phantom 'split-group',
            // which LedgerMath scores as zero, making the whole split invisible
            // to account balances. All legs of a group share the parent type.
            type: (type === 'income' ? 'income' : 'expense'),
            date, accountName: acctName, payee: (r.payee || '').trim(),
            note: (r.note || '').trim(), currency, paymentType, tags, isDuplicate: false,
            createdAt: r.createdat || '', addedBy: r.addedby || '',
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

    // Flag probable duplicates so the "Include probable duplicates" toggle
    // (commitImport) actually does something — previously isDuplicate was never
    // set true, so re-importing the same file silently doubled every row.
    // Match on date · account · type · minor amount · currency · payee, against
    // the existing ledger AND earlier rows within this same file.
    const dupKey = (accId, d) =>
      `${d.date}|${accId}|${d.type}|${d.amount}|${d.currency}|${norm(d.payee || '')}`;
    const seenKeys = new Set(
      state.transactions
        .filter((t) => t.type !== 'transfer')
        .map((t) => `${t.date}|${t.accountId}|${t.type}|${t.amount}|${t.currency}|${norm(t.payee || '')}`),
    );
    for (const d of txDrafts) {
      if (d.type === 'transfer') continue;      // pairs aren't dup-checked
      const existAcc = accByName(d.accountName);
      if (!existAcc) continue;                  // brand-new account → nothing to duplicate
      const key = dupKey(existAcc.id, d);
      if (seenKeys.has(key)) d.isDuplicate = true;
      else seenKeys.add(key);
    }

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
    return CategoryService.colorForName(name);
  }

  #guessCatDefaults(name, type) {
    return this.#categories.guessAppearance(name, type);
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
window.adjustHijriOffset     = (d)     => window.__app.adjustHijriOffset(d);
window.currencySetupNext     = ()      => window.__app.currencySetupNext();
window.setHijriOffset        = (v)     => window.__app.setHijriOffset(v);
window.setTheme              = (m)     => window.__app.setTheme(m);
window.addCustomPaymentType  = ()     => window.__app.addCustomPaymentType();
window.pickPaymentType       = (v)     => window.__app.pickPaymentType(v);
window.onTransferSourceChange= (v)     => window.__app.onTransferSourceChange(v);
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
