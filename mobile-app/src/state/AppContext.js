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
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyTheme } from '../ui/theme.js';
import { Store } from '../core/Store.js';
import { EventBus } from '../core/EventBus.js';
import { Repository } from '../core/Repository.js';
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
    (async () => {
      // 1. Load persisted state BEFORE the store boots (async → sync bridge).
      Repository.setBackend(AsyncStorage);
      await Repository.prepare();

      const services = buildServices();
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

      // 6. Restore a signed-in session and pull, if sync is configured.
      if (services.sync.init()) {
        services.sync.restoreSession().then(() => {
          if (mounted) setUser(services.sync.currentUser);
        });
      }

      if (mounted) setReady(true);
    })();
    return () => { mounted = false; };
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
  return {
    state: ctx.services.store.getState(),
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
