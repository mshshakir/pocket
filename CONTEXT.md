# Pocket — session context / handoff

> **KEEP THIS UPDATED.** At the end of any substantial session, revise this file:
> bump _Last updated_, move finished items out of _Pending_, and add a one-line note
> under _Recent changes_ for anything that alters architecture, contracts, or workflow.
> Paste this whole file into a new chat to bring a fresh session up to speed.
> It complements the auto-memory (see _Memory_ below) — this is the human-readable brief.

**Last updated:** 2026-08-15 (mobile port same day)

---

## Project

Pocket, a personal-finance app. Root: `M:\BudgetApp\Budget App`.

**Two codebases, one backend:**

- `legacy-web/` — vanilla-JS ES-module SPA. `app.js` is loaded as `<script type="module">` in
  `app.html`. An esbuild IIFE artifact `bundle.js` exists but **no HTML references it** (the app runs
  from `src/app.js`); rebuild it anyway after web changes:
  `npx esbuild src/app.js --bundle --format=iife --global-name=_PocketApp --outfile=bundle.js`
- `mobile-app/` — React Native + Expo **SDK 54 (pinned ~54.0.36; Android only)**. `src/core`,
  `src/data`, `src/domain/services` are **verbatim copies** of `legacy-web/src`. When web domain
  changes, re-copy the file into mobile and run both suites.
- Backend: one Supabase book. Versioned compare-and-swap on `user_data`; `family_shares` +
  `family_contributions` tables; realtime channels (web + mobile both guard self-writes).
- Mobile rule: all expo-native imports in **screens** must be lazy `require()` (never top-level),
  so Expo Go / a build lacking the module can't crash the bundle.

## Standing preferences / constraints (always apply)

- Always follow **OOP** principles in coding.
- Do **not** attribute to Syedna Mohammed Burhanuddin RA / Syedna Mufaddal Saifuddin TUS anything not
  explicitly stated by them. **Never** give Fatimi jurisprudence comments/perspectives on any contract.
- Be **concise and direct**.
- Family live add/delete sync is **intentional** — don't regress it.
- Web feature/module variance vs mobile: **user decides**. Fix genuine bugs freely, but **ask before**
  converting other web dropdowns (Budget/Account) to chips.

## Verification (no emulator / browser in sandbox)

- **Web:** esbuild full-graph compile of `src/app.js` (`--bundle --format=esm --packages=external`) = pass.
  **Correction (2026-08-06): the jsdom smoke suites DO run in the sandbox.** `npm i -D jsdom`,
  `npm run build`, then `node src/__smoke__/<name>.smoke.mjs`. They boot `bundle.js` inside jsdom
  with `runScripts:'outside-only'` and stub `fetch`, so nothing is fetched from a CDN. Full suite
  takes ~2 min. **All 8 suites are green: 305 assertions.** Keep it that way — a red suite now
  means something real.
- **Mobile:** esbuild transpile screens with `--loader:.js=jsx --packages=external`; domain suites
  `node test/domain.test.mjs` (30) + `node test/family.test.mjs` (10).
- **Domain logic** can be node-tested: boot the Store (`Repository.setBackend` in-memory →
  `store.init(seed)`) and stub `global.fetch`.

## Recent changes

**Spaces phase 1 (2026-08-15) — WEB ONLY, additive, all existing suites still green.**
New suite `src/__smoke__/spaces.smoke.mjs` (38 assertions, in `npm run smoke`); 9 mutations
tried, all 9 bite. Full suite is now **400 assertions across 10 files**.
- **The model.** `domain/services/Space.js` is a READ model over either local state (home) or
  one `_sharedData` entry (guest). `SpaceRegistry.js` owns which is active. A shared account
  used to be a *detour* — you stayed in your own book and reached sideways — which is why
  every form that could target one had to remember to re-point its own category source.
- **One chokepoint re-points the whole view layer:** `BaseView.state` now returns
  `space.project()`. Home returns the REAL state object (identity, not a copy — a copy would
  silently break anything that legitimately mutates through it); a guest space returns a
  shallow copy with `accounts` / `categories` / `transactions` from the snapshot and
  `budgets` / `debts` / `regularItems` emptied (phase 1b adds them).
  `Store.getState()` is untouched, so the services and `SyncService` keep writing real state.
- **Active space is SESSION state** (`sessionStorage`, key `pocket.v1.space`), never
  `state.user` — it would sync to other devices where it is meaningless, and a revoked space
  must not leave a persistent pointer. A test asserts it never reaches user state.
- **Writes.** `Application.#HOME_ONLY_MODALS` refuses account/budget/category/debt/regular/
  csv/reconcile/family in a guest space with a toast. A NEW transaction there is routed into
  `sharedTxMode` **before** the modal opens, so the form comes up aimed at the owner's ledger
  rather than being corrected afterwards by `onTxAccountChange`. View-only spaces refuse it.
- **Revocation tells the user** (their answer to open question 4). `SpaceRegistry.reconcile()`
  runs on every `state:changed`. Note `active()` self-heals too, so the state reset is NOT the
  testable part — the message is. It caches `#lastLabel` while the space is live because by
  the time revocation is noticed the snapshot is gone from `sharedData` and `sharedBy` can no
  longer be read; without it the notice degrades to "Shared with me removed your access".
- **Labels.** `user.spaceLabels[ownerId]` overrides `share.sharedBy`, stored in the MEMBER's
  book so the owner's next push cannot overwrite it. Rename lives in `SpaceSheet`.
- **Audit H1 was already fixed** — the note calling it a phase-2 blocker was stale. Every
  `### ` finding in `AUDIT-2026-07.md` now carries a ✅. Spot-verified all four H1 sites.
  `docs/SPACES-DESIGN.md` corrected accordingly; phase 2 is no longer blocked.

**Mobile port of the 2026-08-15 work — and mobile had the SAME data-loss bug, worse.**
New suite `mobile-app/test/session-2026-08.test.mjs` (31 assertions, wired into `npm test`);
7 mutations tried, all 7 turn it red. `npm test` now runs domain (30) + family (10) + this.
- **MobileSyncService had every ingredient of the web failure, plus three of its own.**
  `schedulePush()` used a 1500ms trailing debounce with no cap; `#dirty` was memory-only; the
  cold-start guard `if (this.#dirty && this.#cloudVersion !== null)` cannot fire on boot
  (`#cloudVersion` starts null, `#dirty` starts false), so `#doPull` `replaceState`d the stale
  cloud row over memory AND AsyncStorage; a failed push was dropped with no retry.
  Worse than web: (a) `Repository.save()` is ASYNC and UN-AWAITED and returns `true` before
  the write is attempted, so a storage failure is structurally unreportable and there is a
  real window where nothing is on disk; (b) `flushWrites()` existed but had **zero call
  sites**; (c) **no `AppState` listener anywhere**, and Android kills a backgrounded process
  with no further JS — so the pending timer simply never fires.
  Fixed with `mobile-app/src/core/SyncJournal.js` (AsyncStorage-backed, same `baseVersion`
  rule as web), `#recoverPendingLocalEdits()`, `MAX_PUSH_WAIT_MS = 4000`, backoff retries,
  and `flushForBackground()` wired to `AppState` 'background'/'inactive' in `AppContext`,
  which also awaits `Repository.flushWrites()` and the journal.
  `SyncJournal.prepare()` MUST be awaited before the first pull or recovery silently no-ops.
- **Mobile-only regression closed:** `#commitState`'s first-write branch was a bare upsert
  that always returned `true`, so a simultaneous first sign-in on a second device was
  clobbered. Now `ignoreDuplicates: true` + `.select('version')`, matching web.
- **`#stashConflict` was write-only.** Single fixed key (each conflict overwrote the last)
  and nothing ever read it. Now timestamped keys + a capped index of 5, plus
  `conflictBackups()` / `readConflictBackup()`. Still needs a Settings restore UI.
- **Voice splitting ported verbatim** — `#buildVoicePrompt`, `#buildVoicePrefill` and
  `#reconcileSplits` are byte-identical to the web copies (verified by diff).
  `TransactionFormScreen.applyPrefill` gained the missing `setSplits(prefill.splits)`: mobile
  was silently dropping splits, which had been true for **receipt scans too**, not just voice.
- **Settings defaults ported** — `defaultAccountId` / `defaultPaymentType` in seed +
  StateMigrator, `AccountService.defaultId()`, `PaymentTypeService.defaultType()`, pill rows
  in the Preferences block, and both used by `TransactionFormScreen`.
- `Store.#persistState` now fires the local-change hook even when the write failed (web parity).
- Swipe and the FX panel stay web-only: the RN app has no swipe-delete (deletion is an
  explicit multi-select mode) and no browser-refresh path.

**Six-item fix pass (2026-08-15) — WEB ONLY. Mobile port pending (see _Pending_ 0).**
New suite `src/__smoke__/session-2026-08.smoke.mjs` (57 assertions, added to `npm run smoke`).
Seven mutations were tried against it and all seven turn it red.

- **Lost transactions on refresh — the serious one.** Three entries made back-to-back
  collapsed into ONE debounced push; the tab was refreshed before it fired; the next boot
  read the cloud row (which predated all three) and `replaceState()`d it over memory AND
  localStorage. `#dirty` was memory-only, so the existing flush-before-pull guard was dead
  on the boot path, and nothing was stashed. Four changes:
  - New `core/SyncJournal.js` — a durable `pocket.v1.pending` record `{userId, since,
    baseVersion}`. `baseVersion` is load-bearing: on boot, `row.version === baseVersion`
    proves nobody else wrote, so local may be committed OVER the row; any other value means
    another device wrote while we were away and blindly pushing would destroy THEIR work, so
    the local copy is stashed via the existing conflict-backup path instead.
  - `SyncService.#recoverPendingLocalEdits()` runs inside `#doPull` before the snapshot is
    adopted. A transient failure keeps local state and retries — it never adopts the cloud.
  - `visibilitychange → hidden` + `pagehide` flush a pending push (`#bindLifecycleFlush`).
    On mobile the OS can discard a backgrounded tab without ever firing `unload`.
  - `MAX_PUSH_WAIT_MS = 3000` caps the trailing-edge debounce (it was re-armed by every
    save, so a burst could postpone the only durable write indefinitely), and a failed push
    now retries with backoff instead of being dropped.
- **`Store.#persistState` fires the local-change hook even when the localStorage write
  FAILED.** The mutation is already in memory, so a push uploads correct data; skipping it
  meant a full quota / InPrivate window had no durable copy anywhere. NB jsdom's
  `localStorage` is a Proxy — stubbing `setItem` silently does nothing, the suite uses a real
  `storageQuota`.
- **Transfer FX panel would not hide.** `resetTransferFx()` early-returned on a
  same-currency pair, and `updateTransferFxPanel()` is the only thing that sets
  `display:none` — hence "click Transfer again and it disappears". It now clears the stale
  rate (still submitted while hidden, so it was stamping a bogus `transferRate` on
  same-currency legs) and delegates the hide. The cross-currency re-quote that
  `fx.smoke.mjs` H5 depends on is untouched.
- **Swipe-to-delete → reveal-then-tap.** `onTxSwipeEnd()` never consulted the axis lock, and
  `#swipeLastX` was updated BEFORE the axis check, so horizontal drift accumulated during a
  vertical scroll and a curved thumb arc fired `confirm('Delete this transaction?')`. New
  `ui/components/SwipeRowController.js` owns the gesture: 8px axis lock, 45px open
  threshold, `touchcancel` handled, and the row now slides open and STAYS open exposing a
  real `<button data-swipe-delete>`. Nothing is destroyed until it is tapped, so the
  `confirm()` is gone from that path. `deleteTx` / `deleteSharedTx` / `deleteSharedContrib`
  gained `{confirm:false}`; every other caller keeps the dialog.
- **Settings: default account + payment method.** `user.defaultAccountId` /
  `user.defaultPaymentType`, back-filled in all THREE places (`seed.js`,
  `StateMigrator.js`, `app.#ensureUserDefaults`). Resolution lives on the services —
  `AccountService.defaultId()` and `PaymentTypeService.defaultType()` — so a preference
  naming a deleted or archived target degrades instead of dangling. `AccountService.delete`
  clears it; `PaymentTypeService.rename`/`remove` migrate it. Consumed by TransactionModal,
  DebtModal, RegularItemModal, AccountDetailView and ReceiptScanService.
- **Voice entry splits by category.** `#buildVoicePrompt` now asks for `items[]` + `total`;
  `#buildVoicePrefill` emits `prefill.splits` when >1 item resolves to >1 DISTINCT category
  (same category twice stays one row). No UI change was needed — `TransactionModal` already
  seeds its split editor from `prefill.splits`. New `#reconcileSplits()` forces the legs to
  sum EXACTLY to the parent (submitTx rejects a one-minor-unit disagreement) and defers to
  the itemised sum when a spoken total is implausible. `maxOutputTokens` 512 → 1024. The old
  flat response shape is still accepted.
- New `app.receiptScanner` getter (one instance, and a seam for the suite);
  `app.accountService` getter.

**Spaces design doc (2026-08-15).** `docs/SPACES-DESIGN.md` — the shared-account "space"
switcher, written up for approval, NO code. Headline: the guest space already exists as the
`family_shares` snapshot, so phase 1 is a UI + scoping change with no server work, hooked in
at `BaseView.state` (one edit re-points the whole view layer). Member-created categories are
phase 2 and need a new contribution payload, an `#authoriseContribution` branch, and audit
**H1** fixed first — it is a blocking prerequisite, not a nice-to-have.

**Shared accounts in categories + regular purchases (2026-08-06) — WEB ONLY so far.**
Mobile already did the category half correctly (`src/state/categorySource.js`); mobile Regulars
still needs the shared-account half — see _Pending_.
- **Root cause of "the owner sees Uncategorised":** the web category picker always read the LOCAL
  `CategoryService`, so a contribution carried a local category id that means nothing in the
  owner's book. New `SharedCategorySource` (web mirror of mobile's `categorySource.js`) wraps
  `share.categories` in the picker's read surface; `quickCreate` is refused.
- `CategoryPickerSheet.open({ categories })` swaps its `#source`; passing a list implies
  `allowAdd:false`. `onClosed()` falls back to the local book.
- `CategoryField` gained `ownerId` → `data-ownerid`, plus `setOwner(el, ownerId, cats)`.
  `app.openCategoryPicker` reads that attribute, resolves the list via
  `app.categoriesForOwner(ownerId)`, and LABELS from the same book.
- `TransactionModal` resolves the effective owner from `sharedTxMode` **or** from a shared
  account chosen in the Account dropdown, and hides **Split** for a contribution
  (`submitTx` has no split path there). `onTxAccountChange` re-homes the field and drops the
  stale pick when the account moves between books.
- **Regular purchases:** the account `<select>` now has a "Shared by …" group. Its value is
  encoded by the new `AccountRef` class (`shared:<ownerId>:<accountId>`); items persist
  `accountId` + `sharedOwnerId`. `submitRegularLog` submits a **contribution** (owner's home
  currency drives `exchangeRate`/`refAmount`) instead of writing locally; `deleteRegularLog`
  routes through `deleteContribution`.
- New `RegularLogService` merges local logs with contributions found in `_sharedData` (only for
  the user's OWN `regularItems`), tagging shared rows `_shared` / `_ownerId`. CalendarView and
  DayLogsModal read through it — otherwise a shared entry vanished the moment it was saved.
- New suite `src/__smoke__/shared-regulars.smoke.mjs` (53 assertions, added to `npm run smoke`),
  mutation-verified: reverting the picker fix, the modal's category list, the account-change
  re-home, the contribution path, or the log merge each turns it red.

**Two stale smoke suites repaired (2026-08-06) — tests only, no app change.**
Both had been failing for a while and were mistaken for app bugs. Neither was.
- `payment.smoke.mjs` queried `select[name=paymentType] option`, but that control became
  **chips** (`[data-pay-chip]` buttons + hidden `#paymentTypeInput`). The selector matched
  nothing, and the suite then *died* on `sel.value` of null — so sections 2–14 never ran at all
  and only 4 of 37 assertions were executing. Rewritten against the chips; `onPaymentTypeChange`
  (gone) → `pickPaymentType`, and `openPaymentTypeManager()` now takes no element.
- `fx.smoke.mjs` H5 set the To-account `.value` then called `updateTransferFxPanel()`. The real
  `<select>` fires **`resetTransferFx()`**, which re-quotes the rate for the new pair;
  `updateTransferFxPanel` deliberately *preserves* a non-empty rate so editing the amount can't
  wipe a hand-typed one. The field therefore kept the previous pair's rate and a 100,000,000 LBP
  → USD transfer booked $92,900 (the LBP→**INR** rate) instead of $1,117.32. **The app is
  correct** — driven through `resetTransferFx()` it books the exact full-precision rate, and the
  H5 recovery in `submitTx` (`rate === Number(autoRate.toFixed(6)) → rate = autoRate`) works.
- Both rewrites were mutation-verified, so they still bite: breaking the chip write-through, the
  Manage chip, or rename-follows-selection each turns `payment` red.

**Voice entry (2026-08-06) — both platforms.**
- Shared: `ReceiptScanService.parseVoice(audio)` (added to **both** copies, identical logic) sends the
  clip as Gemini `inline_data` (`gemini-2.5-flash-lite`) with a "parse ONE spoken transaction" prompt
  reusing the exact-category-ID list; returns prefill
  `{type, amount(MAJOR units), currency, accountId, payee, note, date, paymentType, categoryId}` (no splits).
  User has **prepaid** Gemini (paid tier → no training on their data).
- Recording overlay with a **live level meter**:
  - Web: new `VoiceOverlay.js` + `VoiceRecorder.getLevel()` (Web Audio AnalyserNode, RMS). `app.js
    voiceEntry()` is overlay-driven — bars react to mic volume, timer, Stop/Cancel, spinner while
    transcribing. Works immediately, no rebuild.
  - Mobile: new `src/ui/VoiceOverlay.js` (RN Modal, bars from expo-av metering). TransactionFormScreen
    has `startVoice/stopVoice/cancelVoice`; records **AAC/ADTS `.aac`** (`audio/aac`, Gemini-supported,
    NOT default m4a). Chose **expo-av** (lazy-require-friendly) over expo-audio (hook-only + SDK54
    Android zero-byte bug). expo-av is deprecated (~SDK55) → migrate to expo-audio `useAudioRecorder`
    at next SDK bump.
- **Web bug fixed:** TransactionModal applied `fx.fromMinor()` to a **prefill** amount, but scan/voice
  prefills are in **major** units → "200" displayed as "2.00". Now the non-editing branch uses
  `data.amount` as-is; only a stored (editing) tx is `fromMinor`'d. Also fixed receipt scan. Mobile was
  already correct (`setAmount` uses the major value directly).

## Pending / action items

0. **Mobile voice + the sync fixes need a native rebuild before they can be tested**
   (expo-av is already required for voice): `cd mobile-app && eas build --profile development
   --platform android`. The sync work is plain JS and ships in the JS bundle, but there is no
   way to exercise the AppState background flush without a device.
0b. **Mobile has no UI to restore a conflict backup.** `conflictBackups()` /
   `readConflictBackup()` now exist on `MobileSyncService` and the data is written under
   `pocket.v1.conflict.<ts>`, but nothing surfaces it — web has this in Settings.
1. **Mobile: shared accounts in Regulars.** `RegularsScreen.js` still lists `state.accounts` only,
   and its log path writes locally. Port the web work: `AccountRef` equivalent, `sharedOwnerId` on
   the item, contribution submit, and a merged log source so shared entries stay visible.
   Mobile's category picker already handles shared accounts (`categorySource.js` + the
   `categories: sharedMode ? ownerCats : undefined` hop in `TransactionFormScreen`) — no change there.
2. **Mobile voice needs a native rebuild** before it works:
   `cd mobile-app && npx expo install expo-av`, then
   `eas build --profile development --platform android`, install the APK.
   (`app.json` already has `RECORD_AUDIO` + the expo-av config plugin; `package.json` pins expo-av ~16.0.8.)
3. **GitHub Pages:** Source is set to GitHub Actions; needs a successful "Deploy web" run.
   `deploy-web.yml` publishes `legacy-web/` as the site root: `/pocket/` = marketing `index.html`,
   `/pocket/app.html` = the app. After deploy, add Supabase → Auth → Redirect URLs:
   `https://mshshakir.github.io/pocket/app.html` and `https://mshshakir.github.io/pocket/`
   (otherwise Google sign-in bounces).
4. Inert stray file to ignore/delete: `legacy-web/src/ui/components/VoiceRecorder.js.overlay-note`.

## Memory

Auto-memory lives at
`...\local-agent-mode-sessions\...\spaces\8c102d56-...\memory\`. Key files:
`mobile-app-shares-web-domain.md`, `family-live-sync-is-intentional.md`, `budget-app-audit-2026-07.md`.
