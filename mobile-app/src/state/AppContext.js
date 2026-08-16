/**
 * AppContext — boots the domain layer once and binds it to React.
 *
 * The domain is the SAME code the web app runs (Store, services, migrator,
 * ledger math). React only needs two things from it:
 *
 *   1. a singleton bundle of service instances (never re-created), and
 *   2. a re-render signal when state changes — EventBus 'state:changed' bumps
 *      a revision counter, and any component calling useAppState() re-renders.
 *
 * Components read state directly off the Store (it's the single source of
 * truth) and mutate ONLY through services/composers, exactly like the web.
 */
import React, {
  createContext, useContext, useEffect, useMemo, useState, useRef,
} from 'react';
import { Appearance, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyTheme } from '../ui/theme.js';
import { Store } from '../core/Store.js';
import { EventBus } from '../core/EventBus.js';
import { Repository } from '../core/Repository.js';
import { RegularLogService } from '../domain/services/RegularLogService.js';
import { Space } from '../domain/services/Space.js';
import { SpaceRegistry } from '../domain/services/SpaceRegistry.js';
import { SpaceGuard } from '../domain/services/SpaceGuard.js';
import { SyncJournal } from '../core/SyncJournal.js';
import { SeedFactory } from '../data/seed.js';
import { StateMigrator } from '../data/StateMigrator.js';
import { AccountService } from '../domain/services/AccountService.js';
import { CategoryService } from '../domain/services/CategoryService.js';
import { TransactionService } from '../domain/services/TransactionService.js';
import { TransactionComposer } from '../domain/services/TransactionComposer.js';
import { BudgetService } from '../domain/services/BudgetService.js';
import { RecurringService } from '../domain/services/RecurringService.js';
import { CurrencyService } from '../domain/services/CurrencyService.js';
import { PaymentTypeService } from '../domain/services/PaymentTypeService.js';
import { AccountGroupService } from '../domain/services/AccountGroupService.js';
import { ExchangeRateService } from '../domain/services/ExchangeRateService.js';
import { MobileSyncService } from '../domain/services/MobileSyncService.js';
import { DebtService } from '../domain/services/DebtService.js';
import { ReportService } from '../domain/services/ReportService.js';
import { ReceiptScanService } from '../domain/services/ReceiptScanService.js';
import { FamilyShareService } from '../domain/services/FamilyShareService.js';

const AppCtx = createContext(null);

/** Build every service once. Mirrors the web Application constructor. */
function buildServices() {
  const store = Store.getInstance();
  const services = {
    store,
    accounts:      new AccountService(),
    categories:    new CategoryService(),
    transactions:  new TransactionService(),
    composer:      new TransactionComposer(),
    budgets:       new BudgetService(),
    recurring:     new RecurringService(),
    fx:            new CurrencyService(),
    paymentTypes:  new PaymentTypeService(store),
    accountGroups: new AccountGroupService(store),
    fxRates:       new ExchangeRateService(),
    sync:          new MobileSyncService(),
    debts:         new DebtService(),
    reports:       new ReportService(),
    receipts:      new ReceiptScanService(),
    familyShares:  new FamilyShareService(store),
    // Regular-item logs live in two books: local rows, and contributions sitting
    // in an owner's snapshot. Needs `sync` because mobile never populates
    // state._sharedData the way the web app does on every render.
    regularLogs:   null,
    // Which book the UI is showing. Assigned after construction — it needs the
    // sync instance created in this same literal.
    spaces:        null,
    // May-I, and against whose book. Assigned after construction — it needs
    // `spaces`, which needs `sync`.
    spaceGuard:    null,
  };
  return services;
}

export function AppProvider({ children }) {
  const [ready, setReady]       = useState(false);
  const [revision, setRevision] = useState(0);
  const [syncStatus, setStatus] = useState('local');
  const [user, setUser]         = useState(null);
  const servicesRef             = useRef(null);

  useEffect(() => {
    let mounted = true;
    /** Teardown callbacks registered during boot. */
    const subscriptions = [];
    (async () => {
      // 1. Load persisted state BEFORE the store boots (async → sync bridge).
      Repository.setBackend(AsyncStorage);
      await Repository.prepare();
      // The journal must be loaded BEFORE the first pull, or the cold-start
      // recovery in MobileSyncService reads null and never runs.
      SyncJournal.setBackend(AsyncStorage);
      await SyncJournal.prepare();

      const services = buildServices();
      // Assigned after construction: it depends on `sync`, which is created in
      // the same object literal.
      services.regularLogs = new RegularLogService({ store: services.store, sync: services.sync });
      services.spaces = new SpaceRegistry({
        store: services.store,
        sync:  services.sync,
        spaceFactory: (opts) => new Space(opts),
        // React Native has no sessionStorage. In-memory means a cold start
        // returns you to your own space, which is the right default: a stale
        // pointer at a space that was revoked while the app was closed is worse
        // than an extra tap.
        sessionStore: (() => {
          const mem = new Map();
          return {
            getItem:    (k) => (mem.has(k) ? mem.get(k) : null),
            setItem:    (k, v) => { mem.set(k, v); },
            removeItem: (k) => { mem.delete(k); },
          };
        })(),
      });
      services.spaceGuard = new SpaceGuard({
        spaces: services.spaces, store: services.store, sync: services.sync,
      });
      servicesRef.current = services;
      const store = services.store;

      // 2. Same boot order as the web app.
      store.setDeriveHook(() => services.accounts.recompute());
      store.init(() => SeedFactory.create(), (s) => StateMigrator.migrate(s));
      services.accounts.recompute();
      services.recurring.process();

      // 2a. Apply the saved theme before first paint, and follow the OS when
      //     the user chose "system".
      applyTheme(store.getState().user.theme || 'system', Appearance.getColorScheme());
      Appearance.addChangeListener(({ colorScheme }) => {
        if (!mounted) return;
        if ((store.getState().user.theme || 'system') === 'system') {
          applyTheme('system', colorScheme);
          setRevision((r) => r + 1);
        }
      });

      // 3. Every local mutation schedules a cloud push (web audit H7);
      //    remote applies (replaceState/reset) are excluded by the Store.
      store.setLocalChangeHook(() => services.sync.schedulePush());

      // 4. FX refresh in the background; failures are fine offline.
      services.fxRates.seedFromState?.();
      services.fxRates.refresh?.().catch(() => {});

      // 5. Re-render on every state change.
      const bus = EventBus.getInstance();
      bus.on('state:changed', () => { if (mounted) setRevision((r) => r + 1); });
      bus.on('sync:status',   ({ status }) => { if (mounted) setStatus(status); });
      bus.on('auth:changed',  ({ user: u }) => { if (mounted) setUser(u ?? null); });

      // 5a. Flush everything durable when the app leaves the foreground.
      //     Android reclaims a backgrounded process with no further JS, so a
      //     pending debounced push and an un-awaited AsyncStorage write are
      //     both simply lost — this is the RN equivalent of the web app's
      //     visibilitychange/pagehide hook.
      const appStateSub = AppState.addEventListener('change', (next) => {
        if (next === 'background' || next === 'inactive') {
          services.sync.flushForBackground?.().catch(() => {});
        }
      });
      subscriptions.push(() => appStateSub?.remove?.());

      // 6. Restore a signed-in session and pull, if sync is configured.
      if (services.sync.init()) {
        services.sync.restoreSession().then(() => {
          if (mounted) setUser(services.sync.currentUser);
        });
      }

      if (mounted) setReady(true);
    })();
    return () => {
      mounted = false;
      for (const off of subscriptions) { try { off(); } catch (_) {} }
    };
  }, []);

  const value = useMemo(
    () => ({ services: servicesRef.current, revision, syncStatus, user, ready }),
    [revision, syncStatus, user, ready],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/**
 * State + services for a screen. Re-renders on every store change.
 * @returns {{state:object, services:object, revision:number, syncStatus:string, user:object|null}}
 */
export function useAppState() {
  const ctx = useContext(AppCtx);
  if (!ctx?.services) throw new Error('useAppState() outside AppProvider or before boot');
  const space = ctx.services.spaces?.active?.() ?? null;
  return {
    /**
     * State, SCOPED TO THE ACTIVE SPACE.
     *
     * Home returns the real state object; a guest space returns a shallow
     * projection whose collections come from the owner's snapshot. This one
     * getter re-points every screen, the same way BaseView.state does on web.
     *
     * Treat it as READ-ONLY. Anything that mutates must go through a service or
     * `services.store.getState()` — a write through a guest projection lands on
     * a copy the next pull discards, while store.flush() persists the real
     * state, so the screen repaints and the write appears to have worked.
     */
    state: space ? space.project() : ctx.services.store.getState(),
    /** The unscoped local book, for the rare caller that needs both. */
    localState: ctx.services.store.getState(),
    /** @type {import('../domain/services/Space.js').Space|null} */
    space,
    /** True when viewing someone else's book — hide or refuse writes. */
    inGuestSpace: !!space && !space.isHome,
    /** @type {import('../domain/services/SpaceGuard.js').SpaceGuard} */
    guard: ctx.services.spaceGuard,
    services: ctx.services,
    revision: ctx.revision,
    syncStatus: ctx.syncStatus,
    user: ctx.user,
  };
}

/**
 * State for a screen that is ALWAYS about the signed-in member's own book,
 * whatever space is selected.
 *
 * Some screens are not about the space at all. Settings holds the member's
 * preferences, their backups and their sign-in; Family holds who THEY share
 * with. Handing those a projection is not a scoping decision, it is a category
 * error, and the failures were correspondingly odd: the home-currency chip
 * showed the owner's currency as though it were the member's setting, the
 * default-account list offered accounts they do not own, and Export produced a
 * backup of the owner's entire book which, re-imported, replaced the member's.
 *
 * This exists as its own hook rather than as `useAppState().localState` because
 * a screen that must never see a projection should not be one forgotten
 * destructure away from seeing one. The import line states the intent, and the
 * W-block asserts on it.
 *
 * @returns {{state:object, services:object, revision:number, syncStatus:string,
 *            user:object|null, inGuestSpace:boolean, guard:object}}
 */
export function useOwnState() {
  const ctx = useContext(AppCtx);
  if (!ctx?.services) throw new Error('useOwnState() outside AppProvider or before boot');
  const space = ctx.services.spaces?.active?.() ?? null;
  return {
    /** The member's real book. Never a projection. Safe to mutate. */
    state: ctx.services.store.getState(),
    /** Still reported, so a screen can say "you're viewing someone else's book". */
    inGuestSpace: !!space && !space.isHome,
    space,
    guard: ctx.services.spaceGuard,
    services: ctx.services,
    revision: ctx.revision,
    syncStatus: ctx.syncStatus,
    user: ctx.user,
  };
}

/** Boot gate — true once the domain layer is ready. */
export function useAppReady() {
  return useContext(AppCtx)?.ready ?? false;
}
