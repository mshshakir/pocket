/**
 * TransactionRowRenderer — Single source of truth for rendering a transaction row.
 *
 * Replaces the scattered renderTxRow / txRow / accountTxRow globals.
 * Every view that shows transaction rows delegates here so the template
 * lives in exactly one place.
 *
 * Usage:
 *   const renderer = new TransactionRowRenderer();
 *
 *   // Basic (global tx list)
 *   renderer.render(tx);
 *
 *   // Account-detail context (shows impact on that account)
 *   renderer.render(tx, { account });
 *
 *   // Shared-account context
 *   renderer.render(tx, { account, isShared: true, shareIndex: 0, share });
 *
 *   // Multi-select mode
 *   renderer.render(tx, { multiSelect: true, selectedIds: new Set([…]) });
 */
import { Store }               from '../../core/Store.js';
import { Html }                from '../../core/Html.js';
import { CurrencyService }     from '../../domain/services/CurrencyService.js';
import { HijriCalendarService } from '../../domain/services/HijriCalendarService.js';
import { TransactionService }  from '../../domain/services/TransactionService.js';

export class TransactionRowRenderer {
  /** @type {Store} */               #store;
  /** @type {CurrencyService} */     #fx;
  /** @type {HijriCalendarService} */ #hijri;
  /** @type {TransactionService} */  #txService;

  constructor() {
    this.#store     = Store.getInstance();
    this.#fx        = new CurrencyService();
    this.#hijri     = new HijriCalendarService();
    this.#txService = new TransactionService();
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Render a single transaction as an HTML string.
   *
   * @param {object} tx        The transaction object
   * @param {object} [opts={}]
   *   @param {object|null}  opts.account      Account context (account-detail view)
   *   @param {boolean}      opts.isShared     Viewing a shared account
   *   @param {number|null}  opts.shareIndex   Index into shared-data array
   *   @param {object|null}  opts.share        Shared-data snapshot (live reference)
   *   @param {object[]}     opts.categories   Category list override (shared context)
   *   @param {object[]}     opts.transactions Transaction list override (shared context)
   *   @param {boolean}      opts.multiSelect  Multi-select mode active
   *   @param {Set<string>}  opts.selectedIds  Currently-selected IDs
   * @returns {string} HTML string
   */
  render(tx, opts = {}) {
    const ctx = this.#buildCtx(opts);
    return this.#renderRow(tx, ctx);
  }

  // ── Private helpers ──────────────────────────────────────────────────

  #buildCtx(opts) {
    const state      = this.#store.getState();
    const account    = opts.account    || null;
    const isShared   = opts.isShared   || false;
    const shareIndex = isShared ? (opts.shareIndex ?? null) : null;
    const share      = opts.share      || null;
    const cats       = opts.categories   || (isShared && share ? share.categories   : state.categories);
    const txs        = opts.transactions || (isShared && share ? share.transactions : state.transactions);
    const perm       = isShared && account
      ? ((share?.permission || {})[account.id] || 'view')
      : (isShared ? 'view' : 'owner');

    const currentUserEmail = state._currentUserEmail || null;

    return {
      account, perm, shareIndex, isShared, share, cats, txs,
      home:      state.user.homeCurrency,
      currentUserEmail,
      canDelete: perm === 'full' || perm === 'owner',
      canEditTx: perm === 'edit' || perm === 'full' || perm === 'owner',
      findCat:     (id) => cats.find((c) => c.id === id) || null,
      catFullName: (id) => {
        const c = cats.find((x) => x.id === id);
        if (!c) return '';
        if (c.parentId) {
          const p = cats.find((x) => x.id === c.parentId);
          if (p) return `${p.name} / ${c.name}`;
        }
        return c.name;
      },
      multiSelect:  opts.multiSelect  || false,
      selectedIds:  opts.selectedIds  || new Set(),
    };
  }

  #renderRow(t, ctx) {
    const { account, perm, shareIndex, isShared, canDelete, home,
            findCat, catFullName, txs, multiSelect, selectedIds,
            currentUserEmail } = ctx;

    const cat = findCat(t.categoryId);
    const acc = account || this.#getAccount(t.accountId);
    // Category colour/icon can come from a family snapshot (untrusted): validate
    // before they reach a style attribute / data-lucide attribute.
    const safeColor = Html.color(cat?.color);
    const safeIcon  = t.type === 'transfer' ? 'arrow-right-left' : Html.icon(cat?.icon);

    // ── Amount display ────────────────────────────────────────────────
    let sign, displayAmount, displayCurrency, origLine = '';
    if (account) {
      const impact = this.#txService.impactOnAccount(t, account);
      sign = impact.dir;
      displayAmount    = impact.minorInAcc;
      displayCurrency  = account.currency;
      origLine = t.currency !== account.currency
        ? `<div class="text-xs text-zinc-500">orig ${this.#fx.formatMoney(t.amount, t.currency)}</div>`
        : account.currency !== home
          ? `<div class="text-xs text-zinc-500">${this.#fx.formatMoney(this.#fx.convert(impact.minorInAcc, account.currency, home), home)}</div>`
          : '';
    } else {
      sign = t.type === 'expense' ? '-' : t.type === 'income' ? '+' : '';
      displayAmount   = t.amount;
      displayCurrency = t.currency;
      origLine = t.currency !== home
        ? `<div class="text-xs text-zinc-500">${this.#fx.formatMoney(this.#fx.convert(t.amount, t.currency, home), home)}</div>`
        : '';
    }
    const color = sign === '-' ? 'text-rose-500' : sign === '+' ? 'text-emerald-500' : 'text-zinc-500';

    // ── Click / delete handlers ───────────────────────────────────────
    // Shared member can delete transactions THEY added, regardless of permission level
    const isOwnContrib = isShared && !!currentUserEmail && t.addedBy === currentUserEmail;
    const canDeleteRow = canDelete || isOwnContrib;

    // IDs flow into inline-handler JS strings and may originate from another
    // user (family snapshots), so escape them for the JS context. shareIndex is
    // numeric — coerce defensively.
    const jsId   = Html.js(t.id);
    const jsAcc  = Html.js(acc?.id || t.accountId);
    const idxNum = Number(shareIndex) || 0;

    const clickFn = isShared
      ? ((perm === 'edit' || perm === 'full') ? `window.__app.openSharedTxEdit(${idxNum},'${jsAcc}','${jsId}')` : null)
      : `window.__app.openModal('transaction',{id:'${jsId}'})`;

    // Use deleteSharedContrib for own contributions; deleteSharedTx for full-access deletes
    const deleteFn = isShared
      ? (isOwnContrib
          ? `window.__app.deleteSharedContrib(${idxNum},'${jsId}')`
          : `window.__app.deleteSharedTx(${idxNum},'${jsId}')`)
      : `window.__app.deleteTx('${jsId}')`;

    // ── Sub-line ──────────────────────────────────────────────────────
    // Desktop: one sub-line under the title. Phone: the row reads
    // amount · category · account, so it gets its own two lines.
    let subline = '';
    let phoneTitle = '';
    let phoneSub = '';
    if (t.type === 'transfer' && t.transferPairId) {
      const pair  = txs.find((x) => x.id === t.transferPairId);
      const other = pair ? this.#getAccount(pair.accountId) : null;
      const route = this.#transferRoute(t, sign, acc, other);
      subline = `Transfer ${route.arrow} ${this.#esc(other?.name || '—')}${pair && pair.currency !== t.currency ? ` · ${this.#fx.formatMoney(pair.amount, pair.currency)}` : ''}`;
      phoneTitle = 'Transfer';
      phoneSub   = route.text;
    } else if (Array.isArray(t.splits) && t.splits.length) {
      const uniqAccs = new Set(t.splits.map((s) => s.accountId || t.accountId));
      const accLabel = account ? account.name : (uniqAccs.size > 1 ? `${uniqAccs.size} accounts` : (acc?.name || ''));
      subline = account
        ? `Split · ${t.splits.length} categor${t.splits.length === 1 ? 'y' : 'ies'} · ${this.#esc(account.name)}`
        : `Split across ${t.splits.length} categories · ${this.#esc(accLabel)}`;
      phoneTitle = `Split · ${t.splits.length} categor${t.splits.length === 1 ? 'y' : 'ies'}`;
      phoneSub   = this.#esc(accLabel);
    } else {
      const catName = this.#esc(catFullName(t.categoryId) || '—');
      const accName = this.#esc(acc?.name || '');
      subline = accName ? `${catName} · ${accName}` : catName;
      phoneTitle = catName;
      phoneSub   = accName;
    }

    const state = this.#store.getState();
    const hijriDate = state.user?.showHijri ? this.#hijri.toHijri(t.date) : null;
    const isSelected = selectedIds.has(t.id);

    // ── Multi-select mode ─────────────────────────────────────────────
    if (multiSelect) {
      return `
        <label class="w-full flex items-center gap-3 px-3 py-2.5 cursor-pointer ${isSelected ? 'bg-blue-50 dark:bg-blue-950' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'} transition">
          <input type="checkbox" ${isSelected ? 'checked' : ''}
                 onchange="window.__app.toggleTxSelection('${jsId}')"
                 class="w-4 h-4 rounded accent-blue-500"
                 onclick="event.stopPropagation()">
          <div class="icon-pill" style="background:${safeColor}22;color:${safeColor}">
            <i data-lucide="${safeIcon}"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-medium truncate">${this.#esc(t.payee || cat?.name || (t.type === 'transfer' ? 'Transfer' : 'Transaction'))}</div>
            <div class="text-xs text-zinc-500 truncate">${subline}</div>
          </div>
          <div class="text-right">
            <div class="font-semibold ${color}">${sign}${this.#fx.formatMoney(displayAmount, displayCurrency)}</div>
          </div>
        </label>`;
    }

    // ── Normal mode ───────────────────────────────────────────────────
    const title  = this.#esc(t.payee || cat?.name || (t.type === 'transfer' ? 'Transfer' : 'Transaction'));
    const hijriShort = this.#hijri.monthsShort;
    const badges = [
      state.user?.showHijri ? this.#hijriBadge(t.date) : '',
      Array.isArray(t.splits) && t.splits.length
        ? `<span class="chip" style="font-size:.65rem;padding:.1rem .4rem">↗ ${t.splits.length} splits</span>` : '',
      t.recurring
        ? `<span class="chip" style="font-size:.65rem;padding:.1rem .4rem" title="Repeats ${this.#esc(t.recurring.rule)}">⟳ ${this.#esc(t.recurring.rule)}</span>` : '',
      t.recurringSourceId
        ? `<span class="chip" style="font-size:.65rem;padding:.1rem .4rem;opacity:.65">⟳</span>` : '',
      !isShared && t._fromFamily
        ? `<span class="chip" style="font-size:.58rem;padding:.1rem .3rem;background:#818cf822;color:#818cf8">family</span>` : '',
    ].filter(Boolean).join('');

    const rowBody = `
      <div class="icon-pill desk-only" style="background:${safeColor}22;color:${safeColor}">
        <i data-lucide="${safeIcon}"></i>
      </div>
      <div class="flex-1 min-w-0">
        <div class="desk-only">
          <div class="font-medium truncate flex items-center gap-1.5">${title}${badges}</div>
          <div class="text-xs text-zinc-500 truncate">
            ${subline}${t.addedBy ? ` · by ${this.#esc(t.addedBy)}` : ''}
          </div>
        </div>
        <div class="phone-only">
          <div class="text-sm font-medium truncate">${phoneTitle}</div>
          ${phoneSub ? `<div class="text-xs text-zinc-500 truncate">${phoneSub}</div>` : ''}
        </div>
      </div>
      <div class="tx-amount text-right">
        <div class="tx-amount-main font-semibold ${color}">${sign}${this.#fx.formatMoney(displayAmount, displayCurrency)}</div>
        ${origLine}
      </div>
      ${this.#phoneDate(t.date, hijriDate, hijriShort)}`;

    const inner = clickFn
      ? `<button onclick="${clickFn}" class="tx-row-content w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900 transition">${rowBody}</button>`
      : `<div class="tx-row-content w-full flex items-center gap-3 px-3 py-2.5">${rowBody}</div>`;

    // Swipe reveals this button; it is not a passive backdrop. Nothing is
    // destroyed until it is deliberately tapped, which is what stops a curved
    // scroll gesture from ever reaching a delete.
    return canDeleteRow
      ? `<div class="tx-swipe-wrapper"
             ontouchstart="window.__app.onTxSwipeStart(event,'${jsId}',${shareIndex !== null ? idxNum : -1},${isOwnContrib})"
             ontouchmove="window.__app.onTxSwipeMove(event)"
             ontouchend="window.__app.onTxSwipeEnd()"
             ontouchcancel="window.__app.onTxSwipeCancel()">
           <button type="button" class="tx-delete-bg" data-swipe-delete
                   aria-label="Delete transaction"
                   onclick="window.__app.commitSwipeDelete()">
             <i data-lucide="trash-2" style="color:white;width:18px;height:18px"></i>
           </button>
           ${inner}
         </div>`
      : inner;
  }

  /**
   * Which way a transfer leg moved money. The leg's own sign says so in an
   * account's view; in the global list the stored direction does
   * (out: this account → the other; in: the other → this one).
   * @returns {{arrow: string, text: string}} text is HTML-escaped
   */
  /** The row's date, right-aligned on phones (the list has no day headers there). */
  #phoneDate(iso, hijriDate, hijriShort) {
    if (!iso) return '';
    const g = new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const h = hijriDate ? `<div>${hijriDate.day} ${this.#esc(hijriShort[hijriDate.month] || '')}</div>` : '';
    return `<div class="phone-only tx-date shrink-0 text-right text-xs text-zinc-500 leading-snug"><div>${this.#esc(g)}</div>${h}</div>`;
  }

  #transferRoute(t, sign, acc, other) {
    const here  = this.#esc(acc?.name || '—');
    const there = this.#esc(other?.name || '—');
    const dir = sign === '-' ? 'out' : sign === '+' ? 'in' : t.transferDir;
    if (dir === 'out') return { arrow: '→', text: `${here} → ${there}` };
    if (dir === 'in')  return { arrow: '←', text: `${there} → ${here}` };
    return { arrow: '↔', text: `${here} ↔ ${there}` };
  }

  #hijriBadge(iso) {
    const state = this.#store.getState();
    if (!state.user?.showHijri) return '';
    const top = this.#hijri.topMiqaat(this.#hijri.miqaatsForGregorian(iso));
    if (!top) return '';
    const color = top.p === 1 ? '#f59e0b' : top.p === 2 ? '#a855f7' : '#94a3b8';
    return `<span title="${this.#esc(top.t)}" class="inline-flex items-center" style="color:${color}">
      <i data-lucide="moon-star" style="width:13px;height:13px"></i>
    </span>`;
  }

  #getAccount(id) {
    return this.#store.getState().accounts.find((a) => a.id === id) || null;
  }

  #esc(s) {
    return Html.escape(s);
  }
}
