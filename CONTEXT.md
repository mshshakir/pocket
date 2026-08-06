# Pocket — session context / handoff

> **KEEP THIS UPDATED.** At the end of any substantial session, revise this file:
> bump _Last updated_, move finished items out of _Pending_, and add a one-line note
> under _Recent changes_ for anything that alters architecture, contracts, or workflow.
> Paste this whole file into a new chat to bring a fresh session up to speed.
> It complements the auto-memory (see _Memory_ below) — this is the human-readable brief.

**Last updated:** 2026-08-06

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
  takes ~2 min. Note two **pre-existing** failures, confirmed identical on an untouched tree —
  do not attribute them to your change: `payment` (3 ✗ "dropdown lists built-ins + custom" etc.)
  and `fx` (1 ✗ "H5 booked at the exact rate").
- **Mobile:** esbuild transpile screens with `--loader:.js=jsx --packages=external`; domain suites
  `node test/domain.test.mjs` (30) + `node test/family.test.mjs` (10).
- **Domain logic** can be node-tested: boot the Store (`Repository.setBackend` in-memory →
  `store.init(seed)`) and stub `global.fetch`.

## Recent changes

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
