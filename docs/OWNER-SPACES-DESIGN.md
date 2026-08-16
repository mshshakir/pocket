# Owner-created spaces — design proposal

**Status:** proposal, awaiting approval. No code written.
**Date:** 2026-08-15
**Depends on:** `SPACES-DESIGN.md` (phases 1 and 1b, both shipped)

---

## 1. What prompted this

> *"as an owner I cannot see spaces nor rename it. What if an owner can make a
> space and share accounts and budgets in it?"*

Both halves of that are the same gap. Sharing is currently **member-first**: you
open a person and tick the accounts they may see. That answers *"who have I
added?"* but never *"what does Zahra actually see?"* — and because there is no
object representing the share, there is nothing to name and nothing to look at.

A partial fix has already shipped (see §6): the owner can now name each member's
space and inspect it as a space card. What follows is the full model.

## 2. The limit that forces the bigger change

```sql
create table public.family_shares (
  owner_id     uuid not null,
  member_email text not null,
  snapshot     jsonb not null default '{}',
  primary key (owner_id, member_email)
);
```

**One row per person-pair.** That is the whole constraint, and it is narrower
than it first looks. `#pushFamilyShares` (`SyncService.js:964`) already loops
per member and upserts one row each, so:

- Different people can see differently-named spaces — the shipped fix exploits
  exactly this.
- **Several people CAN be in one space.** A space with three members is three
  rows, one per email. No key collision, no schema change. This is the cheap
  half, and it is the half that answers "how do I add another email?".
- **The same person cannot be in TWO of your spaces.** Share "Household" and
  "Business" with Zahra and both writes target `(you, zahra@…)` — they collapse.

> **Correction (2026-08-15).** An earlier revision of §7 treated multi-member
> spaces and the schema change as one indivisible cost. They are not. Only the
> second bullet above needs `space_id` in the primary key. Everything a user
> would recognise as "make a Household space and add three people to it" is
> reachable without touching the backend at all.

## 3. The model

A Space becomes an object the owner owns:

```js
state.spaces = [{
  id:         'sp_…',
  name:       'Household',
  icon:       'home',
  color:      '#8b5cf6',
  accountIds: ['acc_1', 'acc_2'],
  budgetIds:  ['bg_7'],
  members:    [{ memberId: 'm1', access: 'edit', budgetAccess: 'view' }],
}]
```

The inversion is the point. Today access is `member → [accounts]`; here it is
`space → { contents, members }`. You compose the thing once and invite people
into it, rather than making N×M independent grants.

**Access still needs per-account granularity inside a space.** "Zahra can add to
the joint account but only view the savings" is a real requirement, so
`members[]` carries a default and an optional per-item override:

```js
{ memberId: 'm1', access: 'edit', overrides: { acc_2: 'view' } }
```

## 4. Storage and migration

### 4.1 The key change

```sql
alter table public.family_shares add column space_id text not null default 'default';
alter table public.family_shares drop constraint family_shares_pkey;
alter table public.family_shares add primary key (owner_id, member_email, space_id);
```

`default 'default'` is what makes this migratable in place: every existing row
becomes the member's one pre-existing space, and old clients keep matching it.

### 4.2 Client migration

`StateMigrator` synthesises `state.spaces` from the current member-first grants.
The natural default is **one space per member**, named from `member.spaceName`
(already shipped) or the owner's name — i.e. exactly what exists today, just
expressed in the new shape. Merging members who happen to share an identical
account set would be tidier but guesses at intent; don't.

`state.family[].permissions` and `.budgetPermissions` become **derived** from
`state.spaces`. Keep them written for one release so a client that has not
updated still reads a coherent book, then drop them.

### 4.3 The part to be careful with

`#authoriseContribution` (`SyncService.js:870-901`) is the owner's **only**
server-side enforcement point — everything else is render-time, which a stale or
hostile client never runs. It currently builds a flat `accountId → access` map
from `member.permissions`. It would need to resolve through space membership
instead.

That map is also what phase 1b deliberately avoided reshaping. Doing it here is
justified — the feature genuinely needs it — but it is the one step where a
mistake is a permission bug rather than a display bug, and it wants its own
adversarial tests: a member whose space was deleted, a member removed from a
space but still in another, an account moved between spaces mid-flight.

## 5. What gets better

- **Two spaces, one person** becomes possible — the thing the current key
  forbids outright.
- **A space is composable**: add an account to "Household" once and everyone in
  it sees it, instead of editing each member.
- **The owner and the member see the same object**, so "what does Zahra see?" is
  answered by opening the space rather than reading checkboxes.
- `SPACES-DESIGN.md` §7.3 — "two spaces from the same owner: not possible" — is
  retired.

## 6. What has already shipped

Not everything needed the schema change. Delivered 2026-08-15:

- **`member.spaceName`** — the owner names what each member sees. It travels as
  `snapshot.sharedBy`, with the owner's real name alongside it as
  `snapshot.ownerName`. Falls back to the owner's name when unset, which is what
  it always was.
- **The member's own override still wins.** `user.spaceLabels[ownerId]` beats
  `sharedBy` on their device — your name for a space is a suggestion, not an
  imposition.
- **FamilyView's member card is now a space card**: named, renameable, listing
  every account *and* budget in it with its access level.
- **A real bug fixed on the way.** FamilyView kept a hand-copied access table
  that had drifted from `FAMILY_ACCESS_LEVELS`: it omitted `add` entirely, so a
  member granted "Can add" was displayed to the owner as **"View only"** — the
  owner was told they had given *less* access than they had. Its `edit`/`view`
  colours were swapped too. It now derives from the constant.

## 7. Cost, honestly

| Piece | Size | Risk |
|---|---|---|
| `state.spaces` + migration from member-first grants | medium | medium — must not lose a grant |
| Space composer UI (contents + members) | medium | low |
| `family_shares` primary key + `space_id` | small | **needs a backend migration you run — ONLY for one person in two spaces** |
| `#pushFamilyShares` emitting one row per space | small | low |
| `#authoriseContribution` resolving via membership | small | **high — security boundary** |
| Member side: several spaces from one owner | small | low — `SpaceRegistry` already keys by id |
| Retiring the derived `permissions` arrays | small | low, once a release has passed |

Comparable to Spaces phase 1 in volume, higher in risk because of the last two
rows. It is not a refactor to slip in alongside other work.

## 8. Recommendation

Ship it as its own piece, in this order:

1. `state.spaces` + migration, with `permissions` still derived and authoritative
   — **no behaviour change**, purely a shape the UI can read.
2. The composer UI: create a space, put accounts and budgets in it, **add as many
   members as you like**. Push fans out to one `family_shares` row per member,
   which the existing key already supports. This is where the feature becomes
   real to a user.
3. The `space_id` key change and multi-space push — needed *only* so one person
   can be in two of your spaces. This is the release where the backend migration
   runs.
4. `#authoriseContribution` via membership, with the adversarial tests in §4.3.
5. Drop the derived arrays a release later.

**Steps 1 and 2 deliver multi-member named spaces with no schema change and no
change to the security boundary.** Step 3 buys one further thing — the same
person in two spaces — at a materially higher price. It is entirely reasonable
to stop after 2 and see whether anyone asks for it.

## 9. Open questions

1. **Can an account be in two spaces?** Technically yes. It complicates "who can
   see this account?" — the account-first sheet would have to aggregate across
   spaces. Simpler to forbid it initially and see whether anyone misses it.
2. **Does a space have its own currency for totals?** Today the member converts
   to the owner's `homeCurrency`. A "Trip to Dubai" space arguably wants AED
   regardless of the owner's home. Cheap to add later; skip for v1.
3. **Should a member be able to leave a space?** Currently they cannot decline a
   share at all. Worth having, and independent of everything above.
