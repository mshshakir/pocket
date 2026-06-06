# Flutter architecture, folder reorg & migration plan

**Status:** proposal for approval. No files are moved and no Flutter project is
created until you sign off. The existing web app keeps running throughout.

## Goal

One Dart codebase that builds **iOS + Android + Web** (Flutter Web replaces the
vanilla-JS web app at the end). That gives a single implementation of the
business logic, so the "two datasets / two brains" problem never exists — every
platform shares the same `domain` package and the same Supabase backend (doc 01).

## Guiding principles (OOP / SOLID / best practices)

- **Clean / layered architecture.** Dependencies point inward:
  `presentation → application → domain ← data`. The `domain` layer is pure Dart
  (no Flutter, no Supabase) and defines entities + repository *interfaces*; `data`
  provides the implementations. This is the Dependency Inversion Principle in
  practice and keeps the math unit-testable in isolation.
- **Feature-first** folders (transactions, accounts, budgets, calendar, family,
  sync) so each feature is self-contained and the codebase scales.
- **Single source of business logic.** `LedgerMath`, `CurrencyService`,
  `BudgetService`, `HijriCalendarService`, `RecurringService`, `StateMigrator`
  are ported once into the pure `domain` package and reused by every platform.
- **Same golden tests as today.** We extract input→expected vectors from the JS
  logic and run them against the Dart port, so behaviour is provably identical
  during the transition (and the SQL `account_balances` view is a third check).

## Recommended stack

| Concern | Choice | Why |
|---|---|---|
| State mgmt + DI | **Riverpod** | compile-safe, testable, no `BuildContext` coupling; clean DI for repos/services |
| Local database | **Drift** (SQLite) | type-safe SQL, works on iOS/Android/**Web** (wasm), mirrors the Postgres model |
| Backend client | **supabase_flutter** | auth, Postgres, realtime, storage |
| Offline sync | **PowerSync** *(evaluate)* or hand-rolled outbox | PowerSync gives Supabase offline-sync out of the box |
| Routing | **go_router** | declarative, deep links, web URLs |
| Models/serialization | **freezed** + **json_serializable** | immutable value objects, less boilerplate |
| Charts | **fl_chart** | replaces the current Chart.js usage |
| Monorepo tooling | **melos** | manage the app + packages together |
| Tests | flutter_test, golden, integration_test | unit (domain), widget, e2e |
| CI/CD | GitHub Actions + **fastlane** | build/test/deploy to both stores |

## Target repository layout (monorepo)

```
pocket-budget/                      # repo root (your current repo, reorganized)
├── apps/
│   └── pocket_app/                 # the Flutter application (iOS/Android/Web)
│       ├── lib/
│       │   ├── main.dart
│       │   ├── app.dart            # root widget, router, ProviderScope (DI)
│       │   ├── core/               # theme, l10n, errors, router, env, di
│       │   └── features/
│       │       ├── transactions/
│       │       │   ├── presentation/   # screens, widgets, controllers
│       │       │   ├── application/     # use cases (orchestration)
│       │       │   ├── domain/          # feature entities + repo interfaces
│       │       │   └── data/            # repo impls, DTOs, mappers
│       │       ├── accounts/  budgets/  calendar/  debts/
│       │       ├── family/    settings/  sync/
│       ├── test/  integration_test/
│       ├── android/  ios/  web/    # Flutter-generated native shells
│       └── pubspec.yaml
├── packages/
│   ├── domain/                     # PURE Dart: entities + business logic
│   │   ├── lib/ (ledger_math.dart, currency_service.dart, budget_service.dart,
│   │   │         hijri_calendar.dart, recurring_service.dart, state_migrator.dart)
│   │   └── test/ (golden vectors ported from the JS app)
│   ├── data/                       # Supabase + Drift repos implementing domain ports
│   └── ui_kit/                     # design system: shared widgets, tokens, icons
├── supabase/
│   ├── migrations/                 # the SQL from doc 01 (schema + RLS + views)
│   └── functions/                  # edge functions (fx refresh, blob migration)
├── legacy-web/                     # ← the CURRENT vanilla-JS app, moved here as-is
│   └── (src/, bundle.js, index.html, build.bat, …)  still builds & deploys
├── docs/                           # these design docs
├── melos.yaml
└── README.md
```

## Folder reorg — exactly what moves (non-destructive, reversible)

This is the "clean up my folder" part. Proposed steps, done in git so every move
is tracked and revertible:

1. Create `legacy-web/` and `git mv` the existing web app into it: `src/`,
   `bundle.js`, `index.html`, `app.html`, `graph.html`, `privacy.html`,
   `index-compare.html`, `build.bat`, `deploy-to-github.ps1`, `check-deploy.ps1`,
   `package.json`, `package-lock.json`, `node_modules/` (gitignored),
   `mumineen_calendar_js-main/`. The web app keeps working from there unchanged.
2. Delete the stray empty marker files at the repo root (`AccountService`,
   `BudgetService`, `CategoryService`, `TransactionService`, `$null`) and the
   `*.js.tmp` scratch files, and add them to `.gitignore`.
3. Scaffold `apps/pocket_app`, `packages/{domain,data,ui_kit}`, `supabase/`,
   `melos.yaml` as above.
4. Move `docs/` (already created) up to the new root.
5. Update deploy scripts to point at `legacy-web/` until Flutter Web cuts over.

Nothing is deleted that has value; the web app is relocated, not removed. I will
list the precise `git mv` commands for your approval before running any of them.

## How the layers map to your existing code

| Today (JS) | Becomes (Dart) | Layer |
|---|---|---|
| `LedgerMath`, `CurrencyService`, `BudgetService`, `HijriCalendarService`, `RecurringService`, `StateMigrator` | same classes, pure Dart | `packages/domain` |
| `Store`, `Repository`, `SyncService` | repository impls + sync engine over Drift + Supabase | `packages/data` |
| `EventBus`, `Router` | Riverpod providers + go_router | app `core` |
| views/modals (`*.View`, `*.Modal`) | Flutter screens/widgets + controllers | `features/*/presentation` |
| `Html` escaping helpers | not needed (Flutter widgets aren't string-interpolated HTML — whole XSS class gone) | — |

## Build & migration sequence (no big-bang)

1. **Backend:** apply doc 01 schema + RLS to a *new* Supabase project (or schema)
   alongside the existing one; write the blob→rows migration; verify balances.
2. **domain package:** port the six logic classes to Dart with golden tests
   green against the JS vectors.
3. **data package:** Drift local DB + Supabase repos + offline sync (outbox or
   PowerSync).
4. **app:** build features mobile-first (transactions → accounts → budgets →
   calendar → family → settings), wiring presentation to use cases.
5. **Beta on iOS + Android** via TestFlight / Play internal testing.
6. **Enable Flutter Web**, reach parity, then point the web domain at it and
   retire `legacy-web/`.

## What I need from you to start building

1. Approve (or amend) the **schema/RLS** in doc 01 and the **stack choices**
   above (esp. Riverpod, Drift, and PowerSync-vs-outbox).
2. Approve the **folder reorg steps** (I'll show the exact `git mv` list first).
3. Confirm a **new Supabase project/schema** is OK for the parallel build.

On approval I'll proceed in this order: folder reorg (git-tracked) → `melos`
workspace + package scaffolding → `domain` port with passing golden tests →
backend migration → first vertical slice (transactions) on device.
