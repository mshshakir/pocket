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
import { DemoMode } from './core/DemoMode.js';
import { BookCleaner } from './domain/services/BookCleaner.js';
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
import { DeliveryPlan }        from './domain/services/DeliveryPlan.js';
import { VendorDues }          from './domain/services/VendorDues.js';
import { BudgetOutlook }       from './domain/services/BudgetOutlook.js';
import { BudgetPeriod }        from './domain/services/BudgetPeriod.js';
import { BudgetAdvisor }       from './domain/services/BudgetAdvisor.js';
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
import { PlanCard }            from './ui/components/PlanCard.js';
import { BudgetShareSheet }    from './ui/components/BudgetShareSheet.js';
import { OwnerSpaceService }    from './domain/services/OwnerSpaceService.js';
import { SpaceComposerSheet }   from './ui/components/SpaceComposerSheet.js';

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
import { LockView }          from './ui/views/LockView.js';
import { InvestmentsView }   from './ui/views/InvestmentsView.js';
import { InvestmentModal }   from './ui/modals/InvestmentModal.js';
import { TradeModal }        from './ui/modals/TradeModal.js';
import { HoldingPriceModal } from './ui/modals/HoldingPriceModal.js';
import { HoldingService }    from './domain/services/HoldingService.js';
import { CalendarView }      from './ui/views/CalendarView.js';
import { FamilyView }        from './ui/views/FamilyView.js';

// ── Modals ─────────────────────────────────────────────────────────────────────
import { TransactionModal } from './ui/modals/TransactionModal.js';
import { AccountModal }     from './ui/modals/AccountModal.js';
import { CategoryModal }    from './ui/modals/CategoryModal.js';
import { CategoryMergeModal } from './ui/modals/CategoryMergeModal.js';
import { HelpModal }        from './ui/modals/HelpModal.js';
import { FeedbackModal }    from './ui/modals/FeedbackModal.js';
import { ReimbursementModal } from './ui/modals/ReimbursementModal.js';
import { PauseRepeatModal } from './ui/modals/PauseRepeatModal.js';
import { RepeatPause } from './domain/services/RepeatPause.js';
import { ReimbursementService } from './domain/services/ReimbursementService.js';
import { HelpGuide }        from './ui/components/HelpGuide.js';
import { SortableList }     from './ui/components/SortableList.js';
import { OwedService }      from './domain/services/OwedService.js';
import { CardCycle }        from './domain/services/CardCycle.js';
import { LoanInstalments }  from './domain/services/LoanInstalments.js';
import { BudgetModal }      from './ui/modals/BudgetModal.js';
import { SettingsModal }    from './ui/modals/SettingsModal.js';
import { CsvModal }         from './ui/modals/CsvModal.js';
import { DebtModal }        from './ui/modals/DebtModal.js';
import { FamilyModal }      from './ui/modals/FamilyModal.js';
import { ReconcileModal }   from './ui/modals/ReconcileModal.js';
import { AuthModal }        from './ui/modals/AuthModal.js';
import { RegularItemModal }     from './ui/modals/RegularItemModal.js';
import { DayLogsModal }         from './ui/modals/DayLogsModal.js';
import { SettleModal }          from './ui/modals/SettleModal.js';
import { PauseDeliveriesModal } from './ui/modals/PauseDeliveriesModal.js';
import { NotifyField }          from './ui/components/NotifyField.js';
import { PayBillModal }         from './ui/modals/PayBillModal.js';
import { AddRegularModal }      from './ui/modals/AddRegularModal.js';
import { ShortcutService }      from './domain/services/ShortcutService.js';
import { HabitService }         from './domain/services/HabitService.js';
import { SuggestionService }    from './domain/services/SuggestionService.js';
import { HabitModal }           from './ui/modals/HabitModal.js';
import { BillService }          from './domain/services/BillService.js';
import { CurrencySetupModal }   from './ui/modals/CurrencySetupModal.js';
import { ExportModal }          from './ui/modals/ExportModal.js';
import { PlanBanner }           from './ui/components/PlanBanner.js';
import { AppNotices }           from './ui/components/AppNotices.js';
import { PwaService }           from './core/PwaService.js';
import { Repository }           from './core/Repository.js';
import { GoogleTokenClient }    from './core/GoogleTokenClient.js';
import { DriveAuthBroker }      from './core/DriveAuthBroker.js';
import { DriveClient }          from './domain/services/DriveClient.js';
import { DriveBackupService }   from './domain/services/DriveBackupService.js';
import { BackupFiles }          from './domain/services/BackupFiles.js';
import { DriveRestoreModal }    from './ui/modals/DriveRestoreModal.js';
import { GOOGLE_DRIVE_CLIENT_ID, APP_SUPABASE_URL, APP_SUPABASE_KEY } from './data/constants.js';

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
  /** @type {VendorDues}           */ #vendorDues;
  /** @type {BudgetOutlook}        */ #budgetOutlook;
  /** @type {BillService}          */ #bills;
  /** @type {CategoryMergeModal}   */ #categoryMergeModal;
  /** @type {OwedService}          */ #owed;
  /** @type {SettingsModal}        */ #settingsModal;
  /** @type {HoldingService}       */ #holdings;
  /** @type {boolean} — the app has checked for a session (lock decision is final) */
  #sessionChecked = false;
  /** @type {LockView} */             #lockView = new LockView();
  /** @type {HabitService}         */ #habits;
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
  #exportModal       = null;  // ExportModal
  #planBanner        = null;  // PlanBanner
  /** @type {AppNotices|null} offline note and "backup due" above every page */
  #notices           = null;
  /** @type {PwaService|null} install as an app, offline files, online state */
  #pwa               = null;
  /** @type {DriveBackupService|null} backups to the person's Google Drive */
  #driveBackup       = null;
  /** @type {DriveRestoreModal|null} */
  #driveRestoreModal = null;
  /** Whether the server offers automatic backups; null until asked (when Settings opens). */
  #driveAutoOffered  = null;
  /** An automatic backup failed this visit, so the "backup due" box asks for a tap instead. */
  #driveAutoFailed   = false;
  /** Plans on offer (the plans table), loaded when Settings opens; null until then. */
  #planCatalogue     = null;
  /** What's for sale for this person (payments function), when payment is open; null otherwise. */
  #paymentOffers     = null;
  /** The product being paid for right now (disables the buy buttons), or null. */
  #buying            = null;
  /** A coupon code typed in Your plan, used for the next purchase. */
  #coupon            = '';
  /** The plan chooser's Monthly/Yearly switch (null: follow the person's plan), code box, highlighted plan. */
  #planTerm          = null;
  #couponOpen        = false;
  /** The code whose prices are showing, a refusal to show under the box, and a check in progress. */
  #couponApplied     = null;
  #couponError       = '';
  #couponChecking    = false;
  #planHighlight     = null;
  static #PENDING_PLANS = 'pocket.pendingPlans';
  /** @type {import('./domain/billing/PaymentService.js').PaymentService|null} */
  #payments          = null;

  // ── Per-session UI state ──────────────────────────────────────────────────
  #reportRange    = '30';
  #importPlan     = null;
  /** @type {SwipeRowController} — owns all row-swipe gesture + reveal state */
  #swipe              = null;
  /** @type {SpaceRegistry} */
  #spaces             = null;
  /** @type {SpaceSheet} */
  #spaceSheet         = null;
  /** @type {BudgetShareSheet} */
  #budgetShareSheet   = null;
  /** @type {OwnerSpaceService} */
  #ownerSpaces        = null;
  /** @type {SpaceComposerSheet} */
  #spaceComposer      = null;
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
    this.#bills       = new BillService({ store: this.#store, recurring: this.#recurring });
    this.#habits      = new HabitService({ convert: (m, f, t) => this.#fx.convert(m, f, t) });
    this.#regularLogs = new RegularLogService({ store: this.#store });
    this.#vendorDues  = new VendorDues({ store: this.#store, regularLogs: this.#regularLogs });
    this.#budgetOutlook = new BudgetOutlook({ budgets: this.#budgets, bills: this.#bills, vendorDues: this.#vendorDues, fx: this.#fx });
    this.#holdings    = new HoldingService({ state: () => this.#store.getState(), fx: this.#fx });
    this.#owed        = new OwedService({ store: this.#store, fx: this.#fx, bills: () => this.#bills, vendorDues: () => this.#vendorDues, accounts: () => this.#accounts });
    this.#sync        = new SyncService();
    this.#themeService       = new ThemeService(this.#store);
    this.#paymentTypeService = new PaymentTypeService(this.#store);
    this.#accountGroups      = new AccountGroupService(this.#store);
    this.#familyShares       = new FamilyShareService(this.#store);
    this.#fxRates            = new ExchangeRateService();
    this.#ownerSpaces        = new OwnerSpaceService(this.#store);
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
    this.#spaceComposer = new SpaceComposerSheet({
      store:             this.#store,
      ownerSpaceService: this.#ownerSpaces,
      syncService:       this.#sync,
    });
    this.#budgetShareSheet = new BudgetShareSheet({
      store:              this.#store,
      familyShareService: this.#familyShares,
      syncService:        this.#sync,
    });
    // The controller owns the gesture; the app owns what deleting means.
    //
    // The confirmation is raised HERE rather than inside the delete methods, and
    // returning false declines — the controller animates the row away only once
    // this resolves, so cancelling leaves the row revealed instead of hiding an
    // undeleted row. The delete methods are then called with confirm:false to
    // avoid asking twice.
    this.#swipe = new SwipeRowController({
      onDelete: ({ id, shareIndex, isOwnContrib }) => {
        if (!confirm('Delete this transaction?')) return false;
        if (shareIndex >= 0 && isOwnContrib) this.deleteSharedContrib(shareIndex, id, { confirm: false });
        else if (shareIndex >= 0)            this.deleteSharedTx(shareIndex, id, { confirm: false });
        else                                 this.deleteTx(id, { confirm: false });
        return true;
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
    this.#budgetShareSheet.mount(container);
    this.#spaceComposer.mount(container);
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
      vendorDues:         this.#vendorDues,
    });
    this.#currencySetupModal = new CurrencySetupModal({ store: this.#store });
    this.#modal.register('transaction',  this.#txModal);
    this.#modal.register('account',      new AccountModal());
    this.#modal.register('category',     new CategoryModal());
    this.#modal.register('help',         new HelpModal());
    this.#modal.register('investment',   new InvestmentModal());
    this.#modal.register('trade',        new TradeModal({ holdings: () => this.#holdings }));
    this.#modal.register('holdingPrice', new HoldingPriceModal({ holdings: () => this.#holdings }));
    this.#modal.register('reimbursement', new ReimbursementModal());
    this.#modal.register('pauseRepeat', new PauseRepeatModal());
    this.#modal.register('feedback',     new FeedbackModal({ signedIn: () => !!this.#sync.currentUser }));
    // Drag-to-reorder lists (Accounts → Reorder); one listener for every render.
    new SortableList({ onDrop: (key, ids) => this.#onSortDrop(key, ids) });
    this.#modal.register('categoryMerge', this.#categoryMergeModal = new CategoryMergeModal({ categories: () => this.#categories }));
    this.#modal.register('budget',       new BudgetModal());
    this.#modal.register('settings',     this.#settingsModal = new SettingsModal());
    this.#modal.register('csv',          new CsvModal());
    this.#exportModal = new ExportModal({ store: this.#store });
    this.#modal.register('export',       this.#exportModal);
    this.#modal.register('debt',         this.#debtModal);
    this.#modal.register('debtPayment',  this.#debtModal);
    this.#modal.register('familyMember', this.#familyModal);
    this.#modal.register('auth',         new AuthModal());
    this.#modal.register('regularItem',  new RegularItemModal());
    this.#modal.register('reconcile',    this.#reconcileModal);
    this.#modal.register('dayLogs',      this.#dayLogsModal);
    this.#modal.register('settle',       new SettleModal({ dues: () => this.#vendorDues }));
    this.#modal.register('pauseDeliveries', new PauseDeliveriesModal());
    this.#modal.register('payBill',      new PayBillModal({ bills: () => this.#bills }));
    this.#modal.register('addRegular',   new AddRegularModal());
    this.#modal.register('habit',        new HabitModal({ habits: () => this.#habits }));
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
      if (user) setTimeout(() => this.#resumePlanLink(), 400);
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

    // Plans: the banner above every page, and Settings kept current.
    this.#planBanner = new PlanBanner(document.getElementById('planBanner'), this.#bus);
    this.#bus.on('plan:changed', () => {
      // Scheduled backups: remember on this device what the signed-in person's plan says.
      if (this.#sync.currentUser && this.#driveBackup) {
        this.#driveBackup.setUnlocked(Repository.storedOwner(), !!this.#sync.plan?.backup);
        this.#refreshNotices();
      }
      if (this.#modal.active === 'settings') this.#modal.refresh();
    });

    // The session check decides between the book and the lock screen.
    this.#bus.on('session:known', () => { this.#sessionChecked = true; this.#render(); });

    // Install as an app + offline files; notes above every page; Google Drive backup.
    this.#startAppShell();

    // 8. Initial render (shows locally-cached or seed data while Supabase loads;
    //    a book that belongs to an account waits on "Opening your book…")
    this.#render();

    // 8b. Demo mode (app.html?demo): the sample book in memory only — cloud
    //     sync never starts, so nothing is saved and no real book is touched.
    if (DemoMode.active) {
      this.#sessionChecked = true;
      const start = DemoMode.start;
      if (start) {
        this.navigate(start.page);
        if (start.tab && start.page === 'calendar') this.setCalTab(start.tab);
        if (start.tab && start.page === 'reports') this.setReportTab(start.tab);
      }
      this.#render();
      return;
    }

    // 9. Init Supabase — restores session, pulls cloud data, then re-renders
    if (!this.#sync.init()) {
      this.#sessionChecked = true;
      this.#render();
    } else {
      this.#sync.restoreSession().then((result = {}) => {
        const { needsSignIn, isFirstSignIn } = result;
        this.#sessionChecked = true;
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
    // 11. A pricing button on the website: show the plan chooser (after sign-in).
    this.#takePlanLink();
    setTimeout(() => this.#resumePlanLink(), 700);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────────────────────

  navigate(id) {
    if (id === '__add')  return this.openModal('transaction', {});
    if (id === '__more') return this.#openMoreMenu();
    if (id !== 'categories') this.#views.get('categories')?.clearPicking?.(); // leaving ends merge ticking
    if (id !== 'accounts') this.#views.get('accounts')?.stopReorder?.();
    // Regulars always opens on its Calendar tab; links that want another tab
    // navigate first and then call setCalTab.
    if (id === 'calendar' && this.#router.current !== 'calendar') this.#views.get('calendar')?.setTab?.('grid');
    this.#router.navigate(id);
    this.#render();
  }

  /** Open a bottom-sheet "More" menu showing nav items not in the mobile tab bar. */
  #openMoreMenu() {
    const MORE_ITEMS = [
      { id: 'accounts',   label: 'Accounts',          icon: 'wallet'         },
      { id: 'budgets',    label: 'Budgets',            icon: 'target'         },
      { id: 'debts',      label: 'Debts',              icon: 'hand-coins'     },
      { id: 'investments',label: 'Investments',        icon: 'gem'            },
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
            <div class="grid grid-cols-2 gap-2">
              <button class="btn btn-outline w-full gap-2"
                onclick="window.__app.closeModal(); setTimeout(()=>window.__app.openModal('settings',{}),50)">
                <i data-lucide="settings"></i> Settings
              </button>
              <button class="btn btn-outline w-full gap-2 more-feedback"
                onclick="window.__app.closeModal(); setTimeout(()=>window.__app.openModal('feedback',{}),50)">
                <i data-lucide="message-circle"></i> Feedback
              </button>
            </div>
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
    'account', 'budget', 'category', 'categoryMerge', 'investment', 'trade', 'holdingPrice', 'debt', 'debtPayment', 'regularItem', 'settle', 'pauseDeliveries', 'pauseRepeat', 'reimbursement', 'payBill', 'addRegular', 'habit',
    'csv', 'reconcile', 'family', 'currencySetup',
  ]);

  openModal(name, opts = {}) {
    // In the demo, signing in means leaving it for the real app.
    if (DemoMode.active && name === 'auth') { window.location.href = DemoMode.exitUrl('#signin'); return; }
    if (this.#lockState() && name !== 'auth') return; // the book stays closed until sign-in
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
    if (name === 'settings') {
      this.#refreshPlanInfo();
      if (this.driveStatus().available && this.#pwa?.online !== false) {
        this.#driveBackup.warm();
        this.#driveBackup.automaticOffered().then((yes) => {
          if (yes === this.#driveAutoOffered) return;
          this.#driveAutoOffered = yes;
          if (this.#modal.active === 'settings') this.#modal.refresh();
        });
      }
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
    if (this.#budgetShareSheet?.isOpen)  this.#budgetShareSheet.close();
    if (this.#spaceComposer?.isOpen)     this.#spaceComposer.close();
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
  /** What's owed to vendors for pay-later regular items. */
  get vendorDues() { return this.#vendorDues; }
  /** Recurring bills that wait to be paid (amount changes). */
  get bills() { return this.#bills; }
  /** Bills and deliveries still to come inside each budget's period. */
  get budgetOutlook() { return this.#budgetOutlook; }
  get owed()  { return this.#owed; }
  get holdings() { return this.#holdings; }
  /** Habits followed in Reports. */
  get habits() { return this.#habits; }
  /** The signed-in email, for "who gets the Telegram message". */
  currentUserEmail() { return this.#sync.currentUser?.email || null; }

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

  // ── Plans ─────────────────────────────────────────────────────────────

  /** @returns {import('./domain/billing/Entitlements.js').Entitlements} */
  getPlan() { return this.#sync.plan; }

  /**
   * After a scan or voice entry: the usual note, or — when the person's own
   * credits are running low (less than two scans' worth) — how many are left,
   * with a button to buy a pack.
   * @param {string} message
   */
  #aiDoneToast(message) {
    const use = this.receiptScanner.lastUse;
    const scan = this.#sync.plan?.aiCosts?.scan ?? 5;
    const low = use && use.chargedTo !== 'unlimited' && use.remaining !== null && use.remaining < scan * 2;
    if (!low) { this.#toast.show(message); return; }
    const left = use.remaining;
    this.#toast.show(`${left} AI credit${left === 1 ? '' : 's'} left`, {
      action: { label: 'Buy a pack', run: () => { this.closeModal(); this.openModal('settings'); this.setSettingsTab('account'); } },
    });
  }

  /** The line under the voice timer: speak clearly, and what it costs (nothing to say about cost on unlimited). */
  #voiceNote() {
    const plan = this.#sync.plan;
    if (!plan || plan.aiUnlimited) return 'Speak clearly, close to the phone.';
    const c = plan.aiCosts;
    return `Speak clearly, close to the phone. ${c.voice} credit for every ${c.voiceSeconds} seconds, used even if it mishears you.`;
  }

  /** Plans on offer, or null while loading (Settings shows "Loading plans…"). */
  get planCatalogue() { return this.#planCatalogue; }

  /** What's for sale (null while loading or when payment is off). */
  get paymentOffers() { return this.#paymentOffers; }

  /** The product being paid for right now, or null. */
  get buying() { return this.#buying; }

  /** The coupon code typed so far. */
  get coupon() { return this.#coupon; }

  /** Remembers the typed code without redrawing (so typing isn't interrupted). */
  setCoupon(value) {
    this.#coupon = String(value ?? '').slice(0, 32);
    if (this.#couponError) this.#couponError = '';
  }

  /** How the plan chooser is set: Monthly/Yearly, code box, a plan to point out, the applied code. */
  get planUi() {
    const term = this.#planTerm ?? (this.getPlan()?.term === 'month' ? 'month' : 'year');
    return {
      term, couponOpen: this.#couponOpen, highlight: this.#planHighlight,
      couponApplied: this.#couponApplied, couponError: this.#couponError, couponChecking: this.#couponChecking,
    };
  }

  /** Checks the typed code and shows every price with it applied (or why it can't be used). */
  async applyCoupon() {
    const code = this.#coupon.trim();
    if (!code || this.#couponChecking || !this.#sync.currentUser) return;
    this.#payments ??= this.#sync.payments();
    this.#couponChecking = true; this.#couponError = '';
    this.#modal.refresh();
    try {
      const offers = await this.#payments.offers(code);
      this.#paymentOffers = offers;
      this.#couponApplied = offers.coupon?.code ?? null;
      this.#coupon = this.#couponApplied ?? code;
    } catch (e) {
      this.#couponApplied = null;
      this.#couponError = e?.message || 'That code couldn\'t be checked. Please try again.';
    } finally {
      this.#couponChecking = false;
      this.#modal.refresh();
    }
  }

  /** Takes the code off and shows the usual prices again. */
  async removeCoupon() {
    this.#coupon = ''; this.#couponApplied = null; this.#couponError = ''; this.#couponOpen = false;
    this.#modal.refresh();
    await this.#refreshPlanInfo();
  }

  setPlanTerm(term) {
    this.#planTerm = term === 'month' ? 'month' : 'year';
    this.#modal.refresh();
  }

  openCoupon() {
    this.#couponOpen = true;
    this.#modal.refresh();
    setTimeout(() => document.querySelector('.plan-coupon')?.focus(), 30);
  }

  /**
   * The website's pricing buttons link to app.html#plans=<product> (e.g.
   * family_year). Remember the choice (it must survive a Google sign-in
   * round trip), then show the plan chooser with that plan and term picked.
   */
  #takePlanLink() {
    const m = window.location.hash.match(/^#plans(?:=([a-z_]+))?$/);
    if (!m) return;
    history.replaceState(null, '', window.location.pathname);
    try { sessionStorage.setItem(Application.#PENDING_PLANS, m[1] || 'plans'); } catch (_) { /* private mode */ }
  }

  /** Opens the plan chooser for a pending website link, signing in first if needed. */
  #resumePlanLink() {
    let pending = null;
    try { pending = sessionStorage.getItem(Application.#PENDING_PLANS); } catch (_) { return; }
    if (!pending) return;
    if (!this.#sync.currentUser) { this.openModal('auth'); return; }
    try { sessionStorage.removeItem(Application.#PENDING_PLANS); } catch (_) { /* ignore */ }
    const [, plan, term] = pending.match(/^([a-z]+)_(month|year|trial)$/) ?? [];
    if (plan) { this.#planHighlight = plan; this.#planTerm = term === 'month' ? 'month' : 'year'; }
    this.openModal('settings');
    let tries = 0;
    const scroll = () => {
      const el = document.getElementById(plan ? `plan-${plan}` : 'planCard');
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
      if (++tries < 30) setTimeout(scroll, 150);
    };
    setTimeout(scroll, 150);
  }

  /**
   * Pay for a plan, trial or AI pack with Razorpay, then show the new plan.
   * @param {string} product  e.g. 'sync_month', 'family_trial', 'ai_pack'
   */
  async buy(product) {
    if (this.#buying || !this.#sync.currentUser) return;
    this.#payments ??= this.#sync.payments();
    this.#buying = product;
    this.#modal.refresh();
    try {
      const code = this.#couponApplied && this.#paymentOffers?.coupon?.products?.includes(product) ? this.#couponApplied : '';
      await this.#payments.buy(product, { email: this.#sync.currentUser.email, code });
      this.#coupon = ''; this.#couponApplied = null; this.#couponOpen = false;
      this.#toast.show(product === 'ai_pack' ? 'Payment received — AI credits added'
        : product === 'drive_backup' ? 'Payment received — scheduled backups are on'
        : 'Payment received — your plan is updated');
    } catch (e) {
      if (e?.code !== 'dismissed') this.#toast.show(e?.message || 'The payment didn\'t go through. Please try again.');
    } finally {
      this.#buying = null;
      await this.#refreshPlanInfo();
      this.#modal.refresh();
    }
  }

  /**
   * Moves to a cheaper plan for free; the time left becomes days on it.
   * Leaving a plan with sharing warns that family members lose the shared space.
   * @param {string} code  e.g. 'sync'
   */
  async switchPlan(code) {
    if (this.#buying || !this.#sync.currentUser) return;
    const option = this.#paymentOffers?.switches?.[code];
    const target = this.#planCatalogue?.find((p) => p.code === code);
    const current = this.#planCatalogue?.find((p) => p.code === this.getPlan()?.plan);
    if (!option || !target) return;
    const losing = current?.sharing && !target.sharing
      ? ' People you share with will lose access to your shared space today (their own books stay).' : '';
    if (!confirm(`Switch to ${target.name} now? Your time left on ${option.fromName} becomes ${PlanCard.span(option.days)} of ${target.name}, at no charge.${losing}`)) return;
    this.#payments ??= this.#sync.payments();
    this.#buying = `switch:${code}`;
    this.#modal.refresh();
    try {
      await this.#payments.switchPlan(code);
      this.#toast.show(`You're on ${target.name} now`);
    } catch (e) {
      this.#toast.show(e?.message || 'The switch didn\'t go through. Please try again.');
    } finally {
      this.#buying = null;
      await this.#refreshPlanInfo();
      this.#modal.refresh();
    }
  }

  /** Everything in this book as one file that Import JSON can bring back. */
  downloadMyData() { this.exportJson(); }

  dismissPlanBanner() { this.#planBanner?.dismiss(); }

  /** Settings is opening: ask for the latest plan and price list, then redraw it. */
  async #refreshPlanInfo() {
    if (!this.#sync.currentUser) return;
    const [plan, catalogue] = await Promise.all([
      this.#sync.refreshPlan(),
      this.#sync.planCatalogue().catch(() => []),
    ]);
    this.#planCatalogue = catalogue;
    this.#payments ??= this.#sync.payments();
    let offers = null;
    if (plan?.paymentsOpen) {
      // Keep an applied code's prices showing; if it has stopped working, fall back to plain prices.
      offers = this.#couponApplied ? await this.#payments.offers(this.#couponApplied).catch(() => null) : null;
      if (!offers) { this.#couponApplied = null; offers = await this.#payments.offers().catch(() => null); }
    }
    this.#paymentOffers = offers;
    if (this.#modal.active === 'settings') this.#modal.refresh();
  }

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

  // ──────────────────────────────────────────────────────────────────────────
  // Settings mutations
  // ──────────────────────────────────────────────────────────────────────────

  setHomeCurrency(v) {
    this.#store.getState().user.homeCurrency = v;
    this.#store.persist();
    this.#render(); this.#keepSettingsOpen();
    this.#toast.show('Home currency: ' + v);
  }

  setDefaultCurrency(v) {
    this.#store.getState().user.defaultCurrency = v;
    this.#store.persist();
    this.#render(); this.#keepSettingsOpen();
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
    this.#render(); this.#keepSettingsOpen();
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
    this.#render(); this.#keepSettingsOpen();
    this.#toast.show(`Theme: ${v}`);
  }

  get paymentTypeService() { return this.#paymentTypeService; }
  /** The space registry — BaseView reads through this on every render. */
  get spaces() { return this.#spaces; }
  /** FamilyShareService — grants for accounts and budgets. */
  get familyShares() { return this.#familyShares; }
  get budgetShareSheet() { return this.#budgetShareSheet; }
  get spaceComposer() { return this.#spaceComposer; }
  /** The spaces YOU share — composition, not the ones shared WITH you. */
  get ownerSpaces() { return this.#ownerSpaces; }

  /** Open the composer for one of your spaces. @param {string} spaceId */
  openSpaceComposer(spaceId) { this.#spaceComposer?.open(spaceId); }

  /** Create a space and drop straight into composing it. */
  createOwnerSpace() {
    const name = prompt('Name this space\n\ne.g. Household, Business, Trip to Dubai');
    if (name === null) return;
    const res = this.#ownerSpaces.create(name);
    if (!res.ok) return this.#toast.show(res.reason);
    this.#render();
    this.#spaceComposer?.open(res.space.id);
  }

  /**
   * Open the per-budget share sheet. Refused in a guest space for the same
   * reason the budget modal is: you cannot re-share someone else's budget.
   * @param {string} budgetId
   */
  /**
   * Rename the space a member sees.
   *
   * The label lives on the member because family_shares is keyed
   * (owner_id, member_email) — one space per pair — so different people can
   * already be shown different names. It travels in the snapshot as
   * `sharedBy`, which is why the member's own override in
   * `user.spaceLabels` still wins on their device: your name for it is a
   * suggestion, not an imposition.
   * @param {string} memberId
   */
  renameSharedSpace(memberId) {
    const member = (this.#store.getState().family || []).find((m) => m.id === memberId);
    if (!member) return this.#toast.show('That member no longer exists');
    const current = member.spaceName || '';
    const next = prompt(
      `What should ${member.name || 'they'} see this space called?\n\nLeave empty to use your own name.`,
      current,
    );
    if (next === null) return;                       // cancelled
    const res = this.#familyShares.setSpaceName(memberId, next);
    if (!res.ok) return this.#toast.show(res.reason);
    this.#sync.schedulePush?.();
    this.#render();
    this.#toast.show(next.trim() ? `Renamed to ${next.trim()}` : 'Using your own name');
  }

  shareBudget(budgetId) {
    const space = this.#spaces?.active?.();
    if (space && !space.isHome) {
      return this.#toast.show('You can only share budgets from your own space');
    }
    this.#budgetShareSheet?.open(budgetId);
  }
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
    if (!this.#receipts) this.#receipts = new ReceiptScanService(this.#sync.aiGateway());
    return this.#receipts;
  }

  /** Whose book an AI entry is for: the shared space being viewed, or your own. */
  #aiBook() {
    const space = this.#spaces?.active?.();
    if (space && !space.isHome) return space.id;
    return this.#sync.currentUser?.id ?? null;
  }

  /** Show an AI failure, and open the place that fixes it (sign-in, Your plan). */
  #showAiError(e, what) {
    if (e?.code === 'signed_out') {
      this.#toast.show(e.message);
      this.openModal('auth');
    } else if (e?.code === 'no_credits') {
      this.#toast.show(e.message);
      this.openModal('settings');
    } else {
      this.#toast.show(`${what} failed: ${e?.message || 'Unknown error'}`);
    }
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
    this.#render(); this.#keepSettingsOpen();
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
      // A transfer is TWO linked rows; a contribution is one. Writing
      // `type: 'transfer'` through this path would put a single leg with no
      // counter-leg into the owner's book, so money would appear or vanish from
      // their ledger. The modal hides the Transfer tab in shared mode, but the
      // type can also arrive from a voice prefill, so it is refused here too —
      // this is the path that actually reaches the owner's data.
      if (data.type === 'transfer') {
        return this.#toast.show('Transfers aren\u2019t available in a shared space');
      }
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
    if (data.type !== 'transfer' && fd.get('recurringEnabled') && !String(data.payee || '').trim()) {
      // a repeat is listed by its name (Bills, the calendar, reminders)
      const field = event.target.querySelector('[name="payee"]');
      field?.closest('details')?.setAttribute('open', '');
      field?.focus?.();
      return this.#toast.show('Give it a name — e.g. Rent, Electricity');
    }
    if (data.type !== 'transfer' && fd.get('recurringEnabled')) {
      recurring = {
        rule:     fd.get('recurringRule') || 'monthly',
        interval: Math.max(1, Number(fd.get('recurringInterval')) || 1),
        until:    fd.get('recurringUntil') || null,
      };
    }
    // A repeating bill whose amount changes waits to be paid (BillService).
    const remind = NotifyField.read(fd, 'remind');
    const bill = recurring && fd.get('recurringAsk')
      ? { askFirst: true, remindTo: remind.to, remindEmail: remind.email, remindDays: Math.max(0, Number(fd.get('remindDays')) || 0) }
      : { askFirst: undefined, remindTo: undefined, remindEmail: undefined, remindDays: undefined };

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

    // Someone will pay this back (expenses only). A payback entry keeps its
    // links; its amount can't drop below what it already shares out.
    const existingTx = id ? state.transactions.find((x) => x.id === id) : null;
    let reimb = {};
    if (existingTx && ReimbursementService.isPayment(existingTx)) {
      const shared = (existingTx.reimbAlloc || []).reduce((n, a) => n + (Number(a.pay) || 0), 0);
      if (data.type !== 'income') return this.#toast.show('This is money paid back — it stays as money in');
      if (minor < shared || currency !== existingTx.currency) {
        return this.#toast.show(`It’s shared across items as ${this.#fx.formatMoney(shared, existingTx.currency)} — delete it and record it again to change that`);
      }
      const extra = minor - shared;
      reimb = { reimbExtra: extra, reimbExtraAs: extra > 0 ? (existingTx.reimbExtraAs || 'keep') : null };
    } else if (data.type !== 'transfer') {
      const r = this.#reimbFields(fd, { amount: minor, currency, existing: existingTx });
      if (r.error) return this.#toast.show(r.error);
      reimb = data.type === 'expense' || existingTx?.reimbBy ? r.fields : {};
    }

    let habitNote = null;
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
          splits, recurring, ...bill, ...reimb,
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
          splits, recurring, ...bill, ...reimb,
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
        const created = this.#transactions.create({
          accountId: data.accountId,
          categoryId: splits ? null : (data.categoryId || null),
          amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
          payee: data.payee, note: data.note, date: data.date,
          paymentType: data.paymentType, type: data.type,
          splits, recurring, ...bill,
          acctMinor: txAcctMinor,
          addedBy: this.#sync.currentUser?.email || null,
          regularItemId: data.regularItemId || null,
        });
        for (const [k, v] of Object.entries(reimb)) if (v != null) created[k] = v;
        habitNote = this.#habitNote(created, state);
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
    this.#toast.show(id ? 'Transaction updated' : habitNote ? `Added · ${habitNote}` : 'Transaction added');
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
    // Items to get back can be old: show all time unless dates were picked.
    if (key === 'reimb' && value && v?.filter && !v.filter.dateFrom && !v.filter.dateTo) v.setFilter('range', 'all');
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
  /** A setting changed: re-draw the page behind and keep Settings open on its tab. */
  #keepSettingsOpen() {
    if (this.#modal.active === 'settings') this.#refreshModal({ capture: false });
  }

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

  /** New-entry form: "Make this a bill" (repeats monthly) or "Not a bill". Keeps what's typed. */
  makeTxBill(on = true) {
    this.#txModal?.captureForm?.();
    this.#txModal?.setBill?.(on !== false);
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

  /**
   * Account changed on a shared-account contribution.
   *
   * The currency is locked to the account in shared mode, so this needs a full
   * re-render rather than a DOM patch — but the form values are captured first
   * so a half-typed amount survives. The owner is unchanged, so the category
   * selection is deliberately NOT reset.
   * @param {string} accId
   */
  onSharedTxAccountChange(accId) {
    if (!this.#txModal?.setSharedAccount?.(accId)) return;
    this.#refreshModal({ capture: true });
  }

  /**
   * Find an account by id in EITHER book — the user's own, or any snapshot
   * shared with them.
   *
   * This lookup was copy-pasted at three call sites (onTxAccountChange,
   * updateTxFxPanel, resetTxFx), which is three chances for one of them to
   * drift. A form can legitimately point at a shared account while the user
   * stands in their own space, because the account dropdown still offers a
   * "Shared with me" group — so the fallback is live, not legacy.
   * @param {string} accId
   * @returns {object|undefined}
   */
  #anyAccount(accId) {
    const state = this.#store.getState();
    return state.accounts.find((a) => a.id === accId)
      || (state._sharedData || []).flatMap((s) => s.accounts || []).find((a) => a.id === accId);
  }

  onTxAccountChange(accId) {
    // Check own accounts first, then shared accounts
    const acc = this.#anyAccount(accId);
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

    const accId = document.querySelector('[name=accountId]')?.value;
    const acc   = this.#anyAccount(accId);
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
    const accId = document.querySelector('[name=accountId]')?.value;
    const acc   = this.#anyAccount(accId);
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
   * Delegates all AI interaction to ReceiptScanService (domain layer), which
   * goes through Pocket's `ai` server function (plan credits, no personal key).
   * This method is responsible only for:
   *   1. Choosing whose book the entry is for (own, or the shared space shown)
   *   2. Updating the scan-label button text during the async call
   *   3. Opening a fresh pre-filled transaction modal on success
   *   4. Showing a specific error toast and restoring the button on failure
   */
  async scanReceipt(input) {
    const file = input?.files?.[0];
    if (!file) return;

    // ── Scanning feedback: update the button label (mirror reference) ─────
    const scanLabel = input.closest('label');
    const scanText  = scanLabel?.querySelector('.scan-label-text');
    if (scanText) scanText.textContent = 'Scanning…';
    this.#toast.show('Scanning receipt…');

    try {
      const scanner = this.receiptScanner;
      const prefill = await scanner.scan(file, { book: this.#aiBook() });

      // Close the current modal (if open) and open a fresh, fully pre-filled one
      this.closeModal();
      this.openModal('transaction', { prefill });
      this.#aiDoneToast('Receipt scanned · review and save');
    } catch (e) {
      this.#showAiError(e, 'Scan');
      // Restore button label on any failure
      if (scanText) scanText.textContent = 'Scan receipt';
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

    // Signed out: say so before asking for the microphone.
    if (!this.#sync.currentUser) {
      this.#toast.show('Please sign in to use voice entry.');
      this.openModal('auth');
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
        const prefill = await this.receiptScanner.parseVoice(blob, { book: this.#aiBook(), seconds: recorder.seconds });
        finish();
        this.closeModal();
        this.openModal('transaction', { prefill });
        this.#aiDoneToast('Heard it · review and save');
      } catch (e) {
        finish();
        this.#showAiError(e, 'Voice');
      }
    };

    // Request the mic FIRST; only show the overlay once recording is live, so a
    // denied-permission prompt doesn't leave an empty meter on screen.
    try {
      await recorder.start();
      overlay.open(() => recorder.getLevel(), this.#voiceNote());
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
      this.#accounts.update(id, { name: data.name, type: data.type, currency: data.currency, color: data.color, archived: !!data.archived, groupId, ...this.#cardFields(data), ...this.#accountExtras(data) });

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
    const a     = this.#accounts.create({ name: data.name, type: data.type, currency: data.currency, color: data.color, icon: data.icon || AccountService.typeIcon(data.type), groupId });
    Object.assign(a, this.#cardFields(data), this.#accountExtras(data));
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

  /**
   * Credit-card settings from the account form. Kept (not cleared) when the
   * type changes away from card, so switching back doesn't lose them.
   * @returns {{creditLimit?:number|null, statementDay?:number|null, dueDay?:number|null}}
   */
  #cardFields(data) {
    if (data.type !== 'card') return {};
    const day = (v) => { const n = Math.round(Number(v)); return n >= 1 && n <= 31 ? n : null; };
    const limit = Number(data.creditLimit);
    return {
      creditLimit:  limit > 0 ? this.#fx.toMinor(limit, data.currency) : null,
      statementDay: day(data.statementDay),
      dueDay:       day(data.dueDay),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Investments (gold, silver and shares) — see HoldingService
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * What an account is worth today: its balance, plus — for an investment
   * account — its holdings at the latest price instead of what was paid.
   * @param {object} account
   * @returns {number} minor units of the account's currency
   */
  accountWorth(account) {
    const base = Math.round(account?.balance ?? 0);
    return account?.type === 'invest' ? base + this.#holdings.adjustmentFor(account.id) : base;
  }

  /**
   * What holdings add to net worth at today's prices, in the home currency:
   * Σ over investment accounts that count in totals of (worth − balance).
   */
  holdingsAdjustmentHome() {
    const state = this.#store.getState();
    const home = state.user.homeCurrency;
    return state.accounts.filter((a) => a.type === 'invest' && AccountService.inTotals(a))
      .reduce((s, a) => s + this.#fx.convert(this.#holdings.adjustmentFor(a.id), a.currency, home), 0);
  }

  /** Add-investment form: gold / silver / shares changed → purities, or company and code. */
  onHoldingKindChange(radio) {
    const form = radio.form;
    const k = HoldingService.KINDS[radio.value] || HoldingService.KINDS.gold;
    const shares = radio.value === 'shares';
    const sel = form?.querySelector('select[name="purity"]');
    if (sel && !shares) sel.innerHTML = InvestmentModal.purityOptions(radio.value);
    for (const el of form.querySelectorAll('[data-kind-only]')) el.style.display = (el.dataset.kindOnly === 'shares') === shares ? '' : 'none';
    for (const el of form.querySelectorAll('[data-qty-label]')) el.textContent = k.qtyLabel;
    for (const el of form.querySelectorAll('[data-per]')) el.textContent = k.per;
    const qty = form.querySelector('[name="grams"]');
    if (qty) qty.step = shares ? '1' : '0.001';
  }

  /** Add-investment form: "I already own it" / "Buying now". */
  onHoldingHowChange(radio) {
    const form = radio.form;
    for (const el of form.querySelectorAll('[data-how]')) el.style.display = el.dataset.how === radio.value ? '' : 'none';
    for (const el of form.querySelectorAll('[data-how-label]')) el.style.display = el.dataset.howLabel === radio.value ? '' : 'none';
  }

  /** Buy/Sell form: "10 g × ₹7,200 + ₹500 charges = ₹72,500". */
  updateTradeTotal(form) {
    const out = form?.querySelector('.trade-total');
    if (!out) return;
    const g = Number(form.querySelector('[name="grams"]').value), p = Number(form.querySelector('[name="price"]').value);
    const c = Number(form.querySelector('[name="charges"]')?.value) || 0;
    const cur = out.dataset.currency, sell = !!out.dataset.sell;
    const unit = out.dataset.unit === 'g' ? ' g' : (g === 1 ? ' share' : ' shares');
    const total = g * p + (sell ? -c : c);
    out.textContent = g > 0 && p > 0
      ? `${g}${unit} × ${this.#fx.formatMoney(this.#fx.toMinor(p, cur), cur)}${c ? ` ${sell ? '−' : '+'} ${this.#fx.formatMoney(this.#fx.toMinor(c, cur), cur)} charges` : ''} = ${this.#fx.formatMoney(this.#fx.toMinor(total, cur), cur)}`
      : '';
  }

  /** The investment account a new holding goes in, made if needed. */
  #investAccount(chosen) {
    const state = this.#store.getState();
    const found = state.accounts.find((a) => a.id === chosen && a.type === 'invest');
    if (found) return found;
    const existing = state.accounts.filter((a) => a.type === 'invest' && !a.archived);
    const name = existing.some((a) => a.name === 'Investments') ? `Investments ${existing.length + 1}` : 'Investments';
    return this.#accounts.create({ name, type: 'invest', currency: state.user.homeCurrency || 'INR', color: '#d97706', icon: AccountService.typeIcon('invest') });
  }

  submitInvestment(event, id) {
    event.preventDefault();
    const fd = Object.fromEntries(new FormData(event.target).entries());
    const state = this.#store.getState();
    if (id) {
      const h = this.#holdings.find(id);
      if (!h) return;
      h.name = String(fd.name || '').trim() || h.name;
      if (fd.purity && h.kind !== 'shares') h.purity = fd.purity;
      if (h.kind === 'shares') { const code = String(fd.code || '').trim().toUpperCase(); if (code) h.code = code; else delete h.code; }
      const q = Number(fd.openingQty), c = Number(fd.openingCost);
      h.openingQty = q > 0 ? Math.round(q * 1000) / 1000 : 0;
      h.openingCost = c > 0 ? this.#fx.toMinor(c, h.currency) : 0;
      this.#store.persist(); this.closeModal(); this.#render();
      this.#toast.show('Saved');
      return this.#sync.schedulePush?.();
    }
    const shares = fd.kind === 'shares';
    const grams = Number(fd.grams);
    if (shares && !String(fd.company || '').trim()) return this.#toast.show('Enter the company name');
    if (!(grams > 0)) return this.#toast.show(shares ? 'Enter how many shares' : 'Enter the grams');
    const how = fd.how === 'buy' ? 'buy' : 'own';
    if (how === 'buy' && !(Number(fd.price) > 0)) return this.#toast.show(shares ? 'Enter the price per share' : 'Enter the price per gram');
    if (how === 'buy' && !state.accounts.some((a) => a.id === fd.payFrom)) return this.#toast.show('Pick the account you paid from');
    const acc = this.#investAccount(fd.accountId);
    const cur = acc.currency;
    const price = Number(fd.price) > 0 ? this.#fx.toMinor(Number(fd.price), cur) : 0;
    const paid  = Number(fd.paid) > 0 ? this.#fx.toMinor(Number(fd.paid), cur) : Math.round(grams * price);
    const date  = how === 'buy' ? (fd.date || DateService.todayIso()) : DateService.todayIso();
    const h = this.#holdings.create({
      accountId: acc.id, kind: fd.kind, purity: fd.purity, code: fd.code, name: shares ? fd.company : fd.name, currency: cur,
      openingQty: how === 'own' ? grams : 0, openingCost: how === 'own' ? paid : 0,
      price: price || (how === 'own' && paid ? Math.round(paid / grams) : 0), date, gainPct: Number(fd.gainPct) || 0,
    }, IdGenerator.generate('hld'));
    if (how === 'buy') this.#recordTrade(h, 'buy', { grams, price, other: fd.payFrom, date, charges: Number(fd.charges) > 0 ? this.#fx.toMinor(Number(fd.charges), cur) : 0 });
    this.#store.persist(); this.closeModal(); this.#render();
    this.#toast.show(`${h.name} added`);
    this.#sync.schedulePush?.();
  }

  submitTrade(event, id, mode) {
    event.preventDefault();
    const fd = Object.fromEntries(new FormData(event.target).entries());
    const h = this.#holdings.find(id);
    if (!h) return;
    if (!this.#store.getState().accounts.some((a) => a.id === fd.other)) return this.#toast.show('Pick an account');
    if (mode === 'dividend') {
      if (!(Number(fd.amount) > 0)) return this.#toast.show('Enter the amount received');
      this.#recordDividend(h, { amount: this.#fx.toMinor(Number(fd.amount), h.currency), other: fd.other, date: fd.date || DateService.todayIso() });
      this.#store.persist(); this.closeModal(); this.#render();
      this.#toast.show(`Dividend from ${h.name} saved`);
      return this.#sync.schedulePush?.();
    }
    const grams = Number(fd.grams), priceMajor = Number(fd.price);
    const per = HoldingService.kindOf(h).per;
    if (!(grams > 0) || !(priceMajor > 0)) return this.#toast.show(`Enter how much and the price per ${per}`);
    if (mode === 'sell' && grams > this.#holdings.stats(h).qty + 1e-9) return this.#toast.show('That’s more than you hold');
    const price = this.#fx.toMinor(priceMajor, h.currency);
    const charges = Number(fd.charges) > 0 ? this.#fx.toMinor(Number(fd.charges), h.currency) : 0;
    if (mode === 'sell' && charges >= Math.round(grams * price)) return this.#toast.show('Charges are more than the sale');
    const date = fd.date || DateService.todayIso();
    this.#recordTrade(h, mode === 'sell' ? 'sell' : 'buy', { grams, price, other: fd.other, date, charges });
    if (fd.setPrice) this.#holdings.setPrice(h, date, price);
    this.#store.persist(); this.closeModal(); this.#render();
    this.#toast.show(`${mode === 'sell' ? 'Sold' : 'Bought'} ${HoldingService.qtyText(h, grams)} of ${h.name}`);
    this.#sync.schedulePush?.();
  }

  /** A dividend: income into `other`, tagged with the holding, category Dividends. */
  #recordDividend(h, { amount, other, date }) {
    const state = this.#store.getState();
    const home = state.user.homeCurrency;
    let cat = state.categories.find((c) => c.type === 'income' && c.name.trim().toLowerCase() === 'dividends');
    if (!cat) cat = this.#categories.create({ name: 'Dividends', type: 'income', icon: 'banknote', color: '#22c55e' });
    state.transactions.push({
      id: IdGenerator.generate('tx'), accountId: other, categoryId: cat.id,
      amount, currency: h.currency, exchangeRate: (RATES[h.currency] || 1) / (RATES[home] || 1),
      refAmount: this.#fx.convert(amount, h.currency, home),
      payee: `${h.name} dividend`, note: '', date, hijriDate: this.#hijri.toHijri(date),
      paymentType: 'transfer', recordState: 'cleared', type: 'income',
      transferPairId: null, splits: null, tags: ['dividend'], holdingId: h.id,
      createdAt: new Date().toISOString(), addedBy: this.#sync.currentUser?.email || null,
    });
  }

  /**
   * A buy or sale as a transfer between `other` and the holding's account; the
   * investment-account leg carries holdingId · qty · unitPrice.
   */
  #recordTrade(h, mode, { grams, price, other, date, charges = 0 }) {
    const state = this.#store.getState();
    const minor = Math.round(grams * price) + (mode === 'sell' ? -charges : charges);
    const home = state.user.homeCurrency;
    const sell = mode === 'sell';
    const data = {
      accountId: sell ? h.accountId : other, transferToAccountId: sell ? other : h.accountId,
      payee: `${sell ? 'Sell' : 'Buy'} ${h.name}`,
      note: `${HoldingService.qtyText(h, grams)} @ ${this.#fx.formatMoney(price, h.currency)}/${HoldingService.kindOf(h).per}${charges ? ` · charges ${this.#fx.formatMoney(charges, h.currency)}` : ''}`, date,
    };
    const legs = this.#buildTransferPair(data, {
      minor, currency: h.currency, exchRate: (RATES[h.currency] || 1) / (RATES[home] || 1),
      refAmt: this.#fx.convert(minor, h.currency, home), xfer: null, state,
    });
    const leg = legs.find((t) => t.accountId === h.accountId);
    Object.assign(leg, { holdingId: h.id, qty: sell ? -grams : grams, unitPrice: price });
    state.transactions.push(...legs);
  }

  submitHoldingPrice(event, id) {
    event.preventDefault();
    const fd = Object.fromEntries(new FormData(event.target).entries());
    const h = this.#holdings.find(id);
    if (!h) return;
    if (Number(fd.price) > 0) this.#holdings.setPrice(h, fd.date || DateService.todayIso(), this.#fx.toMinor(Number(fd.price), h.currency));
    const byPrice = fd.alertBy === 'price';
    this.#holdings.setAlert(h, byPrice
      ? { targetPrice: Number(fd.targetPrice) > 0 ? this.#fx.toMinor(Number(fd.targetPrice), h.currency) : null }
      : { gainPct: Number(fd.gainPct) || null });
    this.#store.persist(); this.closeModal(); this.#render();
    const st = this.#holdings.stats(h);
    this.#toast.show(st.alertNew ? `${h.name} is up ${st.gainPct}% — your alert is reached` : 'Price saved');
    this.#sync.schedulePush?.();
  }

  // ── Reimbursements ────────────────────────────────────────────────────

  /** Reimbursement state for the current book (read-only helper). */
  get reimbursements() {
    return new ReimbursementService(this.#store.getState());
  }

  /**
   * What the Paid back form would save: the share of each ticked item, what
   * is closed, and any extra. Amounts in `pay` are in the account's currency,
   * `amount` in each expense's own currency.
   */
  #paybackPlan(form, key) {
    const state = this.#store.getState();
    const svc = new ReimbursementService(state);
    const g = svc.group(key);
    if (!g || !form) return null;
    const fd = new FormData(form);
    const picked = new Set(fd.getAll('pick'));
    const acc = state.accounts.find((a) => a.id === fd.get('accountId'));
    const payCur = acc?.currency || g.currency;
    const mode = ['spread', 'oldest', 'items'].includes(fd.get('mode')) ? fd.get('mode') : 'spread';
    const items = g.items.filter((r) => picked.has(r.tx.id)).map((r) => ({
      id: r.tx.id, tx: r.tx, owedOwn: r.outstanding,
      outstanding: r.tx.currency === payCur ? r.outstanding : this.#fx.convert(r.outstanding, r.tx.currency, payCur),
    }));
    const perItem = {};
    let perSum = 0;
    for (const i of items) {
      const v = Number(fd.get(`part_${i.id}`));
      if (v > 0) { perItem[i.id] = this.#fx.toMinor(v, payCur); perSum += perItem[i.id]; }
    }
    let total = Number(fd.get('amount')) > 0 ? this.#fx.toMinor(Number(fd.get('amount')), payCur) : 0;
    // Per item: what's typed per item is the payment, unless a larger total was entered.
    if (mode === 'items') total = Math.max(total, perSum);
    const { parts, extra } = ReimbursementService.allocate(items, total, mode, perItem);
    const byId = new Map(items.map((i) => [i.id, i]));
    const full = parts.map((p) => {
      const i = byId.get(p.txId);
      const own = p.amount >= i.outstanding ? i.owedOwn
        : i.tx.currency === payCur ? p.amount : Math.min(i.owedOwn, this.#fx.convert(p.amount, payCur, i.tx.currency));
      return { txId: p.txId, pay: p.amount, amount: own };
    });
    // What's closed: per item switches, or the batch switch for every ticked item.
    const closes = new Set();
    for (const i of items) {
      if (mode === 'items' ? fd.get(`close_${i.id}`) : fd.get('closeRest')) closes.add(i.id);
    }
    return { g, acc, payCur, mode, items, total, parts: full, extra, closes, extraAs: fd.get('extraAs') === 'income' ? 'income' : 'keep' };
  }

  /** Live preview in the Paid back form: each item's share, the extra. */
  updatePaybackPreview(form) {
    if (!form) return;
    const key = (form.getAttribute('onsubmit') || '').match(/submitPayback\(event,'([^']*)'\)/)?.[1];
    const plan = this.#paybackPlan(form, key ? key.replace(/\\'/g, "'") : '');
    if (!plan) return;
    const per = plan.mode === 'items';
    for (const el of form.querySelectorAll('[data-per-item]')) el.style.display = per ? '' : 'none';
    const batch = form.querySelector('[data-batch-close]');
    if (batch) batch.style.display = per ? 'none' : '';
    const byId = new Map(plan.parts.map((p) => [p.txId, p]));
    for (const row of form.querySelectorAll('.reimb-item')) {
      const p = byId.get(row.dataset.tx);
      const out = row.querySelector('.reimb-share');
      if (out) out.textContent = p && !per ? `Gets ${this.#fx.formatMoney(p.amount, row.dataset.currency)}` : '';
    }
    const ex = form.querySelector('[data-extra]');
    if (ex) {
      ex.style.display = plan.extra > 0 ? '' : 'none';
      const t = ex.querySelector('.reimb-extra-text');
      if (t) t.textContent = `${this.#fx.formatMoney(plan.extra, plan.payCur)} more than the ticked items need.`;
    }
  }

  /** Save a payback: one entry into the account, shared across the items. */
  submitPayback(event, key) {
    event.preventDefault();
    const plan = this.#paybackPlan(event.target, key);
    if (!plan) return this.#toast.show('Nothing left to get back here');
    if (!plan.acc) return this.#toast.show('Pick the account the money went into');
    if (!plan.items.length) return this.#toast.show('Tick the items this money is for');
    if (!(plan.total > 0)) {
      return this.#toast.show(plan.closes.size ? 'No money in? Use “Won’t be paid back”' : 'Enter the amount received');
    }
    const state = this.#store.getState();
    const home = state.user.homeCurrency;
    const date = new FormData(event.target).get('date') || DateService.todayIso();
    const g = plan.g;
    const extra = plan.extra;
    state.transactions.push({
      id: IdGenerator.generate('tx'), accountId: plan.acc.id, categoryId: null,
      amount: plan.total, currency: plan.payCur,
      exchangeRate: (RATES[plan.payCur] || 1) / (RATES[home] || 1),
      refAmount: this.#fx.convert(plan.total, plan.payCur, home),
      payee: g.payer, note: g.claim ? `Paid back · ${g.claim.name}` : 'Paid back',
      date, hijriDate: this.#hijri.toHijri(date),
      paymentType: 'transfer', recordState: 'cleared', type: 'income',
      transferPairId: null, splits: null, tags: [ReimbursementService.TAG],
      reimbBy: g.payer, claimId: g.claim?.id || null,
      reimbAlloc: plan.parts.map((p) => ({ txId: p.txId, amount: p.amount, pay: p.pay })),
      reimbExtra: extra, reimbExtraAs: extra > 0 ? plan.extraAs : null,
      createdAt: new Date().toISOString(), addedBy: this.#sync.currentUser?.email || null,
    });
    let closed = 0;
    for (const id of plan.closes) {
      const t = state.transactions.find((x) => x.id === id);
      if (t) { t.reimbClosed = true; closed++; }
    }
    this.#store.persist(); this.closeModal(); this.#render();
    const tail = extra > 0 ? (plan.extraAs === 'income' ? ` · ${this.#fx.formatMoney(extra, plan.payCur)} extra counted as income` : ` · ${this.#fx.formatMoney(extra, plan.payCur)} kept as credit`) : '';
    this.#toast.show(`${this.#fx.formatMoney(plan.total, plan.payCur)} paid back by ${g.payer}${closed ? ` · ${closed} closed` : ''}${tail}`);
    this.#sync.schedulePush?.();
  }

  /** Close the ticked items: nothing more will come. They stay your spending. */
  waiveReimbursement(key, form) {
    const g = new ReimbursementService(this.#store.getState()).group(key);
    if (!g) return;
    const picked = new Set(form ? new FormData(form).getAll('pick') : g.items.map((r) => r.tx.id));
    const items = g.items.filter((r) => picked.has(r.tx.id));
    if (!items.length) return this.#toast.show('Tick the items that won’t be paid back');
    const left = items.reduce((n, r) => n + r.outstanding, 0);
    if (!window.confirm(`Close ${items.length} item${items.length === 1 ? '' : 's'}? ${this.#fx.formatMoney(left, g.currency)} stays as your own spending.`)) return;
    for (const r of items) r.tx.reimbClosed = true;
    this.#store.persist(); this.closeModal(); this.#render();
    this.#toast.show(`Closed · ${this.#fx.formatMoney(left, g.currency)} counted as your spending`);
    this.#sync.schedulePush?.();
  }

  /** Apply credit kept from an earlier over-payment to the ticked items (spread evenly). */
  useReimbCredit(key, form) {
    const state = this.#store.getState();
    const svc = new ReimbursementService(state);
    const g = svc.group(key);
    if (!g) return;
    const picked = new Set(form ? new FormData(form).getAll('pick') : g.items.map((r) => r.tx.id));
    let items = g.items.filter((r) => picked.has(r.tx.id));
    if (!items.length) return this.#toast.show('Tick the items to use the credit on');
    const today = DateService.todayIso();
    let used = 0;
    for (const c of svc.creditEntries(g.payer)) {
      const payCur = c.tx.currency;
      const list = items.map((r) => ({
        id: r.tx.id, tx: r.tx, owedOwn: r.outstanding,
        outstanding: r.tx.currency === payCur ? r.outstanding : this.#fx.convert(r.outstanding, r.tx.currency, payCur),
      })).filter((i) => i.outstanding > 0);
      if (!list.length) break;
      const { parts } = ReimbursementService.allocate(list, c.left, 'spread');
      const byId = new Map(list.map((i) => [i.id, i]));
      c.tx.reimbAlloc = c.tx.reimbAlloc || [];
      for (const p of parts) {
        const i = byId.get(p.txId);
        const own = p.amount >= i.outstanding ? i.owedOwn
          : i.tx.currency === payCur ? p.amount : Math.min(i.owedOwn, this.#fx.convert(p.amount, payCur, i.tx.currency));
        c.tx.reimbAlloc.push({ txId: p.txId, amount: own, pay: p.amount, date: today });
        used += p.amount;
        const r = items.find((x) => x.tx.id === p.txId);
        r.outstanding -= own;
      }
      items = items.filter((r) => r.outstanding > 0);
    }
    if (!used) return this.#toast.show('No credit to use');
    this.#store.persist(); this.closeModal(); this.#render();
    this.#toast.show(`Used ${this.#fx.formatMoney(used, g.currency)} credit from ${g.payer}`);
    this.#sync.schedulePush?.();
  }

  /**
   * The reimbursement fields from the transaction form, or a toast message.
   * @returns {{fields: object}|{error: string}}
   */
  #reimbFields(fd, { amount, currency, existing }) {
    const state = this.#store.getState();
    const on = !!fd.get('reimbOn');
    const paid = existing ? new ReimbursementService(state).paidBack(existing.id) : 0;
    if (!on) {
      if (paid > 0) return { error: 'Money was already paid back for this — remove that payment first' };
      return { fields: existing?.reimbBy ? { reimbBy: null, reimbExpected: null, reimbClosed: null, claimId: null } : {} };
    }
    const payer = String(fd.get('reimbBy') || '').trim().slice(0, 60);
    if (!payer) return { error: 'Who will pay you back?' };
    let expected = Number(fd.get('reimbExpected')) > 0 ? this.#fx.toMinor(Number(fd.get('reimbExpected')), currency) : amount;
    if (expected > amount) return { error: 'You can’t get back more than you spent' };
    if (paid > expected) return { error: `${this.#fx.formatMoney(paid, currency)} was already paid back — expect at least that` };
    // A claim, found by name or made new.
    let claimId = null;
    const claimName = String(fd.get('claimName') || '').trim().slice(0, 60);
    if (claimName) {
      if (!Array.isArray(state.claims)) state.claims = [];
      const ref = String(fd.get('claimRef') || '').trim().slice(0, 40);
      let c = state.claims.find((x) => x.name.trim().toLowerCase() === claimName.toLowerCase());
      if (!c) { c = { id: IdGenerator.generate('claim'), name: claimName, ref }; state.claims.push(c); }
      else if (ref && ref !== c.ref) c.ref = ref;
      claimId = c.id;
    }
    return { fields: {
      reimbBy: payer,
      reimbExpected: expected === amount ? null : expected,
      // Only a closed item shows this box; unticking it expects the rest again.
      reimbClosed: fd.get('reimbClosed') ? true : null,
      claimId,
    } };
  }

  ackInvestmentAlert(id) {
    const h = this.#holdings.find(id);
    if (!h) return;
    this.#holdings.ackAlert(h);
    this.#store.persist(); this.#render();
    this.#sync.schedulePush?.();
  }

  /** Remove a holding: archived if it has buys or sales (their entries stay), else deleted. */
  removeInvestment(id) {
    const state = this.#store.getState();
    const h = this.#holdings.find(id);
    if (!h) return;
    const used = this.#holdings.entries(id).length > 0;
    if (!confirm(used ? `Hide ${h.name}? Its buy and sell entries stay in your accounts.` : `Remove ${h.name}?`)) return;
    if (used) h.archived = true;
    else state.holdings = (state.holdings || []).filter((x) => x.id !== id);
    this.#store.persist(); this.closeModal(); this.#render();
    this.#sync.schedulePush?.();
  }

  /** Accounts → Reorder / Done. */
  toggleAccountReorder() {
    this.#views.get('accounts')?.toggleReorder?.();
    this.#render();
  }

  /**
   * Nudge an account one place up (-1) or down (+1) within its group.
   * @param {string} id
   * @param {-1|1} dir
   */
  moveAccount(id, dir) {
    const view = this.#views.get('accounts');
    const a = this.#store.getState().accounts.find((x) => x.id === id);
    if (!view || !a) return;
    const valid = new Set((this.#store.getState().accountGroups || []).map((g) => g.id));
    const ids = view.sectionIds(a.groupId && valid.has(a.groupId) ? a.groupId : '__none__');
    const i = ids.indexOf(id), j = i + Number(dir);
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    this.#saveAccountOrder(ids);
  }

  /** A drag ended on a sortable list. */
  #onSortDrop(key, ids) {
    if (this.#router.current !== 'accounts' || !this.#views.get('accounts')?.reordering) return;
    this.#saveAccountOrder(ids);
  }

  #saveAccountOrder(ids) {
    if (this.#accounts.reorder(ids)) this.#sync.schedulePush?.();
    this.#render();
  }

  /** Icon, low-balance floor and "Leave out of totals" from the account form. */
  #accountExtras(data) {
    const floor = Number(data.lowBalance);
    return {
      icon: data.icon || AccountService.typeIcon(data.type),
      lowBalance: data.type !== 'card' && floor > 0 ? this.#fx.toMinor(floor, data.currency) : null,
      excludeFromTotals: !!data.excludeFromTotals,
    };
  }

  /**
   * Account form: the type changed. Show card fields for a card (and hide the
   * low-balance floor), and move the icon to the new type's — unless the icon
   * was picked by hand (anything other than the old type's default).
   */
  onAccountTypeChange(select) {
    const form = select.form;
    const isCard = select.value === 'card';
    const show = (id, on) => { const el = form?.querySelector('#' + id); if (el) el.style.display = on ? '' : 'none'; };
    show('accCardFields', isCard);
    show('accLowField', !isCard);
    const prev = select.dataset.prevType || select.querySelector('option[selected]')?.value || '';
    const picked = form?.querySelector('input[name="icon"]:checked');
    if (!picked || picked.value === AccountService.typeIcon(prev)) {
      const next = form?.querySelector(`input[name="icon"][value="${AccountService.typeIcon(select.value)}"]`);
      if (next) next.checked = true;
    }
    select.dataset.prevType = select.value;
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

  /** Settings → General / Account / Data / Help, without a re-render. */
  setSettingsTab(key) {
    if (this.#settingsModal) this.#settingsModal.tab = key;
    for (const el of document.querySelectorAll('[data-settings-tab]')) el.style.display = el.dataset.settingsTab === key ? '' : 'none';
    for (const b of document.querySelectorAll('[data-settings-tab-btn]')) {
      const on = b.dataset.settingsTabBtn === key;
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('bg-white', on); b.classList.toggle('dark:bg-zinc-900', on); b.classList.toggle('shadow-sm', on); b.classList.toggle('text-zinc-500', !on);
    }
  }

  /** Feedback window: switch between "Feedback" and "Feature idea" without losing the text. */
  setFeedbackKind(kind) {
    const form = document.querySelector('form.feedback-form');
    if (!form) return;
    form.querySelector('input[name="kind"]').value = kind;
    for (const b of form.querySelectorAll('[data-feedback-kind]')) {
      const on = b.dataset.feedbackKind === kind;
      b.classList.toggle('btn-primary', on); b.classList.toggle('btn-outline', !on);
    }
    const area = form.querySelector('textarea[name="message"]');
    if (area) area.placeholder = FeedbackModal.placeholder(kind);
  }

  async sendFeedback(event) {
    event.preventDefault();
    const fd = new FormData(event.target);
    const kind = String(fd.get('kind') || 'feedback');
    const message = String(fd.get('message') || '').trim();
    if (!message) return this.#toast.show('Write a message first');
    const btn = event.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await this.#sync.sendFeedback(kind, message, this.#router.current || '');
      this.closeModal();
      this.#toast.show(kind === 'feature' ? 'Thanks — your idea was sent' : 'Thanks — your feedback was sent');
    } catch (err) {
      if (btn) btn.disabled = false;
      this.#toast.show(`Not sent: ${err.message || err}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Page help (the ? by a page title)
  // ──────────────────────────────────────────────────────────────────────────

  /** @param {string} page  a HelpGuide key: calendar, budgets, debts, categories */
  openHelp(page) {
    HelpGuide.markSeen(page);
    this.#render();                       // drops the one-time hint
    this.openModal('help', { page });
  }

  dismissHelpHint(page) {
    HelpGuide.markSeen(page);
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
    // Same name in the same place: offer to merge instead of making a twin.
    const twin = this.#categories.sameName(data.name, { parentId, type: data.type, exceptId: id || '' });
    if (twin) {
      if (!id) return this.#toast.show(`${twin.name} already exists here`);
      if (!this.#categories.mergeTargets(id).some((c) => c.id === twin.id)) {
        return this.#toast.show(`${twin.name} already exists here — pick another name`);
      }
      if (!confirm(`${twin.name} already exists. Merge into it?`)) return;
      return this.#runCategoryMerge([id], twin.id);
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
    // Still used anywhere (entries, split legs, regulars, budgets, habits)?
    // Then its things need a new home first: the same flow as a merge.
    if (this.#categories.usageEverywhere(id) > 0) return this.openCategoryMerge(id, 'delete');
    if (!confirm('Delete this category?')) return;
    this.#categories.delete(id);  // also re-parents any orphaned children to root
    this.closeModal(); this.#render();
    this.#sync.schedulePush?.();
  }

  /**
   * Open the merge picker (Edit category → Merge, or Delete when used).
   * @param {string|string[]} ids
   * @param {'merge'|'delete'} [mode='merge']
   */
  openCategoryMerge(ids, mode = 'merge') {
    const list = Application.#idList(ids);
    this.openModal('categoryMerge', { ids: list, mode });
    this.previewCategoryMerge(list);
  }

  /** Categories → Merge: turn ticking on or off. */
  toggleCategoryPicking() {
    this.#views.get('categories')?.togglePicking?.();
    this.#render();
  }

  toggleCategoryPick(id) {
    this.#views.get('categories')?.togglePick?.(id);
    this.#render();
  }

  /** The bar's "Merge into…": open the picker for everything ticked. */
  mergePickedCategories() {
    const ids = this.#views.get('categories')?.pickedIds ?? [];
    if (!ids.length) return this.#toast.show('Tick at least one category');
    this.openCategoryMerge(ids);
  }

  /**
   * The merge window changed: show the picked card's panel and refresh the
   * "Moves 42 entries to Food" line.
   */
  previewCategoryMerge(ids) {
    const form = document.querySelector('form.category-merge-form');
    if (!form) return;
    const pick = CategoryMergeModal.readForm(form);
    for (const panel of form.querySelectorAll('[data-merge-panel]')) {
      const on = panel.dataset.mergePanel === pick.choice;
      if (on && panel.style.display === 'none' && pick.choice === CategoryMergeModal.NEW) setTimeout(() => panel.querySelector('input')?.focus(), 0);
      panel.style.display = on ? '' : 'none';
    }
    const el = document.getElementById('categoryMergePreview');
    if (el) el.innerHTML = this.#categoryMergeModal.previewText(Application.#idList(ids), pick);
  }

  /** Search box in "Move into another": hide rows that don't match. */
  filterCategoryMerge(q) {
    const needle = String(q || '').trim().toLowerCase();
    for (const row of document.querySelectorAll('[data-merge-panel="other"] .merge-row')) {
      row.style.display = !needle || row.dataset.name.includes(needle) ? '' : 'none';
    }
  }

  mergeCategory(event, ids) {
    event.preventDefault();
    const list = Application.#idList(ids);
    const { choice, intoId, newName } = CategoryMergeModal.readForm(event.target);
    if (choice === CategoryMergeModal.NEW) return this.#runCategoryMerge(list, null, newName);
    if (!intoId) return this.#toast.show(choice === CategoryMergeModal.KEEP ? 'Tap the one to keep' : 'Pick a category to move it to');
    // "Keep X": the other ticked ones go into X.
    this.#runCategoryMerge(choice === CategoryMergeModal.KEEP ? list.filter((id) => id !== intoId) : list, intoId);
  }

  /** '<id>,<id>' from an onclick, or an array → array of ids */
  static #idList(ids) {
    return (Array.isArray(ids) ? ids : String(ids || '').split(',')).map(String).filter(Boolean);
  }

  /**
   * @param {string[]} ids
   * @param {string|null} intoId  null → a new category named `newName`
   * @param {string} [newName]
   */
  #runCategoryMerge(ids, intoId, newName = '') {
    const names = ids.map((id) => this.#categories.find(id)?.name).filter(Boolean);
    const res   = intoId ? this.#categories.mergeManyInto(ids, intoId) : this.#categories.mergeIntoNew(ids, newName);
    if (!res.ok) return this.#toast.show(res.reason);
    const into  = intoId ? this.#categories.fullName(intoId) : `${res.summary.created} (new)`;
    this.#views.get('categories')?.clearPicking?.();
    this.closeModal(); this.#render();
    this.#sync.schedulePush?.();
    const what = names.length === 1 ? names[0] : `${names.length} categories`;
    const n    = res.summary.entries;
    this.#toast.show(`${what} merged into ${into}${n ? ` · ${n} ${n === 1 ? 'entry' : 'entries'} moved` : ''}`, {
      action: { label: 'Undo', run: () => this.#undoCategoryMerge(res.undo, what) },
    });
  }

  #undoCategoryMerge(undo, what) {
    this.#categories.undoMerge(undo);
    this.#render();
    this.#sync.schedulePush?.();
    this.#toast.show(`Undone · ${what} ${/categories$/.test(what) ? 'are' : 'is'} back`);
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
    const period = BudgetPeriod.KINDS.includes(data.period) ? data.period : 'gregorian';
    if (period === 'range' && !BudgetPeriod.validRange(data.startDate, data.endDate)) {
      return this.#toast.show('Pick a start date and an end date on or after it');
    }
    // Delegate to BudgetService (it normalizes the period fields). categoryId
    // is kept in sync with the first selection for backward compatibility.
    const payload = {
      categoryIds, categoryId: categoryIds[0], amount: minor, currency: data.currency,
      alerts: !!data.alerts,
      ...BudgetService.periodFields({
        period, startDate: data.startDate, endDate: data.endDate, rollover: !!data.rollover,
        rolloverOverspend: !!data.rolloverOverspend,
        rolloverCap: data.rolloverCap ? this.#fx.toMinor(data.rolloverCap, data.currency) : null,
      }),
    };
    if (id) this.#budgets.update(id, payload);
    else    this.#budgets.create(payload);
    this.closeModal(); this.#render();
    this.#toast.show(id ? 'Budget updated' : 'Budget added');
    this.#sync.schedulePush?.();
  }

  /**
   * Fill the budget form's limit from what was usually spent (BudgetAdvisor),
   * for the categories and period picked so far.
   * @param {HTMLFormElement} form
   */
  suggestBudgetLimit(form) {
    const fd = new FormData(form);
    const categoryIds = fd.getAll('categoryIds').filter(Boolean);
    const note = form.querySelector('#budgetSuggest');
    const say = (text) => { if (note) { note.textContent = text; note.classList.remove('hidden'); } };
    if (!categoryIds.length) return say('Pick categories first.');
    const currency = fd.get('currency') || this.#store.getState().user.homeCurrency;
    const draft = { categoryIds, currency, period: fd.get('period'), startDate: fd.get('startDate'), endDate: fd.get('endDate') };
    const tip = new BudgetAdvisor(this.#budgets).suggest(draft);
    if (!tip) return say('No spending in these categories yet to go on.');
    form.querySelector('[name="amount"]').value = this.#fx.fromMinor(tip.amount, currency);
    say(`Suggested from ${tip.basis}. Change it if you like.`);
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
      const inst = this.#instalmentFields(data, debt.currency);
      if (inst.error) return this.#toast.show(inst.error);
      debt.counterparty = data.counterparty || debt.counterparty;
      debt.dueDate      = data.dueDate || null;
      debt.note         = data.note || '';
      Object.assign(debt, inst.fields);

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
    const inst = this.#instalmentFields(data, currency);
    if (inst.error) return this.#toast.show(inst.error);

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
      ...inst.fields,
    });

    this.#store.persist();
    this.closeModal(); this.#render();
    this.#toast.show(isBorrowed ? 'Debt recorded · account credited' : 'Loan recorded · account debited');
    this.#sync.schedulePush?.();
  }

  /**
   * Pay a card's bill: a transfer from your usual (non-card) account into the
   * card, filled in with what's left of the bill — or, with no statement day
   * set, everything owed. The amount can be changed before saving.
   * @param {string} accountId  the card
   */
  payCardBill(accountId) {
    const state = this.#store.getState();
    const card  = state.accounts.find((a) => a.id === accountId);
    if (!card) return this.#toast.show('Card not found');
    const cycle  = this.#owed.cardCycle(card, DateService.todayIso());
    const amount = cycle.billLeft > 0 ? cycle.billLeft : cycle.owed;
    const usual  = state.accounts.find((a) => a.id === this.#accounts.defaultId());
    const from   = usual && !CardCycle.isCard(usual) && !usual.archived ? usual
      : state.accounts.find((a) => !a.archived && !CardCycle.isCard(a) && a.id !== card.id);
    if (!from) return this.#toast.show('Add a bank or cash account to pay the card from');
    this.openModal('transaction', { preset: {
      type: 'transfer', accountId: from.id, transferToAccountId: card.id,
      // A new entry's preset amount is in MAJOR units (see TransactionModal).
      amount: this.#fx.fromMinor(amount, card.currency), currency: card.currency, payee: `${card.name} bill`, note: '',
      date: DateService.todayIso(), paymentType: 'transfer',
    } });
  }

  /** Pay a loan's instalment (or what's behind): the payment form, filled in. */
  payLoanInstalment(debtId) {
    const debt = (this.#store.getState().debts || []).find((d) => d.id === debtId);
    if (!debt) return;
    const i = LoanInstalments.of(debt, this.#owed.paidOn(debt), DateService.todayIso());
    this.openModal('debtPayment', { id: debtId, amount: i?.dueNow || undefined });
  }

  /**
   * "Paid back in monthly instalments" from the debt form.
   * @returns {{fields:object}|{error:string}}  fields are null when switched off
   */
  #instalmentFields(data, currency) {
    if (!data.instalments) return { fields: { instalmentAmount: null, instalmentDay: null, instalmentCount: null } };
    const amount = this.#fx.toMinor(data.instalmentAmount || 0, currency);
    const day    = Math.round(Number(data.instalmentDay));
    const count  = Math.round(Number(data.instalmentCount));
    if (!(amount > 0)) return { error: 'Enter the amount of each instalment' };
    if (!(day >= 1 && day <= 31)) return { error: 'Pick the day instalments are due' };
    if (!(count >= 1)) return { error: 'Enter how many instalments' };
    return { fields: { instalmentAmount: amount, instalmentDay: day, instalmentCount: count } };
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
    };

    if (!payload.name) return this.#toast.show('Name is required');

    const existing = id ? state.regularItems.find((i) => i.id === id) : null;
    Object.assign(payload, this.#deliveryFields(fd, existing, payload));

    if (existing) {
      Object.assign(existing, payload);
    } else {
      state.regularItems.push({ id: IdGenerator.generate('ri'), ...payload });
    }

    this.#store.persist();
    this.closeModal();
    this.#render();
    this.#toast.show(id ? 'Item updated' : 'Item added');
    this.#sync.schedulePush?.();
  }

  /**
   * The pay-later part of the item form: the usual pattern, who is paid, and
   * — when the price changed — the price history, so days already delivered
   * keep the price they had (see DeliveryPlan).
   * @param {FormData} fd
   * @param {object|null} existing  the item before this save
   * @param {object} payload        name/price/currency already read
   */
  #deliveryFields(fd, existing, payload) {
    const later = fd.get('pay') === 'later';
    if (!later) return { payLater: false, frequency: existing?.frequency || 'monthly' };
    const today = DateService.toIso(new Date());
    const days = fd.getAll('usualDays').map(Number).filter((d) => d >= 0 && d <= 6);
    const trackFrom = DeliveryPlan.isIso(fd.get('trackFrom')) ? fd.get('trackFrom') : (existing?.trackFrom || today);
    const out = {
      payLater:  true,
      frequency: 'daily',
      usualQty:  Math.max(0, parseFloat(fd.get('usualQty')) || 0),
      usualDays: days.length ? days : [...DeliveryPlan.ALL_DAYS],
      unit:      String(fd.get('unit') || '').trim().slice(0, 12),
      vendor:    String(fd.get('vendor') || '').trim().slice(0, 40),
      trackFrom,
      checkinTo:     NotifyField.read(fd, 'checkin').to,
      checkinEmail:  NotifyField.read(fd, 'checkin').email,
      checkinMinute: RegularItemModal.minute(fd.get('checkinTime')),
      checkinTz:     String(fd.get('checkinTz') || 'Asia/Kolkata'),
    };
    if (existing?.payLater && existing.defaultAmount !== payload.defaultAmount) {
      const from = DeliveryPlan.isIso(fd.get('priceFrom')) ? fd.get('priceFrom') : today;
      out.prices = DeliveryPlan.withPrice(existing, payload.defaultAmount, from);
    } else if (!existing?.payLater) {
      out.prices = [];
    }
    return out;
  }

  deleteRegularItem(id) {
    const s      = this.#store.getState();
    // Count across both books — an item on a shared account has all of its
    // entries in the owner's, so a local-only count read as "0 logged".
    const name = (s.regularItems || []).find((i) => i.id === id)?.payLater ? 'delivery' : 'shortcut';
    const logged = this.#regularLogs.all().filter((t) => t.regularItemId === id).length;

    // Deleting the template used to destroy every transaction ever logged from
    // it, while the prompt only said "Delete this regular item?" — real spending
    // silently disappeared from the ledger and balances moved. The template is
    // a shortcut for creating transactions; removing it must not unmake them.
    const msg = logged
      ? `Delete this ${name}?\n\nThe ${logged} entr${logged === 1 ? 'y' : 'ies'} `
        + 'already logged from it stay in your ledger.'
      : `Delete this ${name}?`;
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
    const done = await this.#recordRegularEntry(item, {
      date, qty, unitMinor, amountMinor: Math.round(unitMinor * qty), ref: AccountRef.fromRecord(item),
    });
    if (done) this.openModal('dayLogs', { date });
  }


  /**
   * Records one expense entry for a regular item — a day's purchase, or a
   * payment to the vendor. An account a family member shared sends it to the
   * OWNER's book for approval (a local row would be orphaned there), with the
   * rate relative to the owner's home currency since that's the book it's
   * reported in (same rule as submitTx).
   * @param {object} item
   * @param {{date: string, qty: number, unitMinor: number, amountMinor: number, ref: AccountRef,
   *          description?: string, payee?: string, note?: string, extra?: object}} e
   * @returns {Promise<string|null>} the entry's id, or null when it couldn't be recorded (a toast says why)
   */
  async #recordRegularEntry(item, e) {
    const s = this.#store.getState();
    const currency = item.currency || s.user.homeCurrency;
    const base = {
      id:            IdGenerator.generate('tx'),
      regularItemId: item.id,
      date:          e.date,
      hijriDate:     this.#hijri.toHijri(e.date),
      amount:        e.amountMinor,
      unitAmount:    e.unitMinor,
      qty:           e.qty,
      currency,
      description:   e.description || item.name,
      payee:         e.payee || item.name,
      note:          e.note || '',
      type:          'expense',
      categoryId:    item.categoryId || null,
      splits:        null,
      paymentType:   'cash',
      recurring:     null,
      recordState:   'cleared',
      createdAt:     new Date().toISOString(),
      ...(e.extra || {}),
    };

    if (e.ref.isShared) {
      const share = this.#sync.shareByOwner?.(e.ref.ownerId);
      if (!share?._ownerId) { this.#toast.show('Shared account not found'); return null; }
      const ownerHome = share.homeCurrency || s.user.homeCurrency;
      const tx = {
        ...base,
        accountId:    e.ref.accountId,
        exchangeRate: (RATES[currency] || 1) / (RATES[ownerHome] || 1),
        refAmount:    this.#fx.convert(e.amountMinor, currency, ownerHome),
        addedBy:      this.#sync.currentUser?.email || null,
      };
      try {
        await this.#sync.submitContribution(share._ownerId, tx);
        this.#toast.show('Entry submitted to the shared account');
        this.#sync.scheduleSharesRefresh?.(3000);
        this.#sync.scheduleSharesRefresh?.(8000);
      } catch (err) {
        this.#toast.show('Failed to submit: ' + (err.message || err));
        return null;
      }
      return tx.id;
    }

    const tx = {
      ...base,
      accountId:    e.ref.accountId || item.accountId || s.accounts[0]?.id,
      exchangeRate: (RATES[currency] || 1) / (RATES[s.user.homeCurrency] || 1),
      refAmount:    this.#fx.convert(e.amountMinor, currency, s.user.homeCurrency),
    };
    s.transactions.push(tx);
    this.#store.flush();
    this.#sync.schedulePush?.();
    return tx.id;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Pay-later items: the usual pattern, exceptions, pauses, paying the vendor
  // ──────────────────────────────────────────────────────────────────────────

  /** An item of this book (never one seen in someone else's space). */
  #ownItem(itemId) {
    return (this.#store.getState().regularItems || []).find((i) => i.id === itemId) || null;
  }

  /**
   * The pay-later items on screen: your own, or — in a family member's space —
   * theirs, which you may change when you can add to the item's account.
   * @returns {{ownerId: string|null, items: object[], canChange: (item: object) => boolean}}
   */
  deliveryContext() {
    const space = this.#spaces?.active?.();
    if (!space || space.isHome) {
      return { ownerId: null, items: (this.#store.getState().regularItems || []).filter((i) => i.payLater === true), canChange: () => true };
    }
    return {
      ownerId: space.ownerId,
      items: (space.regularItems || []).filter((i) => i.payLater === true),
      canChange: (item) => !!item.accountId && space.canAdd(item.accountId),
    };
  }

  /** A day/pause change to someone else's item goes through the server. */
  async #sharedDelivery(itemId, change, reopen) {
    const ctx = this.deliveryContext();
    const item = ctx.items.find((i) => i.id === itemId);
    if (!ctx.ownerId || !item) return false;
    if (!ctx.canChange(item)) { this.#toast.show('You can only view this item'); return false; }
    try {
      await this.#sync.deliveryChange(ctx.ownerId, itemId, change);
    } catch (err) {
      this.#toast.show(err.message || 'Not saved');
      return false;
    }
    this.#render();
    if (reopen) this.openModal(reopen.name, reopen.opts);
    return true;
  }

  /** Saves a change to an item's delivery data and redraws. */
  #saveDelivery(item, change, reopen) {
    Object.assign(item, change);
    this.#store.persist();
    this.#sync.schedulePush?.();
    this.#render();
    if (reopen) this.openModal(reopen.name, reopen.opts);
  }

  /**
   * How many came on a day (0 = none). The change is confirmed with a
   * message saying what changed (with Undo), a flash on the row and a small
   * vibration. A day already paid for can still be changed after a
   * confirmation: the difference goes on the next bill as an adjustment.
   * @param {{undo?: boolean}} [opts]  undo: putting a change back (no new Undo)
   */
  async setDelivery(itemId, date, qty, opts = {}) {
    const ctx = this.deliveryContext();
    const item = ctx.items.find((i) => i.id === itemId);
    if (!item?.payLater || !DeliveryPlan.isIso(date)) return;
    const plan = new DeliveryPlan(item);
    const before = plan.qtyOn(date);
    const marks = DeliveryPlan.withMark(item, date, qty);
    const after = new DeliveryPlan({ ...item, marks }).qtyOn(date);
    const undo = { itemId, date, mark: plan.changedOn(date) ? item.marks[date] : null, adjustments: item.adjustments ?? [] };
    // stay: changed from the week strip, so no day window opens
    const reopen = opts.stay ? null : { name: 'dayLogs', opts: { date, flash: itemId } };

    if (ctx.ownerId) {
      const change = date in marks ? { set: { date, qty: marks[date] } } : { clear: date };
      if (!(await this.#sharedDelivery(itemId, change, reopen))) return;
      if (after === 0 && new DeliveryPlan(item).confirmedOn(date)) await this.#sharedDelivery(itemId, { unconfirm: date }, reopen);
    } else {
      const own = this.#ownItem(itemId);
      const change = { marks };
      // none came: it can't also be "delivered"
      if (after === 0 && new DeliveryPlan(own).confirmedOn(date)) change.confirmed = DeliveryPlan.withConfirmed(own, date, false);
      if (this.#vendorDues.isPaid(own, date) && !opts.undo) {
        const diff = Math.round((after - before) * plan.priceOn(date));
        const money = this.#fx.formatMoney(Math.abs(diff), own.currency || this.#store.getState().user.homeCurrency);
        if (diff !== 0 && !confirm(`${DeliveryPlan.shortDate(date)} is already paid.\n\nChange ${own.name} to ${after ? plan.qtyLabel(after) : 'none'} anyway? `
          + `${diff < 0 ? `${money} will be taken off` : `${money} will be added to`} the next bill.`)) return;
        change.adjustments = DeliveryPlan.withAdjustment(own, date, before, after, plan.priceOn(date));
      } else if (opts.undo) {
        change.adjustments = opts.adjustments ?? own.adjustments;
      }
      this.#saveDelivery(own, change, reopen);
    }
    if (opts.undo) return void this.#toast.show(`Undone · ${item.name} ${DeliveryPlan.shortDate(date)}: ${after ? plan.qtyLabel(after) : 'none'}`);
    try { navigator.vibrate?.(12); } catch (_) { /* not supported */ }
    this.#toast.show(this.#deliveryNote(item, date, after), { action: { label: 'Undo', run: () => this.#undoDelivery(undo) } });
  }

  /** "Milk · 12 Nov: 2 L (usual 1 L)", "… back to usual (1 L)", "+₹64 on the next bill". */
  #deliveryNote(item, date, qty) {
    const fresh = this.deliveryContext().items.find((i) => i.id === item.id) || item;
    const plan = new DeliveryPlan(fresh);
    const usual = plan.pausedOn(date) ? 0 : plan.usualOn(date);
    const what = qty === usual ? `back to usual (${usual ? plan.qtyLabel(usual) : 'none'})`
      : `${qty ? plan.qtyLabel(qty) : 'none'} (usual ${usual ? plan.qtyLabel(usual) : 'none'})`;
    const adj = (fresh.adjustments || []).find((a) => a.date === date && !a.settledIn);
    const amount = adj ? Math.round((adj.now - adj.was) * adj.unit) : 0;
    const bill = amount ? ` · ${amount > 0 ? '+' : '−'}${this.#fx.formatMoney(Math.abs(amount), fresh.currency || 'INR')} on the next bill` : '';
    return `${item.name} · ${DeliveryPlan.shortDate(date)}: ${what}${bill}`;
  }

  /** Puts a day back exactly as it was (its mark, or the usual, and any adjustment). */
  #undoDelivery(u) {
    const item = this.deliveryContext().items.find((i) => i.id === u.itemId);
    if (!item) return;
    const plan = new DeliveryPlan({ ...item, marks: { ...(item.marks || {}), ...(u.mark === null ? {} : { [u.date]: u.mark }) } });
    const qty = u.mark === null ? new DeliveryPlan({ ...item, marks: DeliveryPlan.withoutMark(item, u.date) }).qtyOn(u.date) : plan.qtyOn(u.date);
    this.setDelivery(u.itemId, u.date, qty, { undo: true, adjustments: u.adjustments });
  }

  /**
   * Records a day as delivered (on) or takes that back (off). A confirmed day
   * shows red on the calendar until the vendor is paid, then green.
   * @param {{reopen?: {name: string, opts: object}|null, quiet?: boolean}} [opts]
   */
  async confirmDelivery(itemId, date, on, opts = {}) {
    const ctx = this.deliveryContext();
    const item = ctx.items.find((i) => i.id === itemId);
    if (!item?.payLater || !DeliveryPlan.isIso(date)) return;
    if (date > DateService.todayIso()) return void this.#toast.show('You can confirm a delivery on the day or after');
    const want = !!on;
    const reopen = opts.reopen === undefined ? null : opts.reopen;
    if (ctx.ownerId) {
      if (!(await this.#sharedDelivery(itemId, want ? { confirm: date } : { unconfirm: date }, reopen))) return;
    } else {
      const own = this.#ownItem(itemId);
      if (!own) return;
      this.#saveDelivery(own, { confirmed: DeliveryPlan.withConfirmed(own, date, want) }, reopen);
    }
    if (opts.quiet) return;
    try { navigator.vibrate?.(10); } catch (_) { /* not supported */ }
    this.#toast.show(`${item.name} · ${DeliveryPlan.shortDate(date)}: ${want ? 'delivered' : 'not confirmed'}`,
      { action: { label: 'Undo', run: () => this.confirmDelivery(itemId, date, !want, { reopen, quiet: true }) } });
  }

  /** Delivered / not confirmed, from the Deliveries tab's week strip. */
  /**
   * A tap on a day in the week strip moves it along:
   * not confirmed → delivered → not delivered → back to the usual (not confirmed).
   * A paid day opens the day window instead, where a change becomes an adjustment.
   */
  toggleDeliveryDay(itemId, date) {
    const item = this.deliveryContext().items.find((i) => i.id === itemId);
    if (!item) return;
    const status = this.#vendorDues.statusOn(item, date);
    if (status === 'unconfirmed') return void this.confirmDelivery(itemId, date, true);
    if (status === 'owed') return void this.notDelivered(itemId, date);
    if (status === 'skipped') return void this.resetDelivery(itemId, date, true);
    this.openModal('dayLogs', { date });
  }

  /** Nothing came that day: 0 for the day, so it isn't counted (and isn't "delivered"). */
  notDelivered(itemId, date, reopen = false) {
    return this.setDelivery(itemId, date, 0, reopen ? {} : { stay: true });
  }

  stepDelivery(itemId, date, delta) {
    const item = this.deliveryContext().items.find((i) => i.id === itemId);
    if (!item) return;
    const now = new DeliveryPlan(item).qtyOn(date);
    this.setDelivery(itemId, date, Math.max(0, now + Number(delta)));
  }

  resetDelivery(itemId, date, stay = false) {
    const item = this.deliveryContext().items.find((i) => i.id === itemId);
    if (!item) return;
    const usual = new DeliveryPlan({ ...item, marks: DeliveryPlan.withoutMark(item, date) }).qtyOn(date);
    this.setDelivery(itemId, date, usual, stay ? { stay: true } : {});
  }

  submitPause(e, itemId) {
    e.preventDefault();
    const item = this.#ownItem(itemId);
    const fd = new FormData(e.target);
    if (!item) return;
    item.pauses = DeliveryPlan.withPause(item, fd.get('from'), fd.get('to'));
    this.#saveDelivery(item, {}, { name: 'pauseDeliveries', opts: { itemId } });
    this.#toast.show(`${item.name} paused`);
  }

  liftPause(itemId, from) {
    const item = this.#ownItem(itemId);
    if (!item) return;
    this.#saveDelivery(item, { pauses: DeliveryPlan.withoutPause(item, from) }, { name: 'pauseDeliveries', opts: { itemId } });
  }

  /**
   * Pays a vendor: one expense per item for the days up to `upTo`, each
   * marking the days it covers. Old marks are then trimmed (paid days are
   * never edited again).
   */
  async submitSettle(e, vendor, upTo) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const to = DeliveryPlan.isIso(fd.get('upTo')) ? fd.get('upTo') : upTo;
    const paidOn = DeliveryPlan.isIso(fd.get('paidOn')) ? fd.get('paidOn') : VendorDues.today();
    const ref = AccountRef.parse(fd.get('account'));
    const group = this.#vendorDues.byVendor(to).find((g) => g.vendor.toLowerCase() === String(vendor).toLowerCase());
    const open = (group?.lines || []).filter((l) => l.from && l.amount > 0);
    if (!open.length) return this.#toast.show('Nothing owed');

    let recorded = 0;
    for (const l of open) {
      const cur = l.item.currency || this.#store.getState().user.homeCurrency;
      const typed = parseFloat(fd.get(`amount_${l.item.id}`));
      const amount = Number.isFinite(typed) ? this.#fx.toMinor(typed, cur) : l.amount;
      if (amount <= 0) continue;
      const range = l.days || l.lines.length ? DeliveryPlan.rangeLabel(l.from, l.to) : 'adjustments';
      const txId = await this.#recordRegularEntry(l.item, {
        date: paidOn, qty: l.qty, unitMinor: l.qty ? Math.round(amount / l.qty) : amount, amountMinor: amount, ref,
        description: `${l.item.name} · ${range}`, payee: group.vendor,
        note: `Paid ${group.vendor}: ${l.plan.qtyLabel(l.qty)} on ${l.days} day${l.days === 1 ? '' : 's'}`
          + (l.adjustments?.length ? ` and ${l.adjustments.length} adjustment${l.adjustments.length === 1 ? '' : 's'}` : ''),
        extra: { settles: { from: l.from, to: l.to, qty: l.qty } },
      });
      if (!txId) break;
      recorded++;
      const item = this.#ownItem(l.item.id);
      if (item) {
        item.marks = DeliveryPlan.marksFrom(item.marks, DeliveryPlan.addDays(l.to, -120));
        if (!item.paidTo || l.to > item.paidTo) item.paidTo = l.to;
        if (l.adjustments?.length) item.adjustments = DeliveryPlan.settleAdjustments(item, txId);
      }
    }
    if (!recorded) return;
    this.#store.persist();
    this.#sync.schedulePush?.();
    this.closeModal();
    this.#render();
    this.#toast.show(`Paid ${group.vendor} · up to ${DeliveryPlan.shortDate(to)}`);
  }

  /** A shortcut tapped in the Add form: the entry filled in from it (still editable). */
  useShortcut(itemId) {
    const state = this.#store.getState();
    const it = ShortcutService.list(state).find((i) => i.id === itemId);
    if (!it) return;
    const p = ShortcutService.prefill(it, state.accounts);
    this.#txModal.clearDraft();
    this.#modal.open('transaction', { preset: { ...p, type: 'expense', amount: this.#fx.fromMinor(p.amount, it.currency || state.user.homeCurrency) } });
  }

  /** A suggested shortcut (a payee logged often) tapped: fill the entry, and offer to keep it as a shortcut. */
  useSuggestedShortcut(index) {
    const state = this.#store.getState();
    const sg = ShortcutService.suggestions(state, DateService.todayIso())[index];
    if (!sg) return;
    this.#txModal.clearDraft();
    this.#modal.open('transaction', { preset: {
      type: 'expense', payee: sg.payee, amount: this.#fx.fromMinor(sg.amount, sg.currency), currency: sg.currency,
      categoryId: sg.categoryId || '', accountId: sg.accountId,
    } });
    this.#toast.show(`Filled from ${sg.payee}`, { action: { label: 'Keep as shortcut', run: () => {
      const s = this.#store.getState();
      if (!Array.isArray(s.regularItems)) s.regularItems = [];
      s.regularItems.push({ id: IdGenerator.generate('ri'), name: sg.payee, defaultAmount: sg.amount, currency: sg.currency,
        accountId: sg.accountId || null, sharedOwnerId: null, categoryId: sg.categoryId || null, icon: 'zap', color: '#6366f1', payLater: false, frequency: 'monthly' });
      this.#store.persist();
      this.#sync.schedulePush?.();
      this.#toast.show(`${sg.payee} saved as a shortcut`);
    } } });
  }

  /** "What do you want to track?" → the right form, already set up for it. */
  startRegular(kind) {
    this.closeModal();
    if (kind === 'delivery') return this.openModal('regularItem', { payLater: true });
    if (kind === 'shortcut') return this.openModal('regularItem', { payLater: false });
    const preset = { recurring: { rule: 'monthly', interval: 1, until: null }, ...(kind === 'billAsk' ? { askFirst: true } : {}) };
    this.openModal('transaction', { preset });
  }

  /** A due bill paid: a copy with the amount actually paid (BillService). */
  submitBill(e, templateId, occurrence) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const state = this.#store.getState();
    const t = state.transactions.find((x) => x.id === templateId);
    if (!t) return;
    const amount = this.#fx.toMinor(parseFloat(fd.get('amount')) || 0, t.currency);
    if (amount <= 0) return this.#toast.show('Enter the amount paid');
    const paidOn = DeliveryPlan.isIso(fd.get('paidOn')) ? fd.get('paidOn') : DateService.todayIso();
    try {
      this.#bills.pay(t, occurrence, {
        amount, paidOn, accountId: fd.get('accountId') || t.accountId, hijriDate: this.#hijri.toHijri(paidOn),
        refAmount: this.#fx.convert(amount, t.currency, state.user.homeCurrency),
        exchangeRate: (RATES[t.currency] || 1) / (RATES[state.user.homeCurrency] || 1),
      });
    } catch (err) {
      return this.#toast.show(err.message || 'Not saved');
    }
    this.#store.flush();
    this.#sync.schedulePush?.();
    this.closeModal();
    this.#render();
    this.#toast.show(`${BillService.nameOf(t, this.#store.getState())} paid · ${this.#fx.formatMoney(amount, t.currency)}`);
  }

  /**
   * Stops a repeat after today: its To date becomes today, so no more copies
   * are made (nor bills asked for). Copies already made stay. Undo restores it.
   */
  // ── Pause a repeating entry or bill ───────────────────────────────────

  submitRepeatPause(event, id) {
    event.preventDefault();
    const t = this.#store.getState().transactions.find((x) => x.id === id && x.recurring);
    if (!t) return;
    const fd = new FormData(event.target);
    const from = String(fd.get('from') || DateService.todayIso());
    const len = String(fd.get('length') || '1');
    let to = null;
    if (len === 'date') {
      to = String(fd.get('to') || '');
      if (!to || to < from) return this.#toast.show('Pick the last paused day (on or after the start)');
    } else if (len !== 'open') {
      to = PauseRepeatModal.monthsFrom(from, Number(len) || 1);
    }
    t.pauses = RepeatPause.withPause(t, from, to);
    this.#store.flush();
    this.#sync.schedulePush?.();
    this.closeModal();
    this.#render();
    const name = BillService.nameOf(t, this.#store.getState());
    this.#toast.show(to ? `${name} paused until ${DeliveryPlan.shortDate(to)}` : `${name} paused until you resume`);
  }

  /** End the pause now (a pause not started yet is removed). */
  resumeRepeat(id) {
    const t = this.#store.getState().transactions.find((x) => x.id === id && x.recurring);
    if (!t) return;
    t.pauses = RepeatPause.resumed(t, DateService.todayIso());
    this.#recurring.process();
    this.#store.flush();
    this.#sync.schedulePush?.();
    this.closeModal();
    this.#render();
    this.#toast.show(`${BillService.nameOf(t, this.#store.getState())} repeats again`);
  }

  stopRepeating(templateId) {
    const t = this.#store.getState().transactions.find((x) => x.id === templateId);
    if (!t?.recurring) return;
    const name = t.payee || t.description || 'this entry';
    const today = DateService.todayIso();
    if (!confirm(`Stop repeating "${name}" after today?\n\nNothing new is added from tomorrow. Entries already made stay; delete any you don't want.`)) return;
    const before = t.recurring.until ?? null;
    t.recurring = { ...t.recurring, until: today };
    this.#store.flush();
    this.#sync.schedulePush?.();
    this.closeModal();
    this.#render();
    this.#toast.show(`"${name}" stops after today`, { action: { label: 'Undo', run: () => {
      t.recurring = { ...t.recurring, until: before };
      this.#store.flush();
      this.#sync.schedulePush?.();
      this.#recurring.process();
      this.#render();
      this.#toast.show(`"${name}" repeats again`);
    } } });
  }

  skipBill(templateId, occurrence) {
    const t = this.#store.getState().transactions.find((x) => x.id === templateId);
    if (!t?.recurring) return;
    this.#bills.skip(t, occurrence);
    this.#store.flush();
    this.#sync.schedulePush?.();
    this.closeModal();
    this.#render();
    this.#toast.show(`${BillService.nameOf(t, this.#store.getState())} skipped this time`);
  }

  /**
   * Undoes the newest payment to a vendor: its entries are deleted, so the
   * days they covered (and any adjustments in it) are owed again and can be
   * changed. Entries sent to a family member's book are removed there.
   */
  async undoPayment(vendor) {
    const last = this.#vendorDues.lastPayment(vendor);
    if (!last) return this.#toast.show('No payment to undo');
    const money = this.#fx.formatMoney(last.amount, last.currency || this.#store.getState().user.homeCurrency);
    if (!confirm(`Undo the payment of ${money} to ${vendor} on ${DeliveryPlan.shortDate(last.date, true)}?\n\n`
      + `${last.entries.length === 1 ? 'Its entry is' : `Its ${last.entries.length} entries are`} deleted, and the days up to `
      + `${DeliveryPlan.shortDate(last.to)} are owed again — you can change them and pay again.`)) return;
    const s = this.#store.getState();
    const removed = new Set(last.entries.map((t) => t.id));
    for (const t of last.entries.filter((x) => x._shared)) {
      try { await this.#sync.deleteContribution(t._ownerId, t.id); } catch (err) { this.#toast.show(`Not undone: ${err.message || err}`); return; }
    }
    s.transactions = s.transactions.filter((t) => !removed.has(t.id));
    this.#vendorDues.reconcile(removed);
    this.#store.flush();
    this.#sync.schedulePush?.();
    this.#render();
    this.#toast.show(`Payment to ${vendor} undone · days up to ${DeliveryPlan.shortDate(last.to)} are owed again`);
  }

  /** The vendor's bill as text: the share sheet on phones, else copied. */
  async shareStatement(vendor, upTo) {
    const group = this.#vendorDues.byVendor(upTo || VendorDues.today())
      .find((g) => g.vendor.toLowerCase() === String(vendor).toLowerCase());
    if (!group) return;
    const text = VendorDues.statement(group, (m, c) => this.#fx.formatMoney(m, c || group.currency));
    try {
      if (navigator.share) { await navigator.share({ title: `${group.vendor} bill`, text }); return; }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.#toast.show('Bill copied — paste it in WhatsApp');
    } catch (_) {
      this.#toast.show('Couldn\'t copy the bill');
    }
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
   * Currency step done: save the selected currency, then move to the next
   * onboarding step in place (no close/reopen flash).
   */
  currencySetupNext() {
    const sel = document.getElementById('setupCurrency');
    if (sel) this.#store.getState().user.homeCurrency = sel.value;
    this.#store.persist();
    this.#currencySetupModal.advance();
    this.#modal.refresh();
  }

  /**
   * Sample-data step: keep the demo records, or remove them so the new user
   * starts with an empty book. Removal is saved like any edit, so the cloud
   * copy loses the sample rows too.
   * @param {boolean} keep
   */
  chooseSampleData(keep) {
    if (!keep) this.#clearSampleData();
    this.#currencySetupModal.advance();
    this.#modal.refresh();
  }

  /** Settings → Data: remove whatever sample data is left. */
  removeSampleData() {
    if (!BookCleaner.hasSample(this.#store.getState())) {
      this.#toast.show('No sample data left');
      return;
    }
    if (!confirm('Remove all the sample data (accounts, entries, budgets, bills, debts, investments)? Your own entries are kept.')) return;
    this.#clearSampleData();
    this.#toast.show('Sample data removed');
    this.#render();
  }

  #clearSampleData() {
    BookCleaner.removeSample(this.#store.getState());
    this.#accounts.recompute();
    this.#store.persist();
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

  // ── Habits (Reports) ────────────────────────────────────────────────────

  setReportTab(tab) {
    const v = this.#getOrCreateView('reports');
    v.setTab?.(tab);
    this.#render();
  }

  /** A short "3rd coffee this month · 2 left" note, only near or over a limit. */
  #habitNote(tx, state) {
    if (!tx || tx.type !== 'expense') return null;
    const home = state.user.homeCurrency;
    try {
      return this.#habits.noteFor(tx, state, DateService.todayIso(), home, (m) => this.#fx.formatMoney(m, home));
    } catch { return null; }
  }

  submitHabit(event, id, implicitItemId) {
    event.preventDefault();
    const fd = new FormData(event.target);
    const state = this.#store.getState();
    const name = String(fd.get('name') || '').trim().slice(0, 60);
    if (!name) return this.#toast.show('Give the habit a name');
    const words = String(fd.get('words') || '').split(',').map((w) => w.trim()).filter(Boolean).slice(0, 20);
    const itemIds = fd.getAll('itemIds').map(String);
    if (implicitItemId && !itemIds.includes(implicitItemId)) itemIds.push(implicitItemId);
    const categoryIds = fd.getAll('categoryIds').map(String);
    if (!words.length && !itemIds.length && !categoryIds.length) {
      return this.#toast.show('Add a word, a shortcut or a category to match');
    }
    const home = state.user.homeCurrency;
    const icon = String(fd.get('icon') || 'tag');
    const iconAt = Math.max(0, HabitService.ICONS.indexOf(icon));
    const limitCount = Math.max(0, Math.floor(Number(fd.get('limitCount')) || 0)) || null;
    const amt = Number(fd.get('limitAmount')) || 0;
    const limitAmount = amt > 0 ? this.#fx.toMinor(amt, home) : null;
    if (!Array.isArray(state.habits)) state.habits = [];
    const existing = id ? state.habits.find((h) => h.id === id) : null;
    const fields = { name, words, itemIds, categoryIds, icon, color: existing?.color || HabitService.COLORS[iconAt % HabitService.COLORS.length], limitCount, limitAmount };
    if (existing) Object.assign(existing, fields);
    else state.habits.push({ id: IdGenerator.generate('hab'), createdAt: new Date().toISOString(), ...fields });
    this.#store.flush();
    this.closeModal();
    this.#render();
    this.#toast.show(existing ? 'Habit updated' : 'Habit added');
    this.#sync.schedulePush?.();
  }

  deleteHabit(id) {
    const state = this.#store.getState();
    const list = Array.isArray(state.habits) ? state.habits : [];
    const at = list.findIndex((h) => h.id === id);
    if (at < 0) return;
    const [gone] = list.splice(at, 1);
    this.#store.flush();
    this.closeModal();
    this.#render();
    this.#sync.schedulePush?.();
    this.#toast.show(`Stopped following ${gone.name}`, { action: { label: 'Undo', run: () => {
      const s = this.#store.getState();
      if (!Array.isArray(s.habits)) s.habits = [];
      s.habits.splice(Math.min(at, s.habits.length), 0, gone);
      this.#store.flush(); this.#render(); this.#sync.schedulePush?.();
    } } });
  }

  trackSuggestedHabit(payee) {
    this.openModal('habit', { preset: { name: String(payee).slice(0, 60), words: [String(payee)] } });
  }

  dismissHabitSuggestion(payee) {
    const state = this.#store.getState();
    const list = state.user.dismissedHabitSuggestions ||= [];
    if (!list.includes(payee)) list.push(String(payee).slice(0, 80));
    this.#store.flush();
    this.#render();
    this.#sync.schedulePush?.();
  }

  // ── Suggestions (Regulars) ──────────────────────────────────────────────

  /** One tap: open the form already filled in; nothing is saved until Save. */
  acceptSuggestion(kind, payee) {
    const state = this.#store.getState();
    const today = DateService.todayIso();
    const key = SuggestionService.dismissKey(kind, payee);
    if (kind === 'bill') {
      const g = SuggestionService.bills(state, today).find((x) => SuggestionService.dismissKey('bill', x.payee) === key);
      if (!g) return;
      this.openModal('transaction', { id: g.last.id, preset: {
        recurring: { rule: 'monthly', interval: 1, until: null }, ...(g.changes ? { askFirst: true } : {}),
      } });
      return;
    }
    const g = SuggestionService.deliveries(state, today).find((x) => SuggestionService.dismissKey('delivery', x.payee) === key);
    if (!g) return;
    this.openModal('regularItem', { payLater: true, preset: {
      name: g.payee.slice(0, 60), defaultAmount: g.amount, currency: g.currency,
      accountId: g.accountId || state.accounts[0]?.id || '', categoryId: g.categoryId || '',
    } });
  }

  dismissSuggestion(kind, payee) {
    const state = this.#store.getState();
    const list = state.user.dismissedSuggestions ||= [];
    const key = SuggestionService.dismissKey(kind, payee);
    if (!list.includes(key)) list.push(key.slice(0, 90));
    this.#store.flush();
    this.#render();
    this.#sync.schedulePush?.();
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
   * The revealed Delete button was tapped. The reveal makes an ACCIDENTAL delete
   * structurally impossible; the confirmation on top is a deliberate choice for
   * a destructive, sync-propagating action. Declining leaves the row revealed.
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
        this.#replaceBook(BackupFiles.parseBook(reader.result));
        this.closeModal(); this.#render();
        this.#toast.show('Data imported');
      } catch { this.#toast.show('Invalid JSON file'); }
    };
    reader.readAsText(file);
  }

  /**
   * Swap the book on this device for another (Import JSON, restore from Google Drive).
   * @param {object} book  a parsed Pocket book
   */
  #replaceBook(book) {
    // replaceState() deletes every key the incoming object omits, so an
    // older or partial export used to wipe user settings, categories,
    // budgets, debts and regular items. Running the migrator back-fills
    // those (and openingBalance, without which every balance collapses to
    // the bare ledger sum) before the swap.
    this.#store.replaceState(book, (s) => StateMigrator.migrate(s));
    this.#ensureUserDefaults();
    this.#accounts.recompute();
    this.#store.persist();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Install as an app · offline note · Google Drive backup
  // ──────────────────────────────────────────────────────────────────────────

  #startAppShell() {
    this.#notices = new AppNotices(document.getElementById('appNotices'), {
      icons: document.querySelectorAll('.status-icons'),
      storage: DemoMode.active ? null : window.localStorage,
    });
    this.#pwa = new PwaService({
      win: window,
      onChange: () => {
        this.#refreshNotices();
        if (this.#modal.active === 'settings') this.#modal.refresh();
      },
    }).start();

    const tokens = new GoogleTokenClient({
      clientId: window.POCKET_GOOGLE_CLIENT_ID ?? GOOGLE_DRIVE_CLIENT_ID,
      scope: DriveClient.SCOPE,
      win: window,
      // Automatic backups (opt-in) go through Pocket's drive-auth function.
      broker: new DriveAuthBroker({
        url: APP_SUPABASE_URL ? `${APP_SUPABASE_URL}/functions/v1/drive-auth` : '',
        apiKey: APP_SUPABASE_KEY,
        fetch: (...a) => window.fetch(...a),
      }),
    });
    this.#driveBackup = new DriveBackupService({
      tokens,
      drive: new DriveClient({ tokens, fetch: (...a) => window.fetch(...a) }),
      storage: window.localStorage,
    });
    this.#driveRestoreModal = new DriveRestoreModal({
      load: () => this.#driveBackup.list(Repository.storedOwner()),
      redraw: () => { if (this.#modal.active === 'driveRestore') this.#modal.refresh(); },
    });
    this.#modal.register('driveRestore', this.#driveRestoreModal);

    this.#bus.on('session:known', () => this.#refreshNotices());
    this.#bus.on('auth:changed', () => this.#refreshNotices());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.#refreshNotices(); });
    this.#refreshNotices();

    // Ask the browser to keep the book rather than clear it when space runs low.
    if (!DemoMode.active) this.#pwa.keepStorage();
  }

  /** The notes above every page: offline, and a Google Drive backup that is due. */
  #refreshNotices() {
    if (!this.#notices) return;
    const drive = this.driveStatus();
    const online = this.#pwa?.online !== false;
    if (drive.connected && drive.due && online && !drive.automatic) this.#driveBackup.warm();
    this.#notices.show({
      installable: !!this.#pwa?.installable,
      // Automatic backups look after a due backup themselves; the box asks only if that failed.
      backupAsk: !drive.automatic || this.#driveAutoFailed,
      online: this.#pwa?.online !== false,
      syncs: !!this.#sync.currentUser,
      // A schedule is set: the top-bar icon shows how fresh the last backup is.
      backupOn: drive.connected && drive.progress !== null && !this.#lockState(),
      backupProgress: drive.progress,
      backupDaysLeft: drive.daysLeft,
      backupDue: drive.connected && drive.due && !this.#lockState(),
      backupBusy: drive.busy,
      lastAt: drive.lastAt,
    });
    if (online && !this.#lockState()) this.#automaticBackup();
  }

  /** Automatic backups (opt-in): when one is due, save it without being asked. */
  async #automaticBackup() {
    // Not before the sign-in check and first sync have settled: the book may still be loading.
    if (DemoMode.active || !this.#sessionChecked || !this.#driveBackup?.available) return;
    const owner = Repository.storedOwner();
    if (!this.#driveBackup.claimAutomaticRun(owner)) return;
    const running = this.#driveBackup.backup({ owner, state: this.#store.getState(), csv: this.#ledgerCsv('all') });
    this.#driveChanged();
    try {
      await running;
      this.#driveAutoFailed = false;
      this.#toast.show('Backed up to Google Drive');
    } catch (e) {
      this.#driveAutoFailed = true;
      console.warn('[Drive backup] automatic backup failed:', e);
    }
    this.#driveChanged();
  }

  /** For Settings → General: can Pocket be installed here, and how. */
  installInfo() {
    return {
      installed: !!this.#pwa?.installed,
      canInstall: !!this.#pwa?.canInstall,
      steps: this.#pwa?.manualSteps || '',
    };
  }

  async installApp() {
    const outcome = await this.#pwa?.install();
    if (outcome === 'accepted') this.#toast.show('Pocket is installed');
    else if (outcome === 'unavailable') this.#toast.show(this.#pwa?.manualSteps || 'Use your browser\'s menu to install');
    if (this.#modal.active === 'settings') this.#modal.refresh();
  }

  /** For Settings → Data and the notes: where the Google Drive backup stands. */
  driveStatus() {
    const svc = this.#driveBackup;
    if (!svc || !svc.available || DemoMode.active) {
      return { available: false, connected: false, unlocked: false, offer: null, email: '', frequency: 'off', lastAt: null, due: false, progress: null, daysLeft: null, automatic: false, automaticOffered: false, busy: false, keep: DriveBackupService.KEEP };
    }
    const st = svc.status(Repository.storedOwner());
    return {
      available: true, connected: st.connected, unlocked: st.unlocked, offer: this.#backupOffer(),
      email: st.email, frequency: st.schedule.key,
      lastAt: st.lastAt, due: st.due, progress: st.progress, daysLeft: st.daysLeft,
      automatic: st.automatic, automaticOffered: this.#driveAutoOffered === true,
      busy: svc.busy, keep: DriveBackupService.KEEP,
    };
  }

  /** The add-on's price as the server quoted it for this person, e.g. "₹199", or null when unknown. */
  #backupOffer() {
    const item = this.#paymentOffers?.products?.find((o) => o.product === 'drive_backup' && o.available);
    if (!item) return null;
    return { price: `₹${(item.amountPaise / 100).toLocaleString('en-IN')}`, buying: this.#buying === 'drive_backup' };
  }

  /** Buy scheduled and automatic backups (one-time). Needs a sign-in so the purchase is remembered. */
  async driveUnlock() {
    if (!this.#sync.currentUser) {
      this.#toast.show('Sign in first, so Pocket remembers your purchase');
      this.closeModal();
      setTimeout(() => this.openModal('auth'), 200);
      return;
    }
    if (!this.#paymentOffers) await this.#refreshPlanInfo();
    if (!this.#backupOffer()) {
      this.#toast.show(this.#sync.plan?.backup ? 'Scheduled backups are already on for your account' : 'Payments aren\'t available right now. Please try again later.');
      this.#driveChanged();
      return;
    }
    await this.buy('drive_backup');
    this.#driveChanged();
  }

  async driveConnect() {
    await this.#driveJob(async () => {
      const st = await this.#driveBackup.connect(Repository.storedOwner());
      this.#toast.show(st.email ? `Connected to ${st.email}` : 'Google Drive connected');
    });
  }

  async driveDisconnect() {
    if (!confirm('Disconnect Google Drive? Backups already in your Drive stay there.')) return;
    await this.#driveBackup.disconnect();
    this.#toast.show('Google Drive disconnected');
    this.#driveChanged();
  }

  driveSetFrequency(value) {
    this.#driveBackup.setFrequency(Repository.storedOwner(), value);
    this.#driveChanged();
  }

  /**
   * Switch automatic backups on or off (Settings → Data). On asks Google for
   * lasting permission in its window; off forgets it on this device.
   * @param {boolean} on
   */
  async driveSetAutomatic(on) {
    const owner = Repository.storedOwner();
    if (!on) {
      this.#driveBackup.disableAutomatic(owner);
      this.#toast.show('Automatic backups are off');
      this.#driveChanged();
      return;
    }
    await this.#driveJob(async () => {
      await this.#driveBackup.enableAutomatic(owner);
      this.#driveAutoFailed = false;
      this.#toast.show('Automatic backups are on');
    });
  }

  /** Save a backup now (from Settings or the "backup due" note). Opens Google's window if needed. */
  async driveBackupNow() {
    await this.#driveJob(async () => {
      await this.#driveBackup.backup({
        owner: Repository.storedOwner(),
        state: this.#store.getState(),
        csv: this.#ledgerCsv('all'),
      });
      this.#toast.show('Backed up to Google Drive');
    });
  }

  openDriveRestore() {
    this.#modal.open('driveRestore', {});
    lucide?.createIcons?.();
    this.#driveRestoreModal.open();
  }

  /** @param {string} fileId  the backup's book file in Drive */
  async driveRestore(fileId) {
    if (!confirm('Restore this backup? It replaces the book on this device.')) return;
    this.#driveRestoreModal.restoring = fileId;
    try {
      const book = await this.#driveBackup.fetchBook(Repository.storedOwner(), fileId);
      this.#replaceBook(book);
      this.closeModal(); this.#render();
      this.#toast.show('Backup restored');
    } catch (e) {
      this.#driveRestoreModal.restoring = null;
      this.#toast.show(e?.message || 'Could not restore that backup');
    }
  }

  /** Close a note above the page (its icon stays in the top bar). @param {'offline'|'backup'} kind */
  dismissNotice(kind) { this.#notices?.dismiss(kind); }

  /** A top-bar icon was tapped: open its note (or close it if open). @param {'offline'|'backup'} kind */
  toggleNotice(kind) {
    if (this.#notices?.toggle(kind)) window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  /** Run one Drive action, showing "…ing" while it runs and any problem as a toast. */
  async #driveJob(job) {
    if (this.#driveBackup.busy) return;
    const running = job();
    this.#driveChanged();
    try {
      await running;
    } catch (e) {
      this.#toast.show(e?.message || 'Google Drive did not respond. Please try again.');
    }
    this.#driveChanged();
  }

  #driveChanged() {
    this.#refreshNotices();
    if (this.#modal.active === 'settings') this.#modal.refresh();
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

  // ── Report export (PDF / Excel / CSV) ─────────────────────────────────

  exportSet(scope, field, value) {
    this.#exportModal.set(scope, field, value);
    this.#modal.refresh();
  }

  exportToggle(scope, field, value) {
    this.#exportModal.toggle(scope, field, value);
    this.#modal.refresh();
  }

  exportMoveColumn(key, step) {
    this.#exportModal.moveColumn(key, step);
    this.#modal.refresh();
  }

  exportClearFilters() {
    this.#exportModal.clearFilters();
    this.#modal.refresh();
  }

  async exportRun(type) {
    if (this.#exportModal.busy) return;
    const label = { pdf: 'PDF', xlsx: 'Excel file', csv: 'CSV' }[type] || 'file';
    this.#toast.show(`Preparing ${label}…`);
    const done = this.#exportModal.run(type);
    this.#modal.refresh();               // shows "Preparing…" on the button
    try {
      this.#toast.show(await done);
    } catch (e) {
      console.error('[export]', e);
      this.#toast.show(`Export failed: ${e.message || e}`);
    } finally {
      this.#modal.refresh();
    }
  }

  exportCsv(range) {
    const blob = new Blob([this.#ledgerCsv(range)], { type: 'text/csv;charset=utf-8' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'transactions-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    this.closeModal();
    this.#toast.show('CSV downloaded');
  }

  /**
   * Transactions as CSV text, in the import template's columns (so the file
   * can be imported back). Used by Export CSV and by Google Drive backups.
   * @param {string} range  'all', 'current' (the Reports range) or a number of days
   * @returns {string}
   */
  #ledgerCsv(range) {
    const state = this.#store.getState();

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

    return rows.map((r) => r.join(',')).join('\n');
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

  /**
   * Delete every entry in the user's book — transactions, accounts, budgets,
   * debts, regular items and account groups — here and in the cloud. Categories,
   * settings and family sharing are kept. Asks for the word DELETE first,
   * because this cannot be undone.
   */
  resetData() {
    const typed = prompt(
      'This deletes ALL your transactions, accounts, budgets, debts and regular items, ' +
      'on every device. Categories and settings are kept. It cannot be undone — ' +
      'consider exporting a backup first.\n\nType DELETE to confirm.');
    if (typed == null) return;
    if (typed.trim().toUpperCase() !== 'DELETE') {
      this.#toast.show('Reset cancelled — you didn\'t type DELETE');
      return;
    }
    const removed = BookCleaner.wipe(this.#store.getState());
    this.#accounts.recompute();
    this.#store.persist();
    this.#render();
    this.#toast.show(`Data reset — ${removed} record${removed === 1 ? '' : 's'} deleted`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: render
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Whether to keep the book closed: 'locked' when it belongs to a Pocket
   * account and nobody is signed in (a lapsed sign-in), 'opening' while the
   * app is still checking. A book made without ever signing in has no owner
   * and is never locked; a real Sign out clears the book and its owner.
   * @returns {false|'opening'|'locked'}
   */
  #lockState() {
    if (!this.#store.storedOwner) return false;
    if (this.#sync.hasSession) return false;
    return this.#sessionChecked || this.#sync.sessionKnown ? 'locked' : 'opening';
  }

  /** Menus, plan banner and space bar are hidden while the book is closed. */
  #setChromeHidden(hide) {
    if (!document.getElementById('pocketLockStyle')) {
      const st = document.createElement('style');
      st.id = 'pocketLockStyle';
      st.textContent = '.pocket-locked #sidebarNav,.pocket-locked #bottomNav,.pocket-locked #planBanner,.pocket-locked #spaceBar,.pocket-locked #authPill{display:none !important}';
      document.head.appendChild(st);
    }
    document.body.classList.toggle('pocket-locked', !!hide);
  }

  /** True while the book is locked or still opening (for tests and the auth flow). */
  get locked() { return !!this.#lockState(); }

  #render() {
    // A deleted payment reopens its days; keep "paid up to" in step with the payments.
    if (this.#vendorDues?.reconcile()) { this.#store.persist(); this.#sync.schedulePush?.(); }
    // Any revealed swipe row is about to have its DOM node replaced, so drop
    // the reference rather than leave the controller holding a detached node.
    this.#swipe?.reset();
    this.#renderSpaceBar();
    // Network / backup icons and notes; also starts an automatic backup that is due.
    this.#refreshNotices();
    // Inject live shared data so views can read state._sharedData
    const state = this.#store.getState();
    state._sharedData        = this.#sync.sharedData;
    state._currentUserEmail  = this.#sync.currentUser?.email || null;
    const lock = this.#lockState();
    this.#setChromeHidden(!!lock);
    if (lock) {
      const content = document.getElementById('viewContent');
      if (content) content.innerHTML = this.#lockView.render({ opening: lock === 'opening', online: navigator.onLine !== false });
      lucide?.createIcons?.();
      return;
    }
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
    content.innerHTML = (DemoMode.active ? DemoMode.bannerHtml() : '') + html;
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
      case 'investments':  view = new InvestmentsView();  break;
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

    // Budget period schema: collapse legacy 'monthly' (and anything unknown)
    // to the canonical 'gregorian'; the known kinds are BudgetPeriod.KINDS.
    // Keeping one value per kind stops the first edit from silently mutating
    // the stored period (#12/#18).
    if (Array.isArray(state.budgets)) {
      state.budgets.forEach((b) => {
        if (b && !BudgetPeriod.KINDS.includes(b.period)) b.period = 'gregorian';
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
