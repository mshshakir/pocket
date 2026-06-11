# Flutter migration — progress & how to continue

_Last updated: 2026-06-07_

This is the running status of the move from the vanilla-JS web app to a single
Flutter codebase (iOS + Android + Web) on a normalized Supabase backend. Read
`docs/01-backend-schema.md` and `docs/02-flutter-architecture.md` for the full
design; this file is the "where we left off" pointer.

## Decisions locked

- **One Flutter codebase** for iOS + Android + Web (Flutter Web eventually
  replaces the JS app). The JS app stays live as `legacy-web/` until parity.
- **Normalized Supabase schema + Row-Level Security** for sharing (replaces the
  JSON-blob + snapshot/contribution model).
- **Offline sync: PowerSync.** Free tier is fine for personal/family scale; a
  Free instance only deactivates after 7 days with **no client connections**, so
  ~weekly use keeps it alive. Pro ($49/mo) or self-host removes that caveat.
- **Stack:** Riverpod (state/DI), Drift (local SQLite, cross-platform incl. web),
  go_router, PowerSync, fl_chart, melos.

## Repo layout

```
apps/pocket_app/        Flutter app (runnable dashboard slice)
packages/domain/        PURE Dart business logic — the shared brain
packages/data/          repository ports' impls (in-memory today; Drift/Supabase next)
packages/ui_kit/        design-system widgets (skeleton)
supabase/migrations/    0001_init.sql — schema + RLS + balances view
legacy-web/             the current JS app (kept until cutover)
docs/                   design + this note
```

## Done and verified (pure Dart — `dart test` green)

- **`packages/domain`** — ported faithfully from the hardened JS, with golden tests:
  - `CurrencyService` (convertStrict throws / convert returns 0; minor-unit math)
  - `LedgerMath` (+ entities) — rate-frozen `acctMinor` preferred over live FX
  - `HijriCalendar` (AJD math; fixed the JS-0-based vs Dart-1-based month bug)
  - `CategoryTree` (recursive, cycle-safe `descendants`)
  - `BudgetService` (period/rollover spend), `Recurrence.stepDate` (anchor+clamp)
  - repository **ports**: Account/Transaction/Category/Budget repositories
- **`packages/data`** — pure + tested:
  - `row_mappers.dart` — entity ↔ DB/JSON row for all four aggregates, keyed to
    the `0001_init.sql` columns. **This is the schema↔entity contract; the
    Drift and Supabase repos must both go through it.**
  - in-memory repositories implementing every port (runnable + tests)
- **`apps/pocket_app`** — clean-architecture scaffold; dashboard reads repository
  streams and derives balances/net-worth via the domain. Runs today on the
  in-memory backing.
- **`supabase/migrations/0001_init.sql`** — apply to a NEW Supabase project via
  `supabase db push` or the SQL editor (uses `auth.users` / `auth.uid()` /
  `auth.jwt()`).

### Run / test
```
cd packages\domain
dart test
cd ..\data
dart test
cd ..\..\apps\pocket_app
flutter create --platforms=android,ios,web --org com.mshshakir.pocket --project-name pocket_app .
flutter pub get
flutter run -d chrome
```

## What's left (needs the Flutter SDK + a live Supabase — do with the compiler)

These were intentionally NOT written blind, because Drift uses `build_runner`
code-gen and PowerSync's API is version-specific; writing them without compiling
would hand over likely-broken files.

1. **Drift local DB** — table classes mirroring the schema, `@DriftDatabase`,
   `dart run build_runner build`. Implement the repository ports over Drift's
   reactive `.watch()` queries, converting rows with `row_mappers.dart`.
2. **Supabase + PowerSync** — PowerSync schema + Supabase connector + sync rules
   that mirror the RLS in `0001_init.sql`; the repos read/write the PowerSync
   local DB and sync in the background.
3. **Swap the app** — replace the in-memory providers in
   `features/dashboard/application/dashboard_providers.dart` with the real repos
   (no widget changes needed).
4. **Build features** — transactions (create/edit incl. the FX panel behaviour),
   accounts, budgets, calendar, family sharing, settings, receipt scan (Gemini),
   reports (fl_chart).
5. **blob→rows migration** — one-time script to expand existing users'
   `user_data` JSON into the normalized tables, verified against the
   `account_balances` view, for cutover.
6. **Deploy** — GitHub Actions workflow building Flutter Web with
   `--base-href "/pocket/"` + a `404.html` SPA fallback (replaces the single-file
   PowerShell upload when ready).

## Environment gotchas (important)

- The repo is **OneDrive-synced**. The Cowork Linux sandbox serves stale/partial
  copies of recently-edited files and **cannot manage the `.git`** (it leaves
  stuck `*.lock` files that block git on the Windows side). **Run all git +
  Flutter/Dart builds on the Windows machine.** Use the sandbox only to
  read/write source.
- The committed `legacy-web/node_modules` holds a Windows esbuild binary; rebuild
  the JS bundle on Windows (`build.bat`).
