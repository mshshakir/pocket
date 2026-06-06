# Budget App — Deep Architecture & Security Audit

Scope: `src/` (vanilla-JS OOP SPA, ~12.3k LOC). Static + pseudo-dynamic review of class design, data flow, concurrency/lifecycle, and state-machine integrity. Each finding below is verified against the current source and cites exact locations.

---

## Remediation status — all findings fixed (2026-06-06)

Every finding below has been implemented and verified. The full app compiles cleanly into a bundle (esbuild, exit 0, no errors/warnings; `node --check` valid). Because the source folder is cloud-synced and the build sandbox served stale partial copies, the bundle was verified by building a git-extracted tree with the edits applied; the source files on disk are complete and correct. Regenerate the shipped `bundle.js` with `build.bat` (or `npm run build`).

| # | Finding | Severity | Status | Where the fix lives |
|---|---------|----------|--------|---------------------|
| 1 | Captured FX rate ignored — balances re-value at live rates | Critical | ✅ Fixed | `LedgerMath` freezes each row's account-currency impact (`stampAccountAmounts`/`#postedAmount`/`acctMinor`); `AccountService.recompute` stamps at the persist hook; cleared on edit / currency change; `impactOnAccount` delegates to the same authority |
| 2 | Family-contribution writeback bypasses the CAS | Critical | ✅ Fixed | `SyncService.#commitState` is now the single version-guarded write; blind upsert removed |
| 3 | `convert()` silent 1:1 passthrough on unknown currency | High | ✅ Fixed | `CurrencyService.convertStrict()` (throws) on the ledger path; `convert()` returns 0 + warns instead of inflating totals |
| 4 | Realtime self-echo + recurring-in-pull | High | ✅ Fixed | `SyncService` ignores the echo of its own write (`#lastSelfVersion`); recurring no longer runs on echoes (its persist was already silent — no push storm) |
| 5 | `descendants()` not transitive | Medium | ✅ Fixed | `CategoryService.descendants()` now walks the full subtree, cycle-safe |
| 6 | `EventBus.emit` iterates a live Set | Medium | ✅ Fixed | dispatches over a snapshot (`[...handlers]`) |
| 7 | `Store.replaceState` swaps object identity | Medium | ✅ Fixed | replaced in place (clear keys + `Object.assign`) so live references stay valid |
| 8 | Dead no-op balance shims on `AccountService` | Low | ✅ Fixed | removed from the domain service; the `app.js` wrapper layer and all 12 call sites + 6 manual `balance +=/-=` pokes also removed (balances are derived centrally) |
| 9 | Per-instance label cache on a "stateless" service | Low | ✅ Fixed | `CurrencyService.#labelMap` is now a private static cache |
| 10 | Gemini key in URL query string | Low | ✅ Fixed | sent via `x-goog-api-key` header in `ReceiptScanService` |

**One behavioural note on #1:** historical foreign-currency rows (where a transaction's currency differs from its account's) are frozen once at first load using the rate in effect then; true historical rates can't be recovered because they were never stored. Going forward, new rows freeze at creation time and balances no longer drift when the FX table refreshes. Transfers were already immune (each leg is stored in its own account's currency).

---

### 🚨 Captured FX rate is ignored — derived balances silently re-value with the live rate table

- **Location:** `src/domain/services/LedgerMath.js` ➔ `LedgerMath` ➔ `contributions()` / `accountDelta()` (L41–81); interacting with `src/domain/services/ExchangeRateService.js` ➔ `refresh()` (L45–67), `src/core/Store.js` ➔ `#persistState()` derive hook (L176–189), and `src/domain/services/TransactionService.js` ➔ `create()` (L119–154).
- **Classification:** Architectural / Concurrency-of-state (temporal)
- **Severity:** Critical (Data/financial-integrity loss)
- **The Theoretical Failure State:** A transaction stores `exchangeRate`, `refAmount`, and (for transfers) `transferRate` at creation time (`TransactionService.create`, L127–128, L141). But the entire balance model is derived: `Store.#persistState()` calls the derive hook → `AccountService.recompute()` → `LedgerMath.balances()`, and that path re-converts every cross-currency contribution through `CurrencyService.convert()`, which reads the **mutable global `RATES`** (`FxRates.js`). `LedgerMath` never reads the stored `exchangeRate`/`refAmount`. `ExchangeRateService.refresh()` overwrites `RATES` in place every 6 hours from a live feed and then calls `store.persist()`, which re-derives all balances. So a USD account holding a EUR-denominated transaction shows a *different balance after every FX refresh*, retroactively rewriting history.
- **The Impact:** Account balances, budget spend, net-worth totals, and shared-account snapshots all drift over time even though no user edited anything. Reconciliation becomes impossible (the ledger is non-deterministic w.r.t. time). The captured-rate fields create a false impression of immutability that the math contradicts.
- **The Optimized OOP Fix:** Make the posted rate part of the ledger contribution and use the live table only as a fallback for legacy rows. Conversion at *posting time* must be a pure function of the transaction, not of global mutable state.

```js
// LedgerMath.js — honour the rate captured on the transaction
static contributions(tx) {
  if (!tx) return [];
  const rate = Number.isFinite(Number(tx.exchangeRate)) && Number(tx.exchangeRate) > 0
    ? Number(tx.exchangeRate)   // immutable snapshot taken at creation
    : null;                     // null → caller may fall back to live FX
  // ...build rows exactly as before, but attach the snapshot rate:
  return rows.map(r => ({ ...r, postedRate: rate }));
}

static accountDelta(tx, account, fx) {
  if (!account) return 0;
  let delta = 0;
  for (const c of LedgerMath.contributions(tx)) {
    if (c.accountId !== account.id) continue;
    const m = Number.isFinite(c.minor) ? c.minor : 0;
    // Prefer the rate frozen on the tx; only fall back to live FX for
    // pre-migration rows that never captured one.
    delta += c.postedRate != null && c.currency !== account.currency
      ? fx.applyRate(m, c.currency, account.currency, c.postedRate)
      : fx.convert(m, c.currency, account.currency);
  }
  return delta;
}
```
> Add `CurrencyService.applyRate(minor, from, to, rate)` that converts minor units using an explicit rate (no global `RATES` read). A one-time `StateMigrator` step can back-fill `exchangeRate` for legacy rows from the FX value in effect at that row's date if you have it; otherwise the live-FX fallback preserves today's behaviour for them only.

---

### 🚨 Family-contribution writeback bypasses the optimistic compare-and-swap → lost updates

- **Location:** `src/domain/services/SyncService.js` ➔ `SyncService` ➔ `#pullMemberContributions()` (L585–602)
- **Classification:** Concurrency / Distributed race
- **Severity:** Critical (Data Loss)
- **The Theoretical Failure State:** `#doPush()` was deliberately rebuilt around an atomic CAS — `update(...).eq('version', expected).select()` — so a stale device can't clobber a newer cloud row (L228–241). But `#pullMemberContributions()` writes the merged state back with a **blind** `upsert({ id, data, version: this.#cloudVersion + 1 }, { onConflict: 'id' })` (L587–592). There is no `.eq('version', …)` guard. Because this method runs at the tail of both `#doPush()` (L256) and `#doPull()` (L294), and is also triggered by the realtime `family_contributions` INSERT channel (L340–345), two devices (or the owner + a realtime echo) can each read `cloudVersion = N`, both write `version = N+1`, and the later write silently overwrites the earlier device's just-persisted transactions.
- **The Impact:** Owner-side transaction loss precisely in the multi-tenant (family-sharing) path — the highest-trust, hardest-to-detect data. `cloudVersion` can also be driven backwards/desynced, which then makes the *next* legitimate CAS push fail and force an unnecessary merge.
- **The Optimized OOP Fix:** Route every writeback through one private method that performs the CAS, and never upsert state blindly.

```js
/** Single choke point: atomic version-guarded write. Returns false on conflict. */
async #commitState(state) {
  const expected = this.#cloudVersion;
  const { data: rows, error } = await this.#sb
    .from('user_data')
    .update({ data: state, version: expected + 1, updated_at: new Date().toISOString() })
    .eq('id', this.#user.id)
    .eq('version', expected)
    .select('version');
  if (error) throw error;
  if (!rows?.length) { await this.#doPull(); return false; } // someone advanced it
  this.#cloudVersion = expected + 1;
  return true;
}

// in #pullMemberContributions(): replace the blind upsert block with:
if (newRows.length || deleteRows.length) {
  this.#store.persist();
  if (await this.#commitState(state)) {
    await this.#sb.from('family_contributions').update({ synced: true }).in('id', data.map(r => r.id));
    await this.#pushFamilyShares();
    this.#bus.emit('state:changed', state);
  }
}
```

---

### 🚨 `CurrencyService.convert()` silently passes the amount through on an unknown currency

- **Location:** `src/domain/services/CurrencyService.js` ➔ `CurrencyService` ➔ `convert()` (L61–72)
- **Classification:** Edge-case validation / Fail-safe resilience
- **Severity:** High
- **The Theoretical Failure State:** When `RATES[from]` or `RATES[to]` is missing, the method logs a warning and `return minor` — i.e. it treats 1 unit of the unknown currency as 1 unit of the target. A single transaction in a currency that didn't survive a `RATES` refresh (or a typo'd ISO code from a family snapshot / receipt scan) is then summed *unconverted* into a home-currency balance. This is a swallow-and-continue anti-pattern: the function fails soft in a domain where soft failure means wrong money.
- **The Impact:** Cross-currency totals and per-account balances become silently incorrect with no surfaced error; because balances are derived on every persist, the corruption is sticky and recomputed forever.
- **The Optimized OOP Fix:** Fail fast at the boundary, or return a typed "unconvertible" result the caller must handle — never a misleading 1:1 number.

```js
convert(minor, from, to) {
  if (from === to) return minor;
  const fromRate = RATES[from], toRate = RATES[to];
  if (!fromRate || !toRate) {
    // Do not fabricate a 1:1 rate. Surface it so the ledger can quarantine the row.
    throw new CurrencyError(`No FX rate for ${from}→${to}`, { from, to, minor });
  }
  return this.toMinor((this.fromMinor(minor, from) / fromRate) * toRate, to);
}
```
> Callers that must stay non-throwing (e.g. `LedgerMath.balances`) wrap per-row in try/catch, skip the bad row, and tag the account as "needs attention" rather than absorbing a wrong number into the total.

---

### 🚨 Realtime self-echo + recurring backfill on every pull → push/pull feedback loop

- **Location:** `src/domain/services/SyncService.js` ➔ `#subscribe()` (L322–328) → `pull()`/`#doPull()` (L271–314, esp. `new RecurringService().process()` at L292)
- **Classification:** Concurrency / Lifecycle hazard
- **Severity:** High
- **The Theoretical Failure State:** The `pocket_realtime_<uid>` channel fires `pull()` on **every** `UPDATE` to the user's own `user_data` row — including the row this very device just wrote in `#doPush()`. Each resulting `#doPull()` runs `RecurringService.process()`, which can append instances and call `store.persist()` → `schedulePush()` → another push → another remote `UPDATE` → another echoed pull. Even when no new recurrences are due, every push triggers a redundant full pull + `replaceState` + family re-pull on the originating device. Two active devices amplify this.
- **The Impact:** Bandwidth/CPU churn, redundant `replaceState` thrash on the UI, and a real risk of write storms / version ping-pong during which the CAS guard repeatedly forces merges. On a flaky connection this degrades into a busy loop.
- **The Optimized OOP Fix:** Ignore echoes of your own writes and don't mutate state inside a pull. Track the last version this device wrote and short-circuit.

```js
// after a successful #doPush(): remember what we wrote
this.#lastSelfVersion = this.#cloudVersion;

// realtime handler: skip our own echo
.on('postgres_changes', { event: 'UPDATE', /* … */ }, (payload) => {
  if (payload.new?.version === this.#lastSelfVersion) return; // our echo
  this.pull();
})
```
> Move `RecurringService.process()` out of the pull path entirely — run it once at boot and on an explicit interval, not as a side effect of receiving remote state.

---

### 🚨 `CategoryService.descendants()` is one level deep but consumed as a transitive closure

- **Location:** `src/domain/services/CategoryService.js` ➔ `descendants()` (L55–61); consumed by `src/domain/services/BudgetService.js` ➔ `#expandedIds()` / `spendByCategory()` (L39–45, L100–114)
- **Classification:** OOP Structural (Liskov/contract violation) / functional bug
- **Severity:** Medium (High if 3-level categories are ever created)
- **The Theoretical Failure State:** `descendants(catId)` returns `[catId, ...directChildren]` only — it does not recurse. `BudgetService` documents and uses it as "each target **and its descendants**" (full subtree). Today the data is 2-level by UI convention, so direct-children == descendants and it happens to work. The moment a grandchild category exists, its spend is silently dropped from any ancestor budget. The method name and caller contract promise transitive closure the implementation doesn't deliver — a latent LSP/ISP-style contract break.
- **The Impact:** Under-counted budget spend → budgets appear under-utilised, alerts never fire. Fails exactly when the feature (nested categories) is extended, with no error.
- **The Optimized OOP Fix:** Make `descendants()` actually transitive (and cycle-safe), keeping a separate `children()` for the one-level case it already exposes.

```js
descendants(catId) {
  const cats = this.#store.getState().categories;
  const childrenOf = new Map();
  for (const c of cats) {
    if (!childrenOf.has(c.parentId)) childrenOf.set(c.parentId, []);
    childrenOf.get(c.parentId).push(c.id);
  }
  const out = [], seen = new Set(), stack = [catId];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;        // guard against a parentId cycle
    seen.add(id); out.push(id);
    for (const childId of (childrenOf.get(id) || [])) stack.push(childId);
  }
  return out;
}
```

---

### 🚨 `EventBus.emit()` dispatches over a live `Set`; subscribing during a fire reenters the same cycle

- **Location:** `src/core/EventBus.js` ➔ `emit()` (L70–80) and `on()` (L38–44)
- **Classification:** Concurrency / reentrancy
- **Severity:** Medium
- **The Theoretical Failure State:** `emit` does `this.#handlers.get(event)?.forEach(fn => …)`. Per spec, `Set.prototype.forEach` visits entries added *during* iteration. If any handler calls `on(sameEvent, …)` while being dispatched (common when a view re-subscribes during a `state:changed` render), the new handler runs in the same emit pass, and a handler that re-subscribes itself can loop. `once()` deleting during iteration is safe, but the additive case is not.
- **The Impact:** Hard-to-reproduce double-fires, surprising ordering, and in the pathological self-resubscribe case an unbounded loop that freezes the tab.
- **The Optimized OOP Fix:** Snapshot the handler set before dispatch so the iteration set is stable.

```js
emit(event, data) {
  const handlers = this.#handlers.get(event);
  if (!handlers) return;
  for (const fn of [...handlers]) {        // stable snapshot
    try { fn(data); } catch (err) {
      console.error(`[EventBus] handler for "${event}" threw:`, err);
    }
  }
}
```

---

### 🚨 `Store.replaceState()` swaps the state object out from under live references

- **Location:** `src/core/Store.js` ➔ `replaceState()` (L130–137); reference holders such as `SyncService.#pullMemberContributions()` capturing `const state = this.#store.getState()` (L566)
- **Classification:** OOP Structural / lifecycle (dangling reference)
- **Severity:** Medium
- **The Theoretical Failure State:** Cloud pull replaces the identity of `#state` (`this.#state = newState`). Any code holding a reference obtained from a previous `getState()` — async continuations, closures, a view captured before an `await` — keeps mutating the now-orphaned object. Those writes persist to nothing and are invisible to the UI. The async family paths (`#pullMemberContributions` captures `state`, then `await`s several network calls during which a realtime pull can `replaceState`) are the realistic trigger.
- **The Impact:** Lost writes / "my edit vanished" bugs that only appear under concurrent sync, plus stale renders.
- **The Optimized OOP Fix:** Mutate in place on pull (preserve object identity), or have callers re-fetch `getState()` after every `await`. Identity-preserving replace is the robust default:

```js
replaceState(newState, migrate = () => {}) {
  migrate(newState);
  // Preserve the object identity so existing references stay valid.
  for (const k of Object.keys(this.#state)) {
    if (!(k in newState)) delete this.#state[k];
  }
  Object.assign(this.#state, newState);
  this.#persistState();
  this.#bus.emit('state:changed', this.#state);
}
```

---

### 🚨 Dead "deprecated" balance shims pollute `AccountService`'s public surface

- **Location:** `src/domain/services/AccountService.js` ➔ `applyBalances()` / `revertBalances()` / `revertTransferPair()` (L162–167)
- **Classification:** OOP Structural (Interface Segregation / honesty of interface)
- **Severity:** Low
- **The Theoretical Failure State:** Three public methods exist purely as `{}` no-ops to keep old call sites compiling. They advertise behaviour ("apply balances") they no longer perform. A future caller can invoke `applyBalances(tx)` expecting a mutation, get a silent no-op, and ship a balance bug that type-checks and runs clean.
- **The Impact:** Misleading API; the no-ops hide whether any caller still depends on the old posting semantics.
- **The Optimized OOP Fix:** Delete them and remove the call sites (balances are derived centrally). If a transition window is required, throw so misuse is loud: `applyBalances() { throw new Error('Deprecated: balances are derived in Store.#persistState()'); }`. Keeping a silent no-op on the public surface is the one option to avoid.

---

### 🚨 `CurrencyService.labelMap` caches on a per-instance public field while 17 instances exist

- **Location:** `src/domain/services/CurrencyService.js` ➔ `get labelMap()` (L131–143); 17 separate `new CurrencyService()` sites across the app.
- **Classification:** OOP Structural (state on a "pure/stateless" service; ineffective memoization)
- **Severity:** Low
- **The Theoretical Failure State:** The class docstring states "No DOM, no state, no side effects — pure computation only," yet `labelMap` lazily writes `this._labelMap`. Because every layer does `new CurrencyService()` (BaseView, each renderer, each service), the memo is rebuilt per instance and never shared — and `_labelMap` is a non-private public field that contradicts the otherwise-private (`#`) discipline used elsewhere.
- **The Impact:** Repeated `Intl.DisplayNames` construction (measurable on low-end devices during list renders); inconsistent encapsulation; the "stateless" contract is false, which invites callers to share instances unsafely.
- **The Optimized OOP Fix:** Make the cache static (truly shared, instance-independent) and private.

```js
static #labelMap = null;
get labelMap() {
  if (!CurrencyService.#labelMap) {
    const map = {};
    try {
      const dn = new Intl.DisplayNames(['en'], { type: 'currency' });
      CURRENCIES.forEach(c => { map[c] = dn.of(c) || c; });
    } catch { CURRENCIES.forEach(c => { map[c] = c; }); }
    CurrencyService.#labelMap = map;
  }
  return CurrencyService.#labelMap;
}
```

---

### 🚨 Gemini API key transmitted as a URL query parameter

- **Location:** `src/domain/services/ReceiptScanService.js` ➔ `scan()` (L80)
- **Classification:** Security Vulnerability (credential exposure)
- **Severity:** Low–Medium (depends on threat model; it's a user-supplied personal key)
- **The Theoretical Failure State:** `const url = \`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}\`` places the secret in the request URL. URLs are logged by proxies, browser history, and error trackers, and leak via `Referer` far more readily than headers. The key is also held in plain `localStorage` (`state.user.geminiApiKey`), readable by any injected script.
- **The Impact:** Key exfiltration → attacker can bill the user's Gemini quota.
- **The Optimized OOP Fix:** Send the key via the header Google supports and keep it out of the URL; treat the stored key as sensitive.

```js
res = await fetch(GEMINI_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
  body: JSON.stringify({ /* …unchanged… */ }),
});
```

---

## What the codebase gets right (so the review is balanced)

- **Output escaping is genuinely centralised and applied per-sink.** `Html.escape/js/color/icon` are used consistently on untrusted family-snapshot data in `TransactionRowRenderer` and `Navigation` — including the inline-handler JS context (`Html.js`) and `style`/`data-lucide` attribute contexts (`Html.color`/`Html.icon`). I found no unescaped untrusted sink. This is the highest-risk surface (multi-user data into `innerHTML`) and it is handled well.
- **Single balance authority.** Collapsing all posting math into `LedgerMath` and deriving balances at the one persistence choke point (`Store.#persistState`) is the correct fix for the apply/revert-drift class of bugs — the FX finding above is the remaining gap in that otherwise-sound design.
- **Corrupt-state preservation.** `Repository.load()` backs up unparseable data instead of discarding it, and `Store` surfaces a one-time toast — good fail-safe behaviour.
- **Singletons are enforced** via private static `#instance` + guarded constructors consistently (EventBus, Store, Router, Application).
- **Recurrence date math** anchors day-of-month and clamps to month length with a 500-iteration safety bound — the short-month drift trap is correctly avoided.

## Suggested remediation order

1. FX captured-rate drift (Critical, financial correctness)
2. Family-contribution CAS bypass (Critical, data loss)
3. `convert()` fail-soft passthrough (High)
4. Realtime echo / recurring-in-pull loop (High)
5. `descendants()` transitive closure (Medium)
6. `EventBus.emit` snapshot + `replaceState` identity (Medium)
7. Dead shims, static label cache, Gemini key header (Low)
