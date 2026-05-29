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

    const clickFn = isShared
      ? ((perm === 'edit' || perm === 'full') ? `window.__app.openSharedTxEdit(${shareIndex},'${t.id}')` : null)
      : `window.__app.openModal('transaction',{id:'${t.id}'})`;

    // Use deleteSharedContrib for own contributions; deleteSharedTx for full-access deletes
    const deleteFn = isShared
      ? (isOwnContrib
          ? `window.__app.deleteSharedContrib(${shareIndex},'${t.id}')`
          : `window.__app.deleteSharedTx(${shareIndex},'${t.id}')`)
      : `window.__app.deleteTx('${t.id}')`;

    // ── Sub-line ──────────────────────────────────────────────────────
    let subline = '';
    if (t.type === 'transfer' && t.transferPairId) {
      const pair  = txs.find((x) => x.id === t.transferPairId);
      const other = pair ? this.#getAccount(pair.accountId) : null;
      const arrow = sign === '-' ? '→' : sign === '+' ? '←' : '↔';
      subline = `Transfer ${arrow} ${this.#esc(other?.name || '—')}${pair && pair.currency !== t.currency ? ` · ${this.#fx.formatMoney(pair.amount, pair.currency)}` : ''}`;
    } else if (Array.isArray(t.splits) && t.splits.length) {
      if (account) {
        subline = `Split · ${t.splits.length} categor${t.splits.length === 1 ? 'y' : 'ies'} · ${this.#esc(account.name)}`;
      } else {
        const uniqAccs = new Set(t.splits.map((s) => s.accountId || t.accountId));
        subline = `Split across ${t.splits.length} categories · ${this.#esc(uniqAccs.size > 1 ? `${uniqAccs.size} accounts` : (acc?.name || ''))}`;
      }
    } else {
      const catName = this.#esc(catFullName(t.categoryId) || '—');
      const accName = this.#esc(acc?.name || '');
      subline = accName ? `${catName} · ${accName}` : catName;
    }

    const state = this.#store.getState();
    const hijriDate = state.user?.showHijri ? this.#hijri.toHijri(t.date) : null;
    const isSelected = selectedIds.has(t.id);

    // ── Multi-select mode ─────────────────────────────────────────────
    if (multiSelect) {
      return `
        <label class="w-full flex items-center gap-3 px-3 py-2.5 cursor-pointer ${isSelected ? 'bg-blue-50 dark:bg-blue-950' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'} transition">
          <input type="checkbox" ${isSelected ? 'checked' : ''}
                 onchange="window.__app.toggleTxSelection('${t.id}')"
                 class="w-4 h-4 rounded accent-blue-500"
                 onclick="event.stopPropagation()">
          <div class="icon-pill" style="background:${(cat?.color || '#71717a')}22;color:${cat?.color || '#71717a'}">
            <i data-lucide="${t.type === 'transfer' ? 'arrow-right-left' : (cat?.icon || 'circle')}"></i>
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
        ? `<span class="chip" style="font-size:.65rem;padding:.1rem .4rem" title="Repeats ${t.recurring.rule}">⟳ ${t.recurring.rule}</span>` : '',
      t.recurringSourceId
        ? `<span class="chip" style="font-size:.65rem;padding:.1rem .4rem;opacity:.65">⟳</span>` : '',
      !isShared && t._fromFamily
        ? `<span class="chip" style="font-size:.58rem;padding:.1rem .3rem;background:#818cf822;color:#818cf8">family</span>` : '',
    ].filter(Boolean).join('');

    const rowBody = `
      <div class="icon-pill" style="background:${(cat?.color || '#71717a')}22;color:${cat?.color || '#71717a'}">
        <i data-lucide="${t.type === 'transfer' ? 'arrow-right-left' : (cat?.icon || 'circle')}"></i>
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-medium truncate flex items-center gap-1.5">${title}${badges}</div>
        <div class="text-xs text-zinc-500 truncate">
          ${subline}${hijriDate ? ` · ${hijriDate.day} ${hijriShort[hijriDate.month]}` : ''}${t.addedBy ? ` · by ${this.#esc(t.addedBy)}` : ''}
        </div>
      </div>
      <div class="text-right">
        <div class="font-semibold ${color}">${sign}${this.#fx.formatMoney(displayAmount, displayCurrency)}</div>
        ${origLine}
      </div>`;

    const inner = clickFn
      ? `<button onclick="${clickFn}" class="tx-row-content w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900 transition">${rowBody}</button>`
      : `<div class="tx-row-content w-full flex items-center gap-3 px-3 py-2.5">${rowBody}</div>`;

    return canDeleteRow
      ? `<div class="tx-swipe-wrapper"
             ontouchstart="window.__app.onTxSwipeStart(event,'${t.id}',${shareIndex !== null ? shareIndex : -1},${isOwnContrib})"
             ontouchmove="window.__app.onTxSwipeMove(event)"
             ontouchend="window.__app.onTxSwipeEnd()">
           <div class="tx-delete-bg"><i data-lucide="trash-2" style="color:white;width:18px;height:18px"></i></div>
           ${inner}
         </div>`
      : inner;
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
    return (s || '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }
}
