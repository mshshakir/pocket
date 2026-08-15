# Spaces — design proposal

**Status:** proposal, awaiting approval. No code written.
**Date:** 2026-08-15
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
owner's rendered UI. Audit finding **H1** (`share.icon`/`color`/`id` rendered
unescaped, remotely triggerable by anyone you share with) is still **open** —
see `AUDIT-2026-07.md`. Phase 2 must not ship before H1 is fixed, or it widens a
live hole: today an attacker needs you to share *with* them, and after this they
can inject a payload that the owner's category list renders directly.

**This is a blocking dependency, not a nice-to-have.**

## 6. Rollout

| Phase | Content | Server change | Risk |
|---|---|---|---|
| **1** | `Space` + `SpaceRegistry`, switcher UI, `BaseView.state` projection, guest-space Accounts / Transactions / Categories / Add-entry | none | medium — wide but mechanical |
| **1b** | Delete `sharedMatch`, the three `_sharedData` fallbacks, positional `shareIndex`, `data-ownerid` | none | low, after 1 lands |
| **2** | `canAddCategories` + category contributions | yes: `#authoriseContribution` branch, snapshot field, later a nullable `account_id` | high — touches the security boundary |
| **2 prereq** | Fix audit **H1** (escape `_sharedData` on render) | none | low, isolated |

Phase 1 is safe to ship alone and delivers most of what was asked: switching by
owner, the owner's accounts and *only* the owner's categories inside their
space. Phase 2 adds "and I can add a category while I'm in there."

## 7. Open questions

1. **Budgets, Reports, Debts, Regulars inside a guest space.** The snapshot
   carries no budgets or debts, so those tabs have nothing to show. Options:
   (a) hide them in a guest space, (b) show them read-only-empty with an
   explanation, (c) keep them always scoped to home. I lean (a) — a space you
   cannot budget in should not show a Budgets tab. **Needs a decision.**
2. **Should the Dashboard aggregate across spaces or show only the active one?**
   Consistency says active-only. But "my total net worth" arguably spans both.
   I lean active-only, with the switcher visible in the header so the context is
   never ambiguous.
3. **Two spaces from the same owner.** Not possible today — `family_shares` is
   keyed `(owner_id, member_email)`, one row per pair. Worth stating explicitly
   so nobody designs for a list.
4. **What happens to an open modal when a realtime pull revokes the active
   space?** Proposal: `activate()` falls back to home and the modal closes with
   a toast. Needs a test.

## 8. Estimate

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
