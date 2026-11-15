/**
 * RegularItemModal — Create / edit a regular-purchase item.
 *
 * A "regular item" is a named recurring purchase (e.g. "Morning coffee")
 * that the user can quick-log from the Calendar view. Each log creates a
 * real transaction linked to the item via regularItemId.
 *
 * The default account may be one a family member has shared. That is stored as
 * accountId + sharedOwnerId (see AccountRef); logging such an item submits a
 * contribution to the OWNER's book instead of writing locally, so the default
 * category has to come from the owner's tree too.
 *
 * Fields: name, defaultAmount, currency, accountId, sharedOwnerId, categoryId,
 *         frequency, icon, color
 *
 * "Pay the vendor later" items (milk, newspaper) also carry the usual pattern —
 * payLater, usualQty, usualDays, unit, vendor, trackFrom — see DeliveryPlan.
 * They are not logged day by day: the calendar works out each day from the
 * pattern, and paying the vendor records the expense (VendorDues).
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { CURRENCIES }      from '../../data/constants.js';
import { CategoryField }   from '../components/CategoryField.js';
import { AccountRef }      from '../../domain/services/AccountRef.js';
import { DeliveryPlan }    from '../../domain/services/DeliveryPlan.js';
import { DateService }     from '../../domain/services/DateService.js';
import { NotifyField }     from '../components/NotifyField.js';

const ITEM_ICONS = [
  'coffee','shopping-basket','bus','dumbbell','utensils','heart-pulse',
  'book','music','film','gift','paw-print','baby','graduation-cap',
  'wifi','phone','home','car','plane','tag',
];

const ITEM_COLORS = [
  '#f97316','#3b82f6','#10b981','#8b5cf6','#ec4899',
  '#ef4444','#f59e0b','#06b6d4','#84cc16','#6366f1',
];

export class RegularItemModal {
  /** @type {Store} */           #store;
  /** @type {CurrencyService} */ #fx;

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
  }

  render(opts = {}) {
    const { id } = opts;
    const state   = this.#store.getState();
    const editing = id ? (state.regularItems || []).find((i) => i.id === id) : null;

    const home = state.user.homeCurrency || 'USD';
    const data  = editing ? { ...editing } : {
      name:          '',
      defaultAmount: 0,
      currency:      home,
      accountId:     window.__app?.accountService?.defaultId?.() || state.accounts[0]?.id || '',
      sharedOwnerId: null,
      categoryId:    '',
      icon:          'coffee',
      color:         ITEM_COLORS[0],
      payLater:      opts.payLater === true,
    };

    const amountVal = editing
      ? this.#fx.fromMinor(editing.defaultAmount, editing.currency)
      : 0;

    // The <select> value encodes which book the account lives in, so submit can
    // tell a shared account apart from a local one with the same-shaped id.
    const accRef  = AccountRef.fromRecord(data);
    const accValue= accRef.toValue();

    // Shared accounts you can actually write to. A 'view' grant is read-only, so
    // offering it here would only produce a rejected contribution later.
    const shares  = (state._sharedData || []).filter((s) =>
      (s.accounts || []).some((a) => (s.permission || {})[a.id] !== 'view'));

    const sharedGroups = shares.map((share) => {
      const opts = (share.accounts || [])
        .filter((a) => (share.permission || {})[a.id] !== 'view')
        .map((a) => {
          const val = new AccountRef(a.id, share._ownerId).toValue();
          return `<option value="${this.#esc(val)}" ${accValue === val ? 'selected' : ''}>${this.#esc(a.name)}</option>`;
        }).join('');
      const who = share.sharedBy || 'Family';
      return opts ? `<optgroup label="Shared by ${this.#esc(who)}">${opts}</optgroup>` : '';
    }).join('');

    // A shared default account means the log lands in the owner's book, so the
    // default category must be one of THEIR categories — subcategories included.
    const ownerShare = accRef.isShared
      ? shares.find((s) => s._ownerId === accRef.ownerId)
      : null;
    const catList    = ownerShare ? (ownerShare.categories || []) : state.categories;

    return `
      <form id="regularItemForm"
            onsubmit="window.__app.submitRegularItem(event,'${editing?.id || ''}')"
            class="p-5" style="min-width:320px;max-width:480px">

        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">${editing ? (editing.payLater ? 'Edit delivery' : 'Edit shortcut') : data.payLater ? 'New delivery' : 'New shortcut'}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        <!-- Name -->
        <div class="mb-3">
          <label class="text-xs text-zinc-500">Name</label>
          <input class="input" name="name" required placeholder="${data.payLater ? 'e.g. Milk' : 'e.g. Morning coffee'}"
                 value="${this.#esc(data.name)}" autofocus>
        </div>

        <!-- Amount + Currency -->
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500" data-price-label>${data.payLater ? 'Price per unit' : 'Default amount'}</label>
            <input class="input" name="defaultAmount" type="number" step="${CurrencyService.stepFor(data.currency)}" min="0"
                   placeholder="0.00" value="${amountVal || ''}">
          </div>
          <div>
            <label class="text-xs text-zinc-500">Currency</label>
            <select class="select" name="currency">
              ${CURRENCIES.map((c) => `<option value="${c}" ${data.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Account -->
        <div class="mb-3">
          <label class="text-xs text-zinc-500">Default account</label>
          <select class="select" name="accountId"
                  onchange="window.__app.onRegularAccountChange(this.value)">
            <option value="">— None —</option>
            <optgroup label="My accounts">
              ${state.accounts.map((a) => `<option value="${this.#esc(a.id)}" ${accValue === a.id ? 'selected' : ''}>${this.#esc(a.name)}</option>`).join('')}
            </optgroup>
            ${sharedGroups}
          </select>
          <div class="text-[11px] text-zinc-500 mt-1" data-regular-shared-note
               style="${accRef.isShared ? '' : 'display:none'}">
            Entries logged from this item go to the owner's book for approval.
          </div>
        </div>

        <!-- Category -->
        <div class="mb-4">
          <label class="text-xs text-zinc-500">Default category</label>
          ${CategoryField.render({
            id:         'regularItemCategory',
            name:       'categoryId',
            value:      data.categoryId,
            type:       'expense',
            title:      accRef.isShared ? 'Choose a category from their book' : 'Default category',
            categories: catList,
            ownerId:    accRef.ownerId || '',
          })}
        </div>

        <!-- How it's paid -->
        ${this.#payment(data, editing)}

        <!-- Icon -->
        <div class="mb-3">
          <label class="text-xs text-zinc-500 block mb-1">Icon</label>
          <div class="flex flex-wrap gap-2">
            ${ITEM_ICONS.map((ic) => `
              <label class="cursor-pointer">
                <input type="radio" name="icon" value="${ic}" class="sr-only" ${data.icon === ic ? 'checked' : ''}>
                <div class="w-9 h-9 rounded-xl grid place-items-center border-2 transition-colors
                            ${data.icon === ic ? 'border-zinc-900 dark:border-white bg-zinc-100 dark:bg-zinc-800' : 'border-transparent hover:border-zinc-300'}">
                  <i data-lucide="${ic}" style="width:16px;height:16px"></i>
                </div>
              </label>`).join('')}
          </div>
        </div>

        <!-- Color -->
        <div class="mb-5">
          <label class="text-xs text-zinc-500 block mb-1">Color</label>
          <div class="flex flex-wrap gap-2">
            ${ITEM_COLORS.map((col) => `
              <label class="cursor-pointer">
                <input type="radio" name="color" value="${col}" class="sr-only" ${data.color === col ? 'checked' : ''}>
                <div class="w-7 h-7 rounded-full border-2 transition-colors
                            ${data.color === col ? 'border-zinc-900 dark:border-white' : 'border-transparent'}"
                     style="background:${col}"></div>
              </label>`).join('')}
          </div>
        </div>

        <div class="flex items-center gap-2">
          ${editing ? `
            <button type="button" class="btn btn-outline text-rose-500"
                    onclick="window.__app.deleteRegularItem('${editing.id}')">
              <i data-lucide="trash-2"></i> Delete
            </button>` : ''}
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i data-lucide="check"></i> Save
          </button>
        </div>
      </form>`;
  }

  /**
   * "Each time" (logged when bought) or "Pay the vendor later" (a usual
   * pattern; the calendar fills in each day, exceptions are marked there).
   */
  #payment(data, editing) {
    const later = data.payLater === true;
    const plan  = new DeliveryPlan(data);
    const days  = plan.usualDays;
    const today = DateService.toIso(new Date());
    const toggle = "const f=this.form, l=this.value==='later';"
      + "f.querySelector('[data-later]').hidden=!l;"
      + "f.querySelector('[data-price-label]').textContent=l?'Price per unit':'Default amount';";
    return `
        <div class="mb-4">
          <label class="text-xs text-zinc-500 block mb-1">What is it?</label>
          <div class="grid grid-cols-2 gap-2">
            <label class="pay-choice">
              <input type="radio" name="pay" value="each" ${later ? '' : 'checked'} onchange="${toggle}">
              <span><b>Shortcut</b><small>Something you buy often; one tap fills a new entry, e.g. coffee</small></span>
            </label>
            <label class="pay-choice">
              <input type="radio" name="pay" value="later" ${later ? 'checked' : ''} onchange="${toggle}">
              <span><b>Delivery</b><small>Comes most days, you pay the vendor monthly, e.g. milk</small></span>
            </label>
          </div>
        </div>

        <div data-later ${later ? '' : 'hidden'} class="mb-4 later-box">
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="text-xs text-zinc-500">Usual quantity</label>
              <input class="input" name="usualQty" type="number" min="0" step="any" value="${plan.usualQty}">
            </div>
            <div>
              <label class="text-xs text-zinc-500">Unit (optional)</label>
              <input class="input" name="unit" maxlength="12" placeholder="L, packet, visit" value="${this.#esc(data.unit || '')}">
            </div>
          </div>
          <label class="text-xs text-zinc-500 block mb-1">Comes on</label>
          <div class="day-picks mb-3">
            ${DeliveryPlan.DAY_NAMES.map((n, i) => `
              <label><input type="checkbox" name="usualDays" value="${i}" ${days.includes(i) ? 'checked' : ''}><span>${n[0]}</span></label>`).join('')}
          </div>
          <div class="grid grid-cols-2 gap-3 mb-2">
            <div>
              <label class="text-xs text-zinc-500">Paid to (optional)</label>
              <input class="input" name="vendor" maxlength="40" placeholder="e.g. Doodhwala" value="${this.#esc(data.vendor || '')}">
            </div>
            <div>
              <label class="text-xs text-zinc-500">${editing?.payLater ? 'Counting since' : 'Start counting from'}</label>
              <input class="input" name="trackFrom" type="date" value="${this.#esc(plan.trackFrom || today)}">
            </div>
          </div>
          ${editing?.payLater ? `
          <div>
            <label class="text-xs text-zinc-500">If you changed the price, it applies from</label>
            <input class="input" name="priceFrom" type="date" value="${today}">
          </div>` : ''}
          <div class="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
            <div class="text-xs font-medium mb-2">Morning check-in on Telegram</div>
            ${NotifyField.gate(`${NotifyField.render({ prefix: 'checkin', value: data.checkinTo || 'all', email: data.checkinEmail,
              me: window.__app?.currentUserEmail?.() || null, family: this.#store.getState().family || [], label: 'Sent to' })}
            <div class="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label class="text-xs text-zinc-500">At</label>
                <input class="input" type="time" name="checkinTime" value="${RegularItemModal.time(data.checkinMinute ?? 540)}">
              </div>
              <div>
                <label class="text-xs text-zinc-500">Time zone</label>
                <select class="select" name="checkinTz">${RegularItemModal.zones(data.checkinTz)}</select>
              </div>
            </div>`)}
            <div class="text-[11px] text-zinc-500 mt-1">Asks what came, with buttons; the first answer counts for everyone. "Everyone" is you and family members who can add to this account; "Family group" is the Telegram group of a shared space with this account. People need Telegram linked (/link in the bot).</div>
          </div>
          <div class="text-[11px] text-zinc-500 mt-2 leading-relaxed">
            Each day is filled in from this pattern; on the calendar, mark only the days that were different.
            Nothing is spent until you pay the vendor, under <b>Regulars → Deliveries</b>.
            Items with the same "Paid to" are settled together.
          </div>
        </div>`;
  }

  /** 540 → "09:00". */
  static time(minute) {
    const m = Math.max(0, Math.min(1439, Number(minute) || 0));
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  /** "09:30" → 570 (9 am when unreadable). */
  static minute(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    return m ? Math.min(1439, Number(m[1]) * 60 + Number(m[2])) : 540;
  }

  /** Common zones plus this device's, the item's chosen one selected (this device's by default). */
  static zones(chosen) {
    let here = 'Asia/Kolkata';
    try { here = Intl.DateTimeFormat().resolvedOptions().timeZone || here; } catch (_) { /* old browser */ }
    const pick = (chosen || here).replace(/^Asia\/Calcutta$/, 'Asia/Kolkata'); // the old name some devices report
    const list = [['Asia/Kolkata', 'India'], ['Africa/Nairobi', 'Kenya'], ['Africa/Dar_es_Salaam', 'Tanzania'], ['Asia/Dubai', 'UAE'],
      ['Asia/Riyadh', 'Saudi Arabia'], ['Asia/Karachi', 'Pakistan'], ['Europe/London', 'UK'], ['America/New_York', 'US East']];
    if (!list.some(([z]) => z === pick)) list.unshift([pick, pick.replace(/_/g, ' ')]);
    return list.map(([z, l]) => `<option value="${z}" ${z === pick ? 'selected' : ''}>${l}</option>`).join('');
  }

  #esc(s) {
    return (s || '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }
}
