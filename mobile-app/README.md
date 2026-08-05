# Pocket Mobile

React Native (Expo) companion to the Pocket web app. **It shares the web app's
entire business layer** — the files in `src/core`, `src/data` and
`src/domain/services` are the same audited code from `legacy-web/src`, copied
verbatim: LedgerMath, CurrencyService, BudgetService (Hijri periods included),
RecurringService, StateMigrator, the works. Both apps speak the same versioned
CAS protocol against the same Supabase `user_data` row, so web and mobile read
and write **one book**.

## Run it

```bash
cd mobile-app
rm -rf node_modules package-lock.json   # required if you installed a different SDK before
npm install
npx expo start -c                       # -c clears the Metro cache
```

Deleting `package-lock.json` is not optional when the SDK has changed. A lock
file from a previous SDK makes npm **nest** packages under
`node_modules/expo/node_modules/` instead of hoisting them, and Babel resolves
presets relative to `babel.config.js` at the project root — so a nested
`babel-preset-expo` produces `Cannot find module 'babel-preset-expo'` even
though the package is physically installed.

Scan the QR code with the **Expo Go** app (Android: Play Store, iOS: App
Store). The app runs fully offline/local by default.

### Pinned to Expo SDK 54 — on purpose

Expo Go from the app stores runs exactly **one** SDK, and it lags npm's
`latest` tag by a long way. npm currently publishes `expo@57`, but the store
build of Expo Go is on **SDK 54** — so anything newer gives
*"Project is incompatible with this version of Expo Go"*, no matter how
recently you updated the app.

**The one authoritative source** for what Expo Go actually runs:

```bash
curl -s https://api.expo.dev/v2/versions/latest | grep -o '"expoGoSdkVersion":"[^"]*"'
```

Then take that SDK's exact package versions from its own manifest, rather
than guessing or trusting npm `latest`:

```bash
npm pack expo@54.0.36 && tar xzf expo-54.0.36.tgz
cat package/bundledNativeModules.json
```

`app.json` also pins `"sdkVersion": "54.0.0"` so the served manifest can never
silently disagree with `node_modules`.

**Two things that do NOT fix this error:**

- Updating Expo Go from the Play Store — it is already as new as it gets; the
  project is what's too new.
- `npx expo install --fix` — it aligns every package to the SDK named in
  `package.json`, so with the wrong SDK there it pins everything else wrong too.

To move to a newer SDK later, wait until `expoGoSdkVersion` reports it, then
re-derive the version set from that SDK's `bundledNativeModules.json`.

## Sync (optional)

Settings → enter your email → enter the one-time code.

Three Supabase settings to do once (dashboard → Authentication):

1. **Email provider enabled** — the mobile app signs in with emailed codes,
   because the web's Google OAuth needs a browser redirect Expo Go can't
   complete (see "Google sign-in" below).

2. **Magic Link template must contain `{{ .Token }}`** — otherwise you get a
   *link* in your inbox instead of a code. This catches everyone: Supabase's
   `signInWithOtp()` and magic links are the *same* endpoint, and which one the
   user receives is decided purely by the email template. Per Supabase's docs:
   *"Though the method is labelled 'OTP', it sends a Magic Link by default. The
   two methods differ only in the content of the confirmation email."*

   Go to **Authentication → Email Templates → Magic Link** and set the body to
   something like:

   ```html
   <h2>Sign in to Pocket</h2>
   <p>Enter this code in the app:</p>
   <p style="font-size:28px;letter-spacing:4px;"><b>{{ .Token }}</b></p>
   <p>It expires in 1 hour. If you didn't request it, ignore this email.</p>
   ```

   Keep `{{ .ConfirmationURL }}` out of it, or you'll get both and it's
   ambiguous which to use. Codes are six digits.

3. **Account linking** — signing in by email resolves to the same user as your
   Google sign-in only when linking is enabled for matching addresses.
   Otherwise it would create a second, empty book. Check before relying on it.

### "Email rate limit exceeded"

Supabase's **built-in** mailer allows **2 emails per hour, project-wide**, and
that specific limit is the one thing you cannot raise in the dashboard — their
rate-limit table marks it *"Custom SMTP Only"*. Two sign-in attempts and you're
blocked for the rest of the hour.

Worth knowing: you only need to sign in **once per device**. The session is
stored in AsyncStorage with `autoRefreshToken`, so it survives app restarts and
you shouldn't need another code.

If it becomes a nuisance while developing, either:

- **Add custom SMTP** (Authentication → Emails → SMTP Settings). Resend, Brevo
  and Mailgun all have free tiers in the thousands per month. The cap then
  becomes configurable under Authentication → Rate Limits.
- **Switch to email + password.** With *Confirm email* disabled it sends no
  email at all, so no cap can apply — a sensible choice for a personal
  single-user app.

## Building a real app (EAS) + native Google sign-in

Expo Go is only the dev host. To get a standalone installable app — and to
enable **native Google sign-in** — build with EAS. `eas.json` ships three
profiles: `development` (dev client, internal APK), `preview` (sideloadable
APK), `production` (Play Store AAB).

### 1. Development build (do this first)

```bash
cd mobile-app
rm -rf node_modules package-lock.json
npm install
npx expo install expo-dev-client @react-native-google-signin/google-signin  # pin to SDK 54
npm i -g eas-cli
eas login
eas build --profile development --platform android
```

Install the resulting APK on your phone, then run `npx expo start --dev-client`.
It behaves like Expo Go (hot reload) but includes native modules — so the
"Continue with Google" button in Settings now works. Pure JS/React changes
never need another build; only adding/changing a **native** module does.

When you're happy: `eas build --profile preview --platform android` gives a
standalone APK; `--profile production` gives a Play Store AAB.

### Over-the-air JS updates (EAS Update)

`app.json` sets `runtimeVersion: { policy: "appVersion" }` and each build
profile in `eas.json` has a matching **channel** (development / preview /
production). That means a build can pull new **JavaScript** over the air
without rebuilding — you only rebuild when native code changes (and you signal
that by bumping `version`, which bumps the runtime version).

One-time wiring:

```bash
npx expo install expo-updates
eas update:configure          # adds updates.url + extra.eas.projectId to app.json
eas build --profile preview --platform android   # embed the updates client once
```

Then ship a JS-only change to everyone on that channel:

```bash
eas update --channel preview --message "fix budget rounding"
```

Installed apps fetch it on next launch — no new APK, no store review. Rules of
thumb: same `version` → OTA is fine; changed a native module or bumped
`version` → build a new binary. (If an SDK 54 project ever rejects the
`appVersion` policy, switch `runtimeVersion` to `{ "policy": "fingerprint" }`
and re-run `eas update:configure`.)

### 2. Google sign-in setup (one-time)

Native Google auth needs OAuth client IDs and a Supabase provider. In **Google
Cloud Console → Credentials** create OAuth client IDs:

- **Web** client — its ID is the `webClientId` the app sends to get an ID token,
  and it's the one Supabase uses. Add your Supabase callback
  (`https://<project>.supabase.co/auth/v1/callback`) as an authorized redirect.
- **Android** client — package `com.mufaddal.pocket` + the SHA-1 fingerprint of
  the signing key EAS uses (`eas credentials` → Android → shows the SHA-1).
- **iOS** client (only when you build iOS) — bundle id `com.mufaddal.pocket`;
  then add its reversed id as `iosUrlScheme` in the `@react-native-google-signin`
  plugin block in `app.json`.

In **Supabase → Authentication → Providers → Google**: enable it and paste the
**Web** client ID + secret. Turn on account linking if you want Google and the
web app to resolve to the same book.

Finally, expose the client IDs to the app as public env vars (inlined at build):

```bash
# mobile-app/.env
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=yyyyyyyy.apps.googleusercontent.com   # iOS only
```

`MobileSyncService.signInWithGoogle()` reads these, gets the Google ID token via
`@react-native-google-signin/google-signin`, and calls Supabase
`signInWithIdToken({ provider: 'google', token })`. In Expo Go (no native
module) the button just shows a friendly "needs a development build" message —
it never crashes the bundle, since the module is required lazily.

Email one-time codes keep working everywhere as the fallback.

## Scope — full parity

Everything the web app does, on the phone:

- **Dashboard** — net worth, month in/out, recent activity
- **Transactions** — expense/income/transfer, splits, the two-step category
  picker with quick-add, and **receipt scanning** (pick a photo → Gemini
  pre-fills the form; needs an API key in Settings)
- **Accounts** — grouped, opening-balance adjustments, currency re-denomination
- **Budgets** — Gregorian and Hijri periods, the same BudgetService math
- **Debts** — borrow/lend, repayments, and the audited delete (keep-or-remove
  transactions) and mark-paid (paid-now vs settled-outside) choices
- **Reports** — spend-by-category and a daily sparkline over a selectable range
- **Categories** — the parent→child tree, add/rename/delete (delete blocked
  while any transaction or split leg references it)
- **Regular items** — quick-log recurring buys; deleting keeps logged history
- **Family sharing** — full live protocol: grant per-account access, contribute
  to accounts others share with you, edit/delete your contributions. Owner-side
  permission checks, edit-as-replace, and revocation all match the web audit
  (findings H6/H8/H9/M8). Web and mobile hit the same tables.
- **Settings** — sync, home currency, Hijri offset, payment-method manager,
  Gemini key, JSON + CSV export via the share sheet

Navigation: five tabs (Dashboard · Transactions · Accounts · Budgets · More);
More routes to Debts, Reports, Categories, Regular items, Family, Settings.

Screen depth now matches the web: tapping an **account** opens its full ledger
(month/lifetime stats + day-grouped transactions); tapping a **budget** opens a
detail (per-category breakdown + the period's transactions) and budgets are
editable with rollover; **debts** are editable with due dates, progress and
active/paid sections; **Regular items** has a month **calendar** with per-day
dots + a summary; **Transactions** has range/type/sort filters, multi-select
bulk delete and month subtotals; the **transaction form** supports recurring
rules, a manual FX rate on cross-currency transfers, and per-split accounts;
**Reports** adds net-worth-over-time, biggest transactions and a Hijri-month
breakdown; **Settings** adds light/dark/system theme, default currency, date
format, the Hijri on/off + calendar-mode selectors, JSON backup **restore**
(paste), balance recalculation, and reset. Categories are editable with a
colour and icon picker.

Still intentionally **not** ported: CSV *import* (would need a document picker;
CSV *export* is present) and the account-group bulk-manage sheet (accounts
still carry groups, shown grouped on the Accounts screen). Balance
*reconciliation* is unnecessary on mobile — balances are always recomputed from
the ledger on every save, so they cannot drift; a "Recalculate balances" action
in Settings makes that explicit.

## Architecture

```
src/core      Store, EventBus, Repository (AsyncStorage adapter, injected backend)
src/data      constants, seed, StateMigrator      ← verbatim from legacy-web
src/domain    all services + TransactionComposer  ← verbatim + 2 mobile files
src/state     AppContext (React binding), PickerBus
src/ui        theme + small shared components
src/screens   Dashboard · Transactions · Accounts · Budgets · Settings
              + TransactionForm and CategoryPicker modals
App.js        navigation shell
```

Mobile-only domain files (everything else is copied verbatim from legacy-web):
`Repository.js` (async→sync bridge over AsyncStorage, injectable backend),
`MobileSyncService.js` (the web SyncService's CAS + family protocol, with
email-code auth), `DebtService.js` (debt CRUD/repay/delete extracted so screens
and tests share one authority), and
`TransactionComposer.js` (the web `submitTx` invariants as a framework-free
class — transfer pairing, type conversions, source-currency lock, exact split
sums).

## Tests

```bash
npm run test:domain
```

Runs the ported domain under plain node — no emulator needed. Two suites:

- `test/domain.test.mjs` (30 assertions): C3/C4 transfer conversions, H4
  currency lock, L1 split sums, M4/M5 recurring, M9 transient-key stripping,
  plus reports roll-up and the debt keep-delete.
- `test/family.test.mjs` (10 assertions): the live add/delete round-trip and
  the sharing audit protections — H6 edit-as-replace, H8 revocation, and H9
  authorisation (a stranger and an out-of-grant member are both rejected).

Each fix was mutation-verified: reverting it turns the matching assertion red.

## Keeping domain code in sync with the web

The domain files are a copy, not a symlink — when you change
`legacy-web/src/domain`, re-copy the changed file here and re-run both test
suites. The one intentional difference: `Repository` and `IdGenerator` have
platform adaptations (marked with comments).

## `npm audit` warnings

A fresh install reports a few dozen advisories. **Do not run
`npm audit fix --force`** — it resolves advisories by bumping packages, which
will move `expo` / `react-native` off the SDK 54 pin and put you straight back
to *"incompatible with this version of Expo Go"*.

Practically all of these sit in the **build toolchain** (Metro, the Expo CLI
and their transitive dependencies) — code that runs on your laptop while
bundling, not code shipped inside the app on your phone. To see only what could
reach runtime:

```bash
npm audit --omit=dev
```

Expo pins its toolchain deliberately; advisories there are normally cleared by
moving to a newer SDK once Expo Go supports it, not by overriding versions
locally.

## Notes

- The package is CommonJS-default (no `"type": "module"`), which is what Metro
  and `babel.config.js` expect. The node test is a `.mjs` file, so it still
  runs as ESM without forcing the whole package to be a module.
- Pinned set: Expo SDK 54.0.36 · React Native 0.81.5 · React 19.1.0 ·
  async-storage 2.2.0 · safe-area-context ~5.6.0 · screens ~4.16.0. These come
  from SDK 54's own `bundledNativeModules.json`, not from npm `latest`.
