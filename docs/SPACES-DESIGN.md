# Spaces — design proposal

**Status:** proposal, awaiting approval. No code written. All open questions answered.
**Date:** 2026-08-15 (revised 2026-08-15 — §6 and §8 record the answers)
**Scope:** `legacy-web` first, `mobile-app` to follow.

---

## 1. The problem

Today, an account someone shares with you is a *detour*. You stay inside your own
book at all times and occasionally reach sideways into somebody else's:

- `FamilyView` lists "Shared with me" and each shared account drills into
  `AccountDetailView` with a `{ shareIndex }` option.
- `TransactionModal` decides which book it is writing into by *inferring* it —
  either from an explicit `sharedTxMode`, or by discovering that the account the
  user picked happens to belong to a share (`app.js:786`, `sharedMatch`).
- The category picker is patched per-field: `CategoryField` carries a
  `data-ownerid`, and `app.openCategoryPicker` resolves a list through
  `app.categoriesForOwner(ownerId)`.

Every one of those is a local correction to a global assumption. The global
assumption — "`state.categories` is the category list, full stop" — is still
baked into ~40 read sites, and it is why category resolution keeps breaking:
each new form that can target a shared account has to remember to re-point its
own category source, and any that forgets silently writes a local category id
into the owner's book, where it renders as *Uncategorised*.

The user's framing is the right one. The unit the app should switch on is not
an account, it is a **book**. Call it a Space.

## 2. The model

A Space is the (accounts, categories, transactions, currency) tuple that a set
of forms reads and writes. There are exactly two kinds:

| | Home space | Guest space |
|---|---|---|
| Backing data | `state.*` | `state._sharedData[n]` |
| Id | `null` | the owner's `_ownerId` (a uuid) |
| Label | "My money" (or the user's own name) | `share.sharedBy`, overridable locally |
| Accounts | all of `state.accounts` | `share.accounts` (already filtered to shared ones) |
| Categories | `state.categories` | `share.categories` (the owner's whole tree) |
| Transactions | `state.transactions` | `share.transactions` |
| Home currency | `state.user.homeCurrency` | `share.homeCurrency` |
| Writes | direct, via the services | contributions, via `family_contributions` |

**The important discovery: the guest space already exists.** `#pushFamilyShares`
(`SyncService.js:760-772`) writes exactly this snapshot today:

```js
const snapshot = {
  sharedBy:     state.user.name || this.#user.email,
  homeCurrency: state.user.homeCurrency,
  permission:   permMap,                    // { accountId → 'view'|'add'|'edit'|'full' }
  accounts:     state.accounts.filter((a) => sharedIds.includes(a.id)),
  transactions: state.transactions.filter(/* touching a shared account */),
  categories:   state.categories,
  updatedAt:    new Date().toISOString(),
};
```

Nothing new has to be synced. This work is a **UI and scoping** change, not a
data change. That is the single most important thing to know before estimating
it.

### 2.1 The Space class

```js
// src/domain/services/Space.js
export class Space {
  static home(state)        // → new Space({ id: null, … })
  static guest(share)       // → new Space({ id: share._ownerId, … })

  get id()            // null for home, ownerId for a guest space
  get label()         // display name
  get isHome()
  get accounts()
  get categories()
  get transactions()
  get homeCurrency()
  get permissionFor(accountId)   // 'view'|'add'|'edit'|'full'|'owner'|null
  get canAdd()  / canEdit() / canDelete(accountId)
}
```

`Space` is a **read model**. It never mutates. Writes stay where they are today:
the services for the home space, `SyncService.submitContribution` and friends for
a guest space.

### 2.2 SpaceRegistry

```js
// src/domain/services/SpaceRegistry.js
export class SpaceRegistry {
  constructor({ store, syncService })
  all()                 // [home, ...guests]  — guests sorted by ownerId, stable
  active()              // the currently selected Space
  activate(spaceId)     // null → home
  onChange(cb)
}
```

The active space id is **session state, not user data**. It lives on the
registry and is mirrored to `sessionStorage`, *not* into `state.user`. Two
reasons: it must never travel to the cloud (it is meaningless on another
device), and a share that is revoked while you are standing in it must degrade
to "you were dropped back to your own space", not to a persistent broken
pointer. `activate()` falls back to home whenever the requested id is no longer
in `all()`.

## 3. Labelling

`share.sharedBy` already carries `state.user.name || email` — the owner's own
choice of display name, pushed with every snapshot. That is the default label.

The user asked to be able to set the name themselves. Add:

```js
state.user.spaceLabels = { '<ownerId>': 'Abbas' }   // member-side, local override
```

Resolution: `spaceLabels[ownerId] ?? share.sharedBy ?? '(shared)'`. This is a
member-side preference in the member's own book, so it syncs with their state
normally and needs no server change. Rename UI goes in the space switcher.

## 4. Scoping — where it hooks in

There are 222 direct reads of `state.accounts` / `state.categories` /
`state.transactions` across 34 files. They do **not** need 222 edits, because
they funnel through two chokepoints.

### 4.1 `BaseView.state` — the whole view layer, one edit

```js
// src/ui/views/BaseView.js:48
get state() {
  return this.#store.getState();
}
```

Becomes a scoped projection:

```js
get state() {
  return this.#spaces.active().project(this.#store.getState());
}
```

where `project()` returns `{ ...state, accounts, categories, transactions, _space }`
for a guest space and the state object itself for home. Every view subclass
reads through this getter, so `DashboardView`, `TransactionsView`,
`CategoriesView`, `ReportsView`, `CalendarView`, `BudgetsView` and the rest are
re-pointed by one change.

**Caution:** the projection must be a *shallow copy with substituted arrays*, and
views must keep treating `state` as read-only (they already do). Any view that
mutates through this getter would be writing into a detached object. A short
audit of `this.state.<x> =` assignments in `ui/views/` is a prerequisite — I
expect zero, but it must be zero.

### 4.2 The services — explicit, not projected

`TransactionService`, `AccountService`, `BudgetService`, `CategoryService`,
`AccountGroupService` and `RecurringService` all **mutate**. Handing them a
projection would let them write silently into a snapshot that is thrown away on
the next pull. They must keep reading the real `Store.getState()`, and the
controller must not call them at all while a guest space is active.

The existing precedent is `SharedCategorySource.quickCreate()`
(`SharedCategorySource.js:113-118`), which returns
`{ ok: false, reason: "You can't add categories to a shared account" }` rather
than pretending. Generalise that: each mutating service gains a guard that
refuses when `spaces.active()` is not home, and the controller routes to the
contribution path instead.

### 4.3 Explicitly excluded

- `StateMigrator` and `SyncService` must **always** see the real local state.
  A projection reaching either of them would upload a guest snapshot as the
  user's own book. This is the single most dangerous failure mode in the whole
  design and deserves an assertion, not just a convention.
- `app.js` (88 of the 222 reads) is the controller. It legitimately needs both
  books at once — deciding which book a write goes to *is its job*
  (`app.js:783-846`). It gets the registry, not a projection.

### 4.4 What disappears

Once the active space is explicit, several inferences can go:

- `sharedMatch` (`app.js:786`) — the "did the user pick a shared account?" sniff.
- The three duplicated `state._sharedData.flatMap(s => s.accounts)` fallbacks
  (`app.js:1686`, `1751`, `1785`).
- Positional `shareIndex` addressing throughout the UI, which `SyncService.js:802-804`
  already documents as fragile ("an unordered select made those indices shift
  between opening a sheet and submitting it").
- `CategoryField`'s `data-ownerid` round-trip — the picker just asks the active
  space.

That deletion is most of the payback. The space switcher is not only a feature,
it is the removal of an entire class of "which book am I in?" bug.

## 5. Member-created categories

This is the only part that needs a **server-side** change, and it is why I would
ship it as a second phase.

### 5.1 Why it does not work today

Three hard stops:

1. **No permission level covers it.** `FAMILY_ACCESS_LEVELS`
   (`constants.js:174-179`) is `view < add < edit < full`, and every `desc`
   speaks only about transactions and balances. Category creation is a different
   axis entirely: it changes the owner's chart of accounts, not their ledger.
2. **No payload shape for it.** `#authoriseContribution`
   (`SyncService.js:870-901`) recognises exactly two things: an add (a `tx_data`
   carrying an `accountId`) and a delete/replace marker. There is no third branch.
3. **`family_contributions.account_id` is `NOT NULL`** (see the DDL in
   `SettingsModal.js:234-271`). A category contribution has no natural account —
   which is why `SyncService` already carries four-level fallback chains at
   `:553-557`, `:611-615` and `:663-667` just to satisfy this column.

### 5.2 Proposed change

**Permission.** Add a per-member boolean rather than a fifth level, because it is
orthogonal to the view/add/edit/full ladder:

```js
state.family[n] = { …, permissions: [...], canAddCategories: false }
```

Surfaced in `FamilyModal` and `AccountShareSheet` as a single checkbox: *"Let
them add categories to my book."* Default off. It rides along in the snapshot as
`snapshot.canAddCategories`.

**Payload.** A third `tx_data` shape, distinguished by an explicit kind rather
than by sniffing:

```js
{ _kind: 'category', id: 'cat_…', name: 'School fees', parentId: 'cat_edu'|null,
  type: 'expense'|'income', icon: 'book', color: '#0ea5e9' }
```

`account_id` gets the sentinel `'_category'` until the column can be made
nullable — consistent with the fallbacks already there, and a migration to
`null` can follow separately.

**Authorisation.** A third branch in `#authoriseContribution`, before the
account-permission loop:

```js
if (tx._kind === 'category') {
  if (!member.canAddCategories) return { ok: false, reason: 'no category rights' };
  if (this.#categoryExists(tx.id)) return { ok: true };        // idempotent replay
  if (tx.parentId && !this.#categoryExists(tx.parentId))
    return { ok: false, reason: 'unknown parent' };
  return { ok: true };
}
```

Note what this branch must **not** do: accept an update or a delete. Phase 2 is
create-only. A member editing or removing the owner's categories is a much
larger blast radius (it re-buckets historical transactions) and should stay out
until there is a reason for it.

**Client.** `SharedCategorySource.quickCreate()` stops returning a flat refusal
and instead submits a category contribution when `share.canAddCategories` is
true, applying the same optimistic-then-confirm pattern
`#pendingAdditions` already uses for transactions.

### 5.3 Sanitisation

`name`, `icon` and `color` arrive from another user's device and land in the
owner's rendered UI, so they must be escaped for the sink they reach.

**Status corrected 2026-08-15: audit finding H1 is already fixed.** An earlier
revision of this doc called it a hard blocking prerequisite for phase 2, on the
strength of a stale note. Spot-verified: `AccountsView.js:151-190`,
`FamilyView.js:149-172`, `AccountDetailView.js:161-190` and
`TransactionModal.js:553-570` all route shared-snapshot fields through
`safeColor` / `safeIcon` / `escapeHtml` / `jsArg`. Every `### ` finding in
`AUDIT-2026-07.md` now carries a ✅.

Phase 2 is therefore **not** blocked on it. The standing rule still applies to
any new code: a field that came from a share snapshot is untrusted input, and
`TransactionRowRenderer.js` is the reference for doing it right.

## 6. Decisions taken

Answers to the questions this doc originally left open, and what each one costs.

### 6.1 Budgets, debts, regulars and reports are IN a guest space

> *"regulars, budgets, debt and report if from a shared account should be visible
> and editable as per access in spaces."*

This is the answer that most changes the plan, because **none of those four
travel in the snapshot today** — it carries only `accounts`, `categories`,
`transactions`, `homeCurrency`, `permission` and `sharedBy`. Three of them scope
cleanly; one does not.

**Debts and regular items — clean.** Both carry an `accountId`
(`DebtModal.js:105`, `RegularItemModal.js:128`), so they filter exactly like
transactions do: include the row when `permMap[accountId]` exists. Editing is
gated by that same per-account permission, which is the model already in place.

**Reports — clean, but say so.** Reports are derived from transactions, so in a
guest space they naturally cover the shared accounts and nothing else. That is
the correct answer, not a limitation: the member is not entitled to the owner's
other accounts. It must be **labelled** in the UI ("across the 2 accounts shared
with you"), or the member will read a partial figure as a total.

**Budgets — genuinely awkward, and the reason this needs one more decision.**
Two independent problems:

1. **A budget is not account-scoped.** Its shape is
   `{ id, categoryId | categoryIds[], amount, currency, period, rollover }` —
   there is no `accountId` anywhere on it. So "a budget from a shared account"
   does not exist as a thing to filter on. Either all of the owner's budgets
   appear in their space (defensible: the whole category tree is already shared),
   or none do.

2. **The member cannot compute the right number.** `BudgetService.currentSpend()`
   (`BudgetService.js:112-122`) sums over `state.transactions` — ALL of them.
   A member receives only transactions touching shared accounts, so a budget
   rendered member-side would report *less* spend than reality, and the more of
   the owner's spending happens on unshared accounts the more wrong it gets.
   Sending every transaction to fix it is not an option: that is the privacy leak
   the snapshot filter exists to prevent.

   **The fix is to send the answer, not the inputs.** The owner computes spend at
   push time and the snapshot carries it:

   ```js
   budgets: state.budgets.map((b) => ({ ...b, spent: budgetSvc.currentSpend(b) })),
   ```

   The member's Budgets view then renders `b.spent` instead of recomputing. A
   derived number crossing the wire is normally a smell; here it is the only
   shape that is both correct and private.

### 6.2 The Dashboard shows the active space only

Confirmed. Totals, balances and recent activity all describe the selected space.
The switcher stays visible in the header so the context is never ambiguous.

### 6.3 Two spaces from the same owner: not possible

Confirmed, and it matches the storage: `family_shares` is keyed
`(owner_id, member_email)`, one row per pair. A space is identified by
`_ownerId` alone and nothing needs to handle a list.

### 6.4 Losing access mid-session tells the user

> *"it should inform the user that permission is now denied or revoked."*

When a pull removes the active space (revoked entirely, or the last account
un-shared), `SpaceRegistry.activate()` falls back to home and the user is told
explicitly — not silently relocated:

- Any open modal belonging to that space closes.
- A toast names what happened: *"Abbas removed your access — switched back to
  your own space."*
- A revoked space disappears from the switcher rather than lingering as a dead
  entry.

The same message covers a narrowing: if the member kept some accounts but lost
the one they were looking at, the space survives and the account view falls back
to the space root with *"You no longer have access to that account."*

Worth noting the failure this replaces: today a stale snapshot simply keeps
working until the next pull, and `revokeMemberShare()` exists precisely because
leaving the row in place "would keep the member's stale snapshot alive forever"
(`SyncService.js:757`).

## 7. What 6.1 costs — the phasing has to change

The original plan called phase 1 "no server work". **That is no longer true.**
Making the four new areas *editable* means each one needs its own contribution
payload and its own branch in `#authoriseContribution` — which is the
security-boundary work that was scoped as phase 2.

| Area | Visible | Editable | New payload kind |
|---|---|---|---|
| Transactions | already | already | — |
| Debts | snapshot field | per-account permission | `_kind: 'debt'` |
| Regular items | snapshot field | per-account permission | `_kind: 'regular'` |
| Budgets | snapshot field + owner-computed `spent` | needs a right that does not exist | `_kind: 'budget'` |
| Reports | derived, label the scope | n/a — read-only | — |
| Categories | already in snapshot | needs `canAddCategories` | `_kind: 'category'` |

Revised phases:

| Phase | Content | Server change | Risk |
|---|---|---|---|
| **1** | `Space` + `SpaceRegistry`, switcher, `BaseView.state` projection, guest-space Accounts / Transactions / Categories / Add-entry. Everything READ-ONLY beyond the transaction contributions that already work. | none | medium — wide but mechanical |
| **1b** | Snapshot gains `debts` + `regularItems` (filtered by account `permMap`) and `budgets` (filtered by the NEW per-budget grants, each carrying owner-computed `spent`). Those become **visible** in a guest space; Reports and BudgetDetailView labelled with their scope. Requires the `permissions` entry migration in §8.2 and a budget share UI. | snapshot shape + permission storage | medium |
| **1c** | Delete `sharedMatch`, the three `_sharedData` fallbacks, positional `shareIndex`, `data-ownerid` | none | low |
| **2** | **Editable**: `_kind` payloads for debt / regular / budget / category, each with an `#authoriseContribution` branch and permission rules. Budget is the first kind with no account, so it forces the `account_id` NOT NULL decision. | yes, on the security boundary | high |

Splitting visible (1b) from editable (2) matters: 1b is a snapshot change nobody
can abuse, while 2 lets another user's device propose writes into your budgets
and debts. Shipping 1 + 1b gives a member a fully readable space; 2 is where the
care goes.

**Snapshot size** deserves a note. Every share row already carries the owner's
whole category tree and every transaction touching a shared account, and it is
re-uploaded per member on every push. Adding budgets, debts and regulars grows
that further. `family_shares.snapshot` is `jsonb` so there is headroom, but the
per-push cost is `O(members × snapshot)` and the audit already flagged snapshot
bloat as the fastest route to a quota failure (M9). Worth measuring on real data
before 1b ships.

## 8. Budgets are shared explicitly, like accounts

Both questions this section previously left open are answered, and the answer is
the same for each: **a budget is shared individually, with its own access level
chosen at share time, exactly as an account is.**

### 8.1 What this fixes

It removes the awkwardness in §6.1 rather than working around it. Budgets have no
`accountId`, so the earlier choice was between "all of the owner's budgets" and
"none" — both wrong. Making the budget itself the unit of sharing sidesteps the
missing `accountId` entirely: the owner names the budget, the same way they name
the account.

It also resolves the privacy objection to shipping a precomputed `spent`.
`BudgetService.currentSpend()` sums across ALL the owner's transactions, so the
figure necessarily reflects spending on accounts the member cannot see. That was
a leak while budgets travelled implicitly. Once the owner has explicitly ticked
*this* budget for *this* member, the aggregate is the thing they chose to
disclose — a budget without its true spend is not worth sharing. **Explicit
sharing is the consent that makes the aggregate legitimate.**

### 8.2 Storage

`state.family[n].permissions` is currently `[{ accountId, access }]`. Rather than
bolting on a parallel array, generalise the entry so the same machinery covers
anything shareable:

```js
permissions: [
  { kind: 'account', id: 'acc_1', access: 'edit' },
  { kind: 'budget',  id: 'bg_7',  access: 'view' },
]
```

`StateMigrator` back-fills `kind: 'account'` on every legacy entry that has an
`accountId`, and `FamilyShareService.setAccess(memberId, accountId, access)`
becomes `setAccess(memberId, ref, access)` where `ref` is `{kind, id}`. Both
platforms and the snapshot read this shape, so the migration has to land in
`legacy-web` and `mobile-app` together.

### 8.3 Access levels — budgets need their own ladder

`FAMILY_ACCESS_LEVELS` is `view < add < edit < full`, and every description talks
about transactions. Reusing it verbatim would offer a member *"Can add — View +
add new transactions"* on a budget, which means nothing. Budgets take a shorter,
separate ladder:

| Level | Meaning |
|---|---|
| `view` | see the budget, its limit and its progress |
| `edit` | change amount, period, rollover, target categories |
| `full` | edit + delete |

No `add`: creating a budget in someone else's book is a different act from being
granted one, and is out of scope.

### 8.4 The trap: BudgetDetailView

`BudgetDetailView` exists to show "the transactions counting toward this budget
this period" (`BudgetDetailView.js:6`), and it derives that list from
`state.transactions`. In a guest space the member holds only the transactions on
accounts shared with them, so that list would be a *subset* — and it would visibly
disagree with the `spent` figure shown directly above it.

Two numbers on one screen that do not reconcile is worse than one number with a
caveat. In a guest space the detail view must either omit the contributing-rows
list, or label it explicitly ("showing 3 of 11 contributing transactions — the
rest are on accounts not shared with you"). **Recommendation: label it.** Hiding
it invites the member to assume the budget covers only what they can see;
labelling makes the boundary visible, which is the same principle as labelling
Reports in §6.1.

### 8.5 Snapshot and authorisation

```js
budgets: state.budgets
  .filter((b) => budgetPermMap[b.id])
  .map((b) => ({ ...b, spent: budgetSvc.currentSpend(b) })),
budgetPermission: budgetPermMap,   // { budgetId → 'view'|'edit'|'full' }
```

Editing rides the contribution path like everything else — `_kind: 'budget'` with
an `#authoriseContribution` branch checking `budgetPermission[id]` against the
required level. Note this is the **first contribution kind that carries no
account**, so it is the one that forces the `family_contributions.account_id`
NOT NULL column to take a sentinel (or, better, be made nullable).

### 8.6 Asymmetry with debts and regulars — deliberate

Debts and regular items keep inheriting from their account's permission, because
unlike budgets they *have* an `accountId` (`DebtModal.js:105`,
`RegularItemModal.js:128`). Sharing an account shares its debts and regulars;
budgets are shared one at a time. That asymmetry is not an inconsistency — it
follows from which entities are account-scoped and which are not, and it avoids
making the owner tick a box per debt when the account grant already says it.

## 9. Estimate

(Phase numbering below refers to the revised table in §7.)

Phase 1 is roughly: 2 new domain classes, 1 new component (the switcher), the
`BaseView` projection, guards on 6 mutating services, and rework of the shared
paths in `TransactionModal` / `AccountDetailView` / `FamilyView`. Plus a new
smoke suite — the existing `sharing.smoke.mjs` and `shared-regulars.smoke.mjs`
(99 assertions between them) cover the current inference-based behaviour and
will need rewriting against the space model, which is itself a useful
correctness check on the migration.

Phase 2 is smaller in volume but sits on the sync security boundary, and per
[[family-live-sync-is-intentional]] every change there has to be verified to
still let a legitimate add and a legitimate delete round-trip in both
directions.
