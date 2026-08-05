# Parity audit — Flutter app vs legacy-web (2026-06-11)

Line-by-line comparison of every legacy view/modal/service against the
Flutter implementation. Three sections: **A** discrepancies (parity gaps),
**B** bugs/risks in the current Flutter code, **C** improvements (code +
design). Severity: 🔴 user-visible gap · 🟡 behavioral nuance · 🟢 cosmetic.

## A. Discrepancies vs legacy

### A1. Missing UI surfaces
1. 🔴 **Calendar view** (`CalendarView.js` + `DayLogsModal.js`): legacy renders
   a month grid (Gregorian/Hijri/both per `calendarMode`), shows **miqaats**
   from the Mumineen calendar, day-cell spend totals, and per-day quick-log
   of regular items. Flutter has the Regular Purchases *list* only — no
   calendar grid, no miqaats display (domain `HijriCalendar.miqaats` is
   plumbed but fed an empty table; the `mumineen_calendar_js-main/source/
   data/miqaats.json` data needs porting into an asset).
2. 🔴 **AccountDetailView**: legacy drills into one account (balance header,
   filtered transaction list, inbound-share variant via `shareIndex`).
   Flutter: tapping an account opens the *edit dialog* instead. Inbound
   shared accounts are listed on Family but are NOT openable.
3. 🟡 **BudgetDetailView**: legacy shows per-budget history/breakdown;
   Flutter budgets are cards with edit only.
4. 🟡 **Account groups** (`accountGroups`, collapse state, `__new__` flow):
   schema + `groupId` exist end-to-end but no grouping UI in Accounts.
5. 🟡 **CurrencySetupModal / first-run onboarding + seed data**: legacy seeds
   demo accounts/categories (`seed.js`) and runs a currency setup modal on
   first launch. Flutter: a brand-new cloud user starts with empty lists and
   no guided setup — empty-state buttons exist but no seeded categories.
   Consider seeding default expense/income categories on first sign-in.
6. 🟡 **TransactionsView filters**: legacy has search, type filter and a
   date-range selector feeding `#reportRange` (also reused by CSV "current
   range"). Flutter transaction list has no search/filter and CSV export
   offers fixed ranges only.

### A2. Behavioral nuances
7. 🟡 **Payment types**: legacy picker = `card, cash, bank-transfer, cheque,
   crypto, other` + user-defined types (`PaymentTypeService`,
   `profiles.custom_payment_types`). Flutter hard-codes `card`
   (`transfer` for transfers/debts) with no picker.
8. 🟡 **Record state**: legacy supports `cleared/pending` semantics in data;
   Flutter always writes `cleared`, no toggle.
9. 🟡 **Merchant auto-categorization**: legacy remembers payee→category
   (`merchant_categories` table exists, synced locally) and pre-selects the
   category for known payees. Not wired in Flutter.
10. 🟡 **Transfer editing**: legacy `TransactionModal` allows editing a
    transfer in place (amount/date both legs). Flutter requires
    delete + recreate (documented in-dialog).
11. 🟡 **Debt edit scope**: both freeze principal/currency/account on edit —
    parity ✔; but legacy *unlinks* (sets `debtId=null`) on "destroy
    payments" unchecked-deletion only after confirm — parity ✔. Legacy also
    shows the **initial-tx date readonly** when editing; Flutter hides it.
12. 🟡 **Receipt scan currency**: legacy opens the full transaction modal
    with the receipt currency active (FX panel). Flutter now HAS the FX
    picker, but the scan prefill sets only the amount text — it does not
    set `_currency` to the receipt currency. One-line follow-up:
    `_currency = prefill.currency` in `_scanReceipt` (guard: only when the
    currency exists in the FX table).
13. 🟡 **Import "replace all"**: dropped deliberately (sync-hostile).
14. 🟡 **Duplicate detection**: legacy plans dupes against
    date+amount+account; Flutter adds currency+payee to the fingerprint —
    stricter, fewer false positives, but a legacy re-import where payees
    differ in case/whitespace will not be flagged (norm() lowercases/trims,
    so only true content differences slip through).
15. 🟢 **Icons/fonts**: Material icons approximate lucide; pills/colors match.
16. 🟢 **Toast vs SnackBar**, modal styling, Tailwind chrome: equivalent.

## B. Bugs / risks in current Flutter code

1. 🔴 **Dashboard & Reports convert at LIVE rates** for income/expense
   aggregates (`fx.convert(t.amount …)`), while balances correctly prefer
   frozen `acctMinor`. Legacy aggregates used the frozen `refAmount`
   snapshot. Once FX rates refresh, monthly history will drift. Fix: prefer
   `t.refAmountMinor` when present and home currency matches the snapshot
   home; needs a `snapshot_home` column or recompute-on-home-change policy.
2. 🔴 **Recurring + multi-device races**: `RecurringProcessor` runs on every
   device on every ledger emission. Deterministic ids make duplicates
   *converge* (INSERT OR REPLACE), but two devices can briefly both upload
   the same instance — last-write-wins is fine, yet the Postgres
   `transactions` insert via PowerSync may produce one rejected duplicate
   upload (logged + skipped by the connector). Harmless but noisy; consider
   generating only when `db.currentStatus.hasSynced`.
3. 🟡 **Connector skip policy**: `RowUploadTransformer` + log-and-skip means
   a genuinely rejected row (e.g. RLS misconfig) is silently dropped from
   upload while remaining in the local DB — divergence with no UI signal.
   Improvement: count skips and surface in the sync status tile.
4. 🟡 **`fx_rates` write policy** (migration 0004) lets ANY authenticated
   user overwrite global rates. Fine at family scale; move refresh to an
   edge function + cron before widening the user base.
5. 🟡 **Category delete** leaves dangling `category_id` on transactions
   (uncategorised display) — Postgres `on delete set null` will fix rows
   server-side, but the local PowerSync rows keep the stale id until the
   next sync of those rows. Budgets referencing the deleted category keep a
   dead `budget_categories` row locally too. Consider an explicit local
   cleanup in `CategoryDialog._delete`.
6. 🟡 **Settings dropdowns** (`DropdownButtonFormField.initialValue`) don't
   update if the same Settings screen stays open while another device
   changes the profile (initialValue is first-build only). Low impact.
7. 🟡 **Web picker cancellation**: `input.onChange.first` never completes if
   the user closes the OS dialog without choosing (no `cancel` event in
   older engines) — the awaited future leaks (no UI hang since we don't
   block). Modern Chromium fires `cancel`; acceptable.
8. 🟡 **`balancesProvider` includes archived accounts** in `LedgerMath`
   (correct for history) but net worth excludes them — intended, verify
   with tests.
9. 🟢 **`home_shell.dart` is dead code** (replaced by `app_shell.dart`);
   `placeholder_screen.dart` and `theme.dart`'s `themeModeProvider`
   likewise. Delete on next pass.
10. 🟢 **Tests not yet run** for: `feature_mappers_test.dart`,
    `debt_service_test.dart`, `recurring_generator_test.dart` since the
    last edits — run `dart test` in both packages (no compiler in the
    authoring environment; everything above was desk-checked + simulated).

## C. Suggested improvements

### Code
1. **Split `dashboard_providers.dart`** — it has become the app's DI root
   (fx, settings, debts, shares, sync status…). Move to
   `core/di/providers.dart` per-feature files; keeps feature modules
   self-contained (matches the strict-OOP brief).
2. **Add `copyWith` to `LedgerTransaction`** (or adopt `freezed`): the
   hand-rolled field-for-field copies in `DebtController._withoutDebtLink`
   and `TransactionController._withPair` are the #1 future-bug magnet (two
   already had to be patched when `recurring` landed).
3. **Repository contract tests**: one shared test suite run against
   in-memory AND PowerSync (with a temp DB) implementations to keep the
   port semantics honest.
4. **Connector upload tests**: golden tests for `RowUploadTransformer`
   (tags/bools/uuid-blank cases) — these bugs cost a day of "nothing syncs".
5. **CI**: a workflow running `flutter analyze` + `dart test` on PRs (the
   deploy workflow only gates on tests at deploy time).
6. **Error surfacing**: a small `SyncIssues` provider fed by the connector
   (skipped-row count, last error) displayed under the sync tile.

### Design / product
7. **Calendar screen** is the biggest UX gap — port `CalendarView` with the
   miqaats JSON as a Flutter asset; reuse `RegularItemsScreen` quick-log.
8. **Account detail page** (tap account → ledger filtered to it, reconcile
   shortcut, share badge) — also gives inbound shares a destination.
9. **Onboarding**: first-run seed categories + currency picker (port
   `CurrencySetupModal`), guarded by `profiles` emptiness.
10. **Merchant memory**: on save, upsert payee→category into
    `merchant_categories`; pre-fill category for known payees in the dialog.
11. **Payment-type picker + custom types** (profiles column already exists).
12. **Search + filters** on Transactions (text, type, account, date range) —
    trivial with the current provider shape.
