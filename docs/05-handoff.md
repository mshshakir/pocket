# Pocket Budget — Flutter rebuild: handoff & roadmap

_Hand this whole file to a new session. It is the single source of truth for
where the project is and what to do next._

## 1. What this project is

Rebuilding an existing personal-finance web app ("Pocket") as **one Flutter
codebase targeting iOS + Android + Web**, backed by **Supabase** (Postgres +
Auth) with **PowerSync** for offline-first sync. Flutter Web will eventually
replace the old vanilla-JS web app. The old app is preserved at `legacy-web/`
and is the **reference for features and UI/UX** (its dashboard uses a left
sidebar, light/dark themes, ₹/INR formatting, Hijri dates, category icon pills).

Hard constraints from the owner: **strict OOP**, match the legacy UI/UX.

## 2. Monorepo layout

```
apps/pocket_app/      Flutter app (iOS/Android/Web)
packages/domain/      PURE Dart business logic — shared brain, fully unit-tested
packages/data/        repository implementations: row mappers + in-memory repos
supabase/migrations/  0001_init.sql — normalized schema + RLS + balances view
legacy-web/           the original JS app (reference + still-deployed site)
docs/                 design docs 01–04 + this handoff (05)
```

## 3. Done & working

**Domain (`packages/domain`) — pure Dart, `dart test` green (~30 tests):**
- `CurrencyService` (minor units; `convertStrict` throws, `convert` returns 0 on
  unknown currency — never the old 1:1 bug).
- `LedgerMath` + entities (`LedgerAccount`, `LedgerTransaction`, `LedgerSplit`):
  balances prefer the rate-frozen `acctMinor` so they never drift with FX.
- `HijriCalendar` (faithful AJD math; fixed a JS-0-based vs Dart-1-based month bug).
- `CategoryTree` (recursive, cycle-safe `descendants`).
- `BudgetService` (period + rollover spend), `Recurrence.stepDate` (anchor/clamp).
- Repository **ports**: `AccountRepository`, `TransactionRepository`,
  `CategoryRepository`, `BudgetRepository`.

**Data (`packages/data`) — pure, tested:**
- `row_mappers.dart`: entity ↔ DB/JSON row for accounts, transactions (+splits),
  categories, budgets — keyed to the SQL columns. Tolerant of int-vs-bool and
  CSV-vs-array (PowerSync↔Supabase differences).
- In-memory repos for all four aggregates (used as offline/sample fallback).

**Backend (`supabase/migrations/0001_init.sql`):** normalized tables with UUID
keys, soft-delete + `updated_at`, the `account_balances` view (mirrors
`LedgerMath`), global `fx_rates`, and **RLS** policies that replace the old
JSON-blob + snapshot/contribution sharing model. Applied to a live Supabase
project (ref `csftaatwjldwjxuylqtn`). `budget_categories`/`merchant_categories`
were given an `id` column because PowerSync requires one.

**App (`apps/pocket_app`):**
- **Auth**: email/password **and Google** sign-in (Supabase). Router gates the
  app behind sign-in when cloud is configured; sample mode when not.
- **Sync**: PowerSync wired via raw SQL (`db.watch`/`db.execute`) + the row
  mappers (NOT Drift). `supabase_connector.dart` uploads local writes; writes
  stamp `user_id` for RLS. Sync Streams config (edition 3) deployed in PowerSync.
- **UI/UX**: responsive **sidebar (wide) / drawer (narrow)** shell matching the
  legacy nav; light/dark theme toggle; ₹/INR formatting (intl); Hijri "Today"
  card. Screens built and live: **Dashboard** (net worth, income/expense this
  month, recent transactions), **Transactions** (list + add, with category
  picker), **Accounts** (list + add), **Categories** (grouped tree + add),
  **Budgets** (progress bars via `BudgetService` + add), **Reports** (spending-
  by-category donut via `fl_chart`).
- Providers in `features/dashboard/application/dashboard_providers.dart`
  transparently use PowerSync repos when configured, else in-memory.

App deps: flutter_riverpod, go_router, supabase_flutter, powersync, uuid,
fl_chart, intl, path, path_provider.

## 4. ACTIVE BUG — fix this first

**Symptom:** data added in the app shows in-session but **disappears on browser
refresh** / never reaches Supabase.

**Root causes found 2026-06-11 (all fixed in code):**
1. `openPowerSyncDatabase` used `path_provider`, which **throws on web** → the
   DB never opened and the app silently ran on in-memory sample data (that's
   why the sample 'salary' transaction was visible). Now uses a bare
   `'pocket.db'` path on web, and the sidebar shows a **sync status tile**
   (red "SAMPLE DATA — sync failed" when the DB fails to open).
2. The connector uploaded raw SQLite values: CSV string into `tags text[]`,
   `0/1` into boolean columns → PostgREST rejected the row and, with no error
   handling, **one bad row jammed the upload queue forever**. The connector
   now type-coerces per table (`RowUploadTransformer`) and logs+skips
   unrecoverable rejections instead of blocking.

**Still required on the user's machine:** run `dart run powersync:setup_web`
in `apps/pocket_app` (adds `sqlite3.wasm`, `powersync_db.worker.js`,
`powersync_sync.worker.js` to `web/`) — without these the web DB opens but is
**non-persistent across refreshes**. Then a **full** restart
(`flutter run -d chrome --web-port=5000`).

**Then verify cloud upload** (Supabase → Table Editor). Likely follow-up: the
`transactions.tags` column is Postgres `text[]` but the app stores tags as a CSV
string, so uploads of transactions with tags can be rejected. Fix if needed:
```sql
alter table transactions alter column tags type text using array_to_string(tags, ',');
```
Also confirm boolean columns (`archived`, `rollover`) accept the 0/1 PowerSync
sends; if PostgREST rejects them, convert in the connector or make them int.

## 5. Environment gotchas (important)

- The repo lives in a **OneDrive-synced** folder. Run **all `git` and Flutter/
  Dart commands on the Windows machine** — a cloud sandbox cannot reliably manage
  the synced `.git` (leaves stuck `*.lock` files) and sees stale/partial copies.
- Google OAuth: the OAuth client is in the owner's existing Google Cloud project;
  Google's **Authorized redirect URI** must be the Supabase callback
  `https://csftaatwjldwjxuylqtn.supabase.co/auth/v1/callback`; run the web app on
  a **fixed port** (`--web-port=5000`) that matches Supabase → Auth → URL
  Configuration redirect URLs. Turn **off** email confirmation for easy testing.
- Cloud keys live in `apps/pocket_app/lib/sync/sync_config.dart` (already filled).
  Blank ⇒ the app runs offline on in-memory sample data.

## 6. What's left

### Update 2026-06-11 — feature-parity pass (all four placeholder screens built)

**Done in this pass (all OOP: domain entities/services → repos → controllers → UI):**
- **Domain:** `Debt`+`DebtService` (remaining/percent/settle math preserves
  legacy bugs 11+14 fixes; builds the linked initial/payment transactions),
  `RegularItem`, `UserSettings`, `AccountShare`/`InboundShare`; new ports
  `DebtRepository`, `RegularItemRepository`, `SettingsRepository`,
  `ShareRepository`; `LedgerTransaction` gained `debtId`/`debtRole`/
  `regularItemId`. Tests: `debt_service_test.dart` (domain),
  `feature_mappers_test.dart` (data).
- **Data:** row mappers + in-memory repos for all of the above; transaction
  mapper carries the new link columns.
- **App:** PowerSync repos (debts, regular_items, profiles-settings) +
  `SupabaseShareRepository` (family is online-only via RLS); local schema
  updated (new tx columns, regular_items columns, profiles table).
- **Screens:** Debts (summary cards, active/paid cards, progress, payment +
  edit/delete dialogs), Regular Purchases (one-tap log → real transaction,
  icon/color pickers), Settings (home/default currency, date format, theme,
  Hijri toggle + −7…+7 offset stepper + calendar mode, account/sign-out),
  Family (member cards grouped by email, per-account access levels,
  shared-with-me section).
- **Edit/delete everywhere:** transactions (tap row; transfer legs delete as a
  pair), accounts (archive, delete blocked while history exists), categories
  (delete reparents children), budgets. **Transfers:** two paired rows with
  FK-safe insert order (out→in→backlink), cross-currency converted+frozen.
- **Settings are live:** theme + home currency + hijri offset come from the
  profiles row (PowerSync) and drive the whole app; hijri snapshots at write
  time honor the offset.

### Update 2026-06-11 (second pass) — polish toward legacy look

- **Icon pills everywhere:** shared `core/icon_pill.dart` (lucide-name →
  Material map, `IconPill` widget, palette). Category dialog gained the legacy
  icon picker (18 icons) + colour palette; categories list and transaction
  rows render colored pills (transfer/debt rows get type pills).
- **Date format applied:** `DateFormatService` + `dateFormatProvider`; used in
  transactions list and dashboard recents. Dashboard rows now prefer the
  immutable Hijri *snapshot* (`tx.hijriDate`) over recomputing, and honor
  `showHijri`.
- **Live FX:** local `fx_rates` table added to the PowerSync schema;
  `fxProvider` = seed snapshot merged under synced rows (numeric-as-text safe).
  Seed data in migration 0003. Rates still need a refresher job eventually.
- **Reports:** range filter (this/last month, 3 months, year, all) +
  income/expense/net mini-stats + % per category.

**USER MUST RUN (in order):**
1. Migrations `0002_regular_items_columns.sql` and `0003_seed_fx_rates.sql`
   against the Supabase project (SQL editor or `supabase db push`).
2. PowerSync dashboard → Sync Streams: add

   ```yaml
   profiles:
     auto_subscribe: true
     query: SELECT * FROM profiles WHERE id = auth.user_id()

   fx_rates:
     auto_subscribe: true
     query: SELECT code AS id, code, rate FROM fx_rates
   ```

   If the `transactions` / `regular_items` streams use `SELECT *`, the new
   columns flow automatically; deploy AFTER the migrations so reprocessing
   backfills them.
3. `cd packages\domain && dart test` then `cd ..\data && dart test`
   (~40 tests should be green).
4. `cd apps\pocket_app && flutter analyze && flutter run -d chrome --web-port=5000`
   (full restart — the local SQLite schema changed) and walk: record debt →
   account balance moved → record payment → auto-paid at 100% → delete debt
   (keep payments) → payments unlinked. Then: set a category colour/icon →
   pill shows on its transactions; switch date format in Settings → lists
   update; check Reports ranges.

### Update 2026-06-11 (third pass) — sync fixes + splits/reconcile/accounts

- **Sync root causes fixed:** `path_provider` throws on web → DB never opened
  → silent sample mode (now web-safe path + sidebar sync-status tile);
  connector now type-coerces uploads (`tags` CSV→array, 0/1→bool, ''→null for
  uuid cols) and logs+skips rejected rows instead of jamming the queue.
- **Dropdown hardening:** every dialog sanitizes stored ids against the
  actual dropdown items (fixes the "exactly one item with value: salary"
  assertion); sample-data category ids fixed.
- **Splits UI:** expense transactions can be split across categories (rows
  must sum to the total; validated in dialog AND controller; split row ids
  generated at insert — PowerSync requires them).
- **Accounts:** icon + colour pickers, pills in the list, Archived section
  (repos now return archived rows; pickers/totals use `activeAccountsProvider`).
- **Reconcile:** enter the account's actual balance → difference booked as an
  `adjustment` transaction (the legacy modal's compensating-entry path; the
  "overwrite stored balance" path is obsolete in the derived-balance model).

### Update 2026-06-11 (fourth pass) — recurring transactions

- **Recurring:** `RecurringSpec` on `LedgerTransaction` (template = has spec;
  instance = has `recurringSourceId`), pure `RecurringGenerator` ports the
  legacy `RecurringService.process()` with its hardening (transfer skip B5,
  day-of-month anchoring I4, 500-instance safety) and is unit-tested
  (`recurring_generator_test.dart`). Instance ids are **UUIDv5 of
  (template, date)** so multi-device backfill collides instead of
  duplicating. `RecurringProcessor` runs on every ledger emission from
  AppShell (idempotent). "Repeat" picker in the transaction dialog
  (daily/weekly/monthly/yearly). Local schema: `recurring` (JSON text) +
  `recurring_source_id` columns on transactions; jsonb upload as Map.
  Requires a **full restart** (local schema change). `SELECT *` sync streams
  pick the columns up automatically.
- Sidebar: live sync status moved below the account row (static "Synced"
  label removed).

### Update 2026-06-11 (fifth pass) — CSV export + FX refresher

- **CSV export:** `CsvExportService` is a faithful port of legacy
  `exportCsv` — same column set as the import template; transfers emit one
  row from the out-leg (To* columns, cross-currency aware); debt initial
  rows carry borrowed/lent + DueDate + DebtRef; splits emit one row per
  split keyed by SplitOf; RFC-4180 quoting. Buttons in Settings → Data
  (30/90 days, all time). Platform-aware saver: browser download on web
  (conditional import), documents folder on mobile.
- **FX refresher:** `FxRefreshService` ports `ExchangeRateService` —
  open.er-api.com USD base, refreshes at most every 6 h based on the table's
  newest `updated_at` (first device of the day refreshes for the family),
  upserts into `fx_rates`, non-fatal on failure. Fired once per session from
  AppShell. **Requires migration 0004** (authenticated write policy on
  fx_rates) and `flutter pub get` (new dep: `http`).

### Update 2026-06-11 (sixth pass) — CSV import

- **CSV import** (Settings → Data → Import CSV, web-first): faithful port of
  legacy `#parseCsv`/`#parseImportDate`/`#buildImportPlan`/`commitImport`.
  RFC-4180 parser (BOM/quotes/CRLF), normalized headers, type aliases
  (debit/credit/borrow/lend), date preference for ambiguous slash dates,
  account auto-create (type/icon/colour guessed, currency by majority vote
  of rows), categories parents-before-children, SplitOf rows merged into one
  split transaction, transfers via the FK-safe controller, borrowed/lent
  rows via DebtController (debt row + principal posting), duplicate
  fingerprinting (date|amount|currency|account|payee) with an "include
  duplicates" toggle in the preview dialog. Template download button
  included. Pure planning in `CsvImportService`; commits in
  `CsvImportController`. NOTE: file picking is web-only for now (mobile
  needs the file_picker plugin); legacy's "replace all data" option was
  intentionally dropped (destructive + sync-hostile).
- **Fix (same day):** the web file reader had a subscribe-after-read race —
  a fast read completed before the load listener attached, the picker
  returned an empty string, and import reported "no importable rows".
  Reader now subscribes to `onLoadEnd` BEFORE `readAsText` and surfaces
  reader errors. Import failures are now diagnosable: the snackbar reports
  parsed-row count, characters read, and a per-reason skip tally (parser
  verified by simulation against CRLF/BOM/semicolon/empty inputs).

### Update 2026-06-11 (seventh pass) — AI receipt scan

- **Receipt scan** ported from legacy `ReceiptScanService` (gemini-2.5-flash-
  lite): prompt injects REAL category ids (no fuzzy matching), image part
  first, temperature 0.1, response sanitised (first-JSON extraction, id
  validation, ISO-date check, total falls back to item sum). Key lives in
  Settings → AI Receipt Scanner and is **device-local only**
  (shared_preferences / localStorage — never synced, legacy parity). Scan
  button in Add transaction (scanner icon in the title) prefills payee, date,
  per-item note, amount and per-category splits. Web-first (uses the browser
  picker); mobile needs image_picker. New dep: `shared_preferences` →
  `flutter pub get`.
- Deviation noted: the dialog's amount fields are denominated in the chosen
  account's currency; the receipt's detected currency is shown in the
  confirmation snackbar + note rather than forcing an FX panel (legacy had a
  full multi-currency transaction modal — port that when the FX panel comes).

### Update 2026-06-11 (eighth pass) — FX panel, mobile pickers, deploy

- **FX panel:** expense/income can be entered in ANY currency — picker next
  to the amount, live "≈ X in account currency" hint; on save the account
  impact is rate-frozen into `acctMinor` and `exchangeRate`/
  `refAmountMinor` snapshot the tx→home conversion (legacy semantics).
  Splits follow the tx currency. Transfers stay in the source account's
  currency by design.
- **Mobile pickers:** CSV import + receipt scan now work on Android/iOS via
  `file_picker` (new dep → `flutter pub get`); web keeps the dependency-free
  browser paths. Cancel is silent on all platforms.
- **Deploy:** `.github/workflows/deploy-web.yml` — builds with
  `--base-href /<repo>/` (auto-derived), runs domain+data tests, runs
  `powersync:setup_web`, copies `index.html`→`404.html` for SPA deep links,
  publishes via GitHub Pages actions. One-time: repo Settings → Pages →
  Source = GitHub Actions; add the Pages URL to Supabase Auth redirect URLs
  for Google sign-in.

### Update 2026-06-11 (ninth pass) — migration tool, audit, B1, Calendar

- **Migration tool:** `tools/migrate_legacy_blob.dart` converts the legacy
  Settings → Export JSON into idempotent SQL (deterministic UUIDv5 ids,
  `opening_balance` back-computed from the stored balance, `__USER_ID__`
  placeholder, warnings for cross-currency impacts). Usage at the top of
  the file.
- **Parity audit:** `docs/06-parity-audit.md` — full discrepancy/bug/
  improvement list. Fixed from it already: **B1** (dashboard + reports now
  aggregate via `LedgerMath.homeAmount`, preferring the frozen
  `refAmountMinor` snapshot; report splits scale the snapshot
  proportionally) and **A2-12** (receipt scan activates the FX panel with
  the detected currency).
- **Calendar view:** month grid (Sunday-first) with Gregorian+Hijri day
  labels per the calendarMode setting, miqaat stars (bundled
  `assets/miqaats.json`, ported from the Mumineen calendar; year-specific
  entries skipped), per-day spend, and a day sheet with miqaats, that day's
  transactions, and quick-log chips that book regular items onto that date.
  New nav entry after Transactions. `flutter pub get` not needed; full
  restart recommended (new asset).

**Still open (see audit §A/§C for the full list):** AccountDetail page,
onboarding/seed categories, payment-type picker + custom types, merchant
auto-categorization, transaction search/filters, inbound-share owner email,
shared-account sync stream, `LedgerTransaction.copyWith` refactor, repo
contract tests, CI analyze workflow.

## 7. Roadmap (suggested order)

1. **Fix persistence** (§4) and confirm round-trip to Supabase. ← do first
2. **Debts** screen (borrowed/lent + payments), then **Settings** (home
   currency, theme persistence, sign-out), **Regular Purchases**, **Family**.
3. **Edit/delete + transfers + splits** on transactions; account edit/archive.
4. Category **colors/icons** + the legacy icon-pill transaction rows; polish
   dashboard/widgets to match `legacy-web/` pixel-for-pixel.
5. **Receipt scan** (Gemini), **reports** range/trends, **recurring** generation.
6. Profile sync (settings table), **FX refresh** edge function.
7. **Deploy**: GitHub Actions → Flutter Web on Pages; plan the blob→rows
   migration for existing users; cut the web domain over from `legacy-web/`.

## 8. How to run / test

```
# domain + data tests (Windows)
cd packages\domain && dart test
cd ..\data && dart test

# the app
cd apps\pocket_app
dart run powersync:setup_web        # one-time, for web persistence
flutter pub get
flutter run -d chrome --web-port=5000
```

## 9. Working style notes

- Keep **strict OOP / clean architecture**: domain is framework-free; the data
  layer implements domain ports; the UI reads providers, never reaches into
  Supabase/PowerSync directly except through repos. Match `legacy-web/` for
  feature behavior and look.
- Build **one screen/feature per pass**, run `flutter analyze` + hot restart,
  fix from real errors. The owner runs commands and pastes results/screenshots.
