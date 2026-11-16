/**
 * SettingsModal — App preferences in four tabs, so nothing needs a long scroll:
 *   General  currencies, defaults, date format, theme, Hijri calendar, install as an app
 *   Account  sign-in and cloud sync, plan, AI
 *   Data     Google Drive backup, move in (CSV), export / import, reset, saved copies
 *   Help     feedback and feature requests
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { HijriCalendarService } from '../../domain/services/HijriCalendarService.js';
import { CURRENCIES }      from '../../data/constants.js';
import { BookCleaner }     from '../../domain/services/BookCleaner.js';
import { PlanCard }        from '../components/PlanCard.js';
import { AppNotices }      from '../components/AppNotices.js';
import { BackupSchedule }  from '../../domain/services/BackupSchedule.js';

export class SettingsModal {
  /** @type {Store} */                #store;
  /** @type {CurrencyService} */      #fx;
  /** @type {HijriCalendarService} */ #hijri;
  /** @type {PlanCard} */             #planCard;
  /** @type {string} */               #tab = 'general';

  /** [key, label, icon] */
  static #TABS = [
    ['general', 'General', 'sliders-horizontal'],
    ['account', 'Account', 'user-round'],
    ['data',    'Data',    'database'],
    ['help',    'Help',    'life-buoy'],
  ];

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
    this.#hijri = new HijriCalendarService();
    this.#planCard = new PlanCard();
  }

  render() {
    const state    = this.#store.getState();
    const u        = state.user;
    const isSaaS   = window.__app?.isManagedMode?.() ?? true;
    const sbUser   = window.__app?.getSbUser?.() ?? null;
    const tab      = SettingsModal.#TABS.some(([k]) => k === this.#tab) ? this.#tab : 'general';
    const panel    = (key, html) => `<div data-settings-tab="${key}" ${key === tab ? '' : 'style="display:none"'}>${html}</div>`;

    return `
      <div class="p-5">
        <!-- Pinned while the panel scrolls, so Close and the tabs are always in reach on a phone. -->
        <div class="sheet-header">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold">Settings</h3>
            <button class="btn btn-ghost px-2.5" onclick="window.__app.closeModal()" aria-label="Close settings" title="Close">
              <i data-lucide="x"></i>
            </button>
          </div>
          <div class="grid grid-cols-4 gap-1 mt-2 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 settings-tabs" role="tablist">
            ${SettingsModal.#TABS.map(([k, label, icon]) => `
              <button type="button" role="tab" data-settings-tab-btn="${k}" aria-selected="${k === tab}"
                      class="flex flex-col sm:flex-row items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium ${k === tab ? 'bg-white dark:bg-zinc-900 shadow-sm' : 'text-zinc-500'}"
                      onclick="window.__app.setSettingsTab('${k}')">
                <i data-lucide="${icon}" style="width:15px;height:15px"></i>${label}
              </button>`).join('')}
          </div>
        </div>
        <div class="mt-3">
          ${panel('general', this.#general(u, state))}
          ${panel('account', this.#account(u, state, isSaaS, sbUser))}
          ${panel('data', this.#data(state))}
          ${panel('help', this.#help(sbUser))}
        </div>

        <!-- Phones: a Done button that stays at the bottom of the sheet. -->
        <div class="form-footer phone-only mt-4">
          <button class="btn btn-primary w-full justify-center py-3" onclick="window.__app.closeModal()">
            <i data-lucide="check"></i> Done
          </button>
        </div>
      </div>`;
  }

  /** The tab to show; kept across re-renders (every setting re-draws the sheet). */
  get tab() { return this.#tab; }
  set tab(key) { this.#tab = key; }

  /** General: currencies, defaults, date format, theme, Hijri calendar. */
  #general(u, state) {
    const ccy = (cur) => CURRENCIES.map((c) => `<option value="${c}" ${cur === c ? 'selected' : ''}>${this.#fx.label(c)}</option>`).join('');
    return `
        <div class="card-muted p-3 mb-3">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-zinc-500" title="All balances and totals are converted to this currency">Home currency</label>
              <select class="select" onchange="window.__app.setHomeCurrency(this.value)">${ccy(u.homeCurrency)}</select>
            </div>
            <div>
              <label class="text-xs text-zinc-500" title="Pre-selected on new entries, accounts, budgets and regulars">New entries in</label>
              <select class="select" onchange="window.__app.setDefaultCurrency(this.value)">${ccy(u.defaultCurrency)}</select>
            </div>
            <div>
              <label class="text-xs text-zinc-500" title="Pre-selected on new entries, debts and regulars">Default account</label>
              <select class="select" onchange="window.__app.setDefaultAccount(this.value)">
                <option value="" ${!u.defaultAccountId ? 'selected' : ''}>First in the list</option>
                ${state.accounts.filter((a) => !a.archived).map((a) =>
                  `<option value="${this.#escAttr(a.id)}" ${u.defaultAccountId === a.id ? 'selected' : ''}>${this.#esc(a.name)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="text-xs text-zinc-500" title="Pre-selected on the payment chips">Default payment</label>
              <select class="select" onchange="window.__app.setDefaultPaymentType(this.value)">
                ${this.#paymentTypes().map((p) =>
                  `<option value="${this.#escAttr(p)}" ${u.defaultPaymentType === p ? 'selected' : ''}>${this.#esc(p.charAt(0).toUpperCase() + p.slice(1))}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="text-xs text-zinc-500">Date format</label>
              <select class="select" onchange="window.__app.setDateFormat(this.value)">
                <option value="auto"       ${u.dateFormat === 'auto'       ? 'selected' : ''}>Auto</option>
                <option value="YYYY-MM-DD" ${u.dateFormat === 'YYYY-MM-DD' ? 'selected' : ''}>2026-05-20</option>
                <option value="MM/DD/YYYY" ${u.dateFormat === 'MM/DD/YYYY' ? 'selected' : ''}>05/20/2026</option>
                <option value="DD/MM/YYYY" ${u.dateFormat === 'DD/MM/YYYY' ? 'selected' : ''}>20/05/2026</option>
              </select>
            </div>
            <div>
              <label class="text-xs text-zinc-500">Theme</label>
              <select class="select" onchange="window.__app.setTheme(this.value)">
                ${[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']].map(([t, l]) => `<option value="${t}" ${u.theme === t ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        ${this.#renderHijriSection(u)}
        ${this.#install()}`;
  }

  /** Account: sign-in and sync, plan, AI. */
  #account(u, state, isSaaS, sbUser) {
    return `
        ${sbUser && isSaaS ? this.#planCard.html(window.__app.getPlan(), window.__app.planCatalogue, window.__app.paymentOffers, window.__app.buying, window.__app.coupon, window.__app.planUi) : ''}

        <!-- Cloud sync -->
        <div class="card-muted p-3 mb-3">
          <div class="flex items-start gap-3 mb-3">
            <div class="icon-pill" style="background:#10b98122;color:#10b981"><i data-lucide="cloud"></i></div>
            <div class="flex-1">
              <div class="font-medium text-sm">Cloud Sync &amp; Multi-device</div>
              <div class="text-xs text-zinc-500">
                ${isSaaS
                  ? (!sbUser ? 'Sign in to choose a plan. Sync and Family keep all your devices in sync.'
                     : window.__app.getPlan().can('sync') ? 'All your devices stay in sync.'
                     : 'Signed in. Your book stays on this device; cloud sync comes with Sync and Family.')
                  : 'Connect your own free <a href="https://supabase.com" target="_blank" class="underline">Supabase</a> project. All your devices stay in sync in real time.'}
              </div>
            </div>
            ${sbUser ? `<span class="chip" style="background:#10b98122;color:#10b981"><i data-lucide="check-circle-2" style="width:11px;height:11px;display:inline"></i> Connected</span>` : ''}
          </div>

          ${sbUser ? `
            <div class="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/70 dark:border-emerald-800/40">
              <div class="w-8 h-8 rounded-full bg-emerald-600 text-white grid place-items-center text-sm font-bold flex-shrink-0">${(sbUser.email?.[0] || '?').toUpperCase()}</div>
              <div class="flex-1 min-w-0">
                <div class="text-[11px] uppercase tracking-wide text-zinc-500 leading-none mb-0.5">Signed in as</div>
                <div class="text-sm font-medium truncate">${this.#esc(sbUser.email || '')}</div>
              </div>
              <i data-lucide="badge-check" style="width:18px;height:18px;color:#10b981"></i>
            </div>` : ''}

          ${isSaaS ? `
            <div class="flex gap-2 mb-1">
              ${sbUser
                ? `<button class="btn btn-outline flex-1 justify-center" onclick="window.__app.signOut()"><i data-lucide="log-out"></i> Sign out</button>`
                : `<button class="btn btn-primary flex-1 justify-center" onclick="window.__app.closeModal(); window.__app.openModal('auth',{})"><i data-lucide="log-in"></i> Sign in / Create account</button>`}
            </div>
          ` : `
            <div class="mb-2">
              <label class="text-xs text-zinc-500">Project URL</label>
              <input class="input" type="url" id="sbUrlInput"
                     placeholder="https://xxxx.supabase.co"
                     value="${this.#esc(u.supabaseUrl || '')}"
                     oninput="window.__app.setSbUrl(this.value.trim())">
            </div>
            <div class="mb-3">
              <label class="text-xs text-zinc-500">Anon / public key</label>
              <input class="input" type="password" id="sbKeyInput"
                     placeholder="eyJhbGciOi..."
                     value="${this.#esc(u.supabaseKey || '')}"
                     oninput="window.__app.setSbKey(this.value.trim())">
            </div>
            <div class="flex gap-2 mb-3">
              <button class="btn btn-primary flex-1 justify-center"
                      onclick="window.__app.connectSupabase()">
                <i data-lucide="plug"></i> Connect &amp; Sign in
              </button>
              ${sbUser ? `<button class="btn btn-outline justify-center" onclick="window.__app.signOut()"><i data-lucide="log-out"></i> Sign out</button>` : ''}
            </div>

            <div class="text-xs text-zinc-500 leading-relaxed">
              <strong class="text-zinc-700 dark:text-zinc-300">One-time setup:</strong>
              in your Supabase project's SQL Editor, run each file in
              <a href="https://github.com/mshshakir/pocket/tree/main/supabase/migrations" target="_blank" rel="noopener" class="underline">supabase/migrations</a>
              in order, oldest first.
            </div>
          `}
        </div>

        <!-- AI receipt scanning & voice entry: Pocket's own AI, paid from the plan -->
        <div class="card-muted p-3 mb-3">
          <div class="flex items-start gap-3">
            <div class="icon-pill" style="background:#3b82f622;color:#3b82f6"><i data-lucide="scan-line"></i></div>
            <div class="flex-1">
              <div class="font-medium text-sm">AI receipt scanning &amp; voice entry</div>
              <div class="text-xs text-zinc-500 leading-relaxed">
                Scan a receipt or say an entry from the Add form. Each scan or voice entry uses one AI credit;
                your allowance is under <strong>Your plan</strong>.${sbUser ? '' : ' Sign in to use it.'}
              </div>
            </div>
          </div>
        </div>

`;
  }

  /** Data: move in, export / import, reset, saved copies. */
  #data(state) {
    return `
        ${this.#driveBackup()}
        <!-- Migrate from another app (CSV) -->
        <div class="card-muted p-3 mb-3">
          <div class="flex items-center gap-2 mb-2">
            <i data-lucide="file-down" style="width:16px;height:16px" class="text-emerald-600"></i>
            <div class="font-medium text-sm flex-1">Move in from another app</div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <button class="btn btn-outline justify-center"
                    onclick="window.__app.downloadImportTemplate()">
              <i data-lucide="download"></i> Template
            </button>
            <label class="btn btn-primary justify-center cursor-pointer">
              <i data-lucide="upload"></i> Import CSV
              <input type="file" accept=".csv,text/csv" class="hidden"
                     onchange="window.__app.startImport(this)">
            </label>
          </div>
          <details class="mt-2 text-xs text-zinc-500">
            <summary class="cursor-pointer">How it works</summary>
            <div class="mt-1 leading-relaxed">
              Download the template, paste your transactions, then import it. Accounts, categories and
              subcategories are made for you; transfers, currencies, notes, payees and tags are kept.
              Dates: <code>YYYY-MM-DD</code> is best; <code>DD/MM/YYYY</code>, <code>MM/DD/YYYY</code> and
              <code>YYYY/MM/DD</code> also work (slash dates follow your date format). Rows sharing a
              <code>SplitOf</code> value become one split entry. For debts, use <code>borrowed</code> or
              <code>lent</code> as the Type.
            </div>
          </details>
        </div>
        <!-- Data -->
        <div class="card-muted p-3 mb-3">
          <div class="text-sm font-medium mb-2">Data</div>
          <div class="grid grid-cols-2 gap-2">
            <button class="btn btn-outline justify-center" onclick="window.__app.exportJson()">
              <i data-lucide="download"></i> Export JSON
            </button>
            <label class="btn btn-outline justify-center cursor-pointer">
              <i data-lucide="upload"></i> Import JSON
              <input type="file" accept="application/json" class="hidden"
                     onchange="window.__app.importJson(this)">
            </label>
            <button class="btn btn-outline justify-center"
                    onclick="window.__app.openModal('csv',{})">
              <i data-lucide="file-text"></i> Export CSV
            </button>
            <button class="btn btn-outline justify-center text-rose-500"
                    onclick="window.__app.resetData()"
                    title="Delete every transaction, account, budget and debt">
              <i data-lucide="rotate-ccw"></i> Reset data
            </button>
            ${BookCleaner.hasSample(state) ? `
            <button class="btn btn-outline justify-center col-span-2"
                    onclick="window.__app.removeSampleData()">
              <i data-lucide="eraser"></i> Remove sample data
            </button>` : ''}
          </div>
        </div>

        ${(() => {
          const backups = window.__app?.conflictBackups?.() ?? [];
          if (!backups.length) return '';
          return `
        <div class="card-muted p-3 mb-3" style="border-color:#fcd34d">
          <div class="text-sm font-medium mb-1 flex items-center gap-1.5 text-amber-600">
            <i data-lucide="history" style="width:14px;height:14px"></i> Recover a saved copy
          </div>
          <div class="text-xs text-zinc-500 mb-2">Kept when another device saved at the same moment. Restoring replaces this device's current data.</div>
          ${backups.map((b) => `
            <div class="flex items-center gap-2 py-1.5 border-t border-zinc-100 dark:border-zinc-800">
              <span class="flex-1 text-xs">${this.#esc(new Date(b.savedAt).toLocaleString())}</span>
              <button class="btn btn-outline text-xs" onclick="window.__app.restoreConflictBackup('${this.#esc(b.key)}')">Restore</button>
              <button class="btn btn-ghost text-xs text-rose-500" onclick="window.__app.discardConflictBackup('${this.#esc(b.key)}')">Discard</button>
            </div>`).join('')}
        </div>`;
        })()}

`;
  }

  /**
   * Google Drive backup: connect, how often, back up now, restore.
   * Hidden in the demo and until a Google client ID is set.
   */
  #driveBackup() {
    const d = window.__app?.driveStatus?.();
    if (!d || !d.available) return '';
    const head = `
          <div class="flex items-center gap-2 mb-1">
            <i data-lucide="cloud-upload" style="width:16px;height:16px" class="text-blue-600"></i>
            <div class="font-medium text-sm flex-1">Google Drive backup</div>
          </div>`;
    const how = `
          <details class="mt-2 text-xs text-zinc-500">
            <summary class="cursor-pointer">How it works</summary>
            <div class="mt-1 leading-relaxed">
              Each backup saves two files in a <b>Pocket backups</b> folder in your own Google Drive: your whole book
              (Pocket restores from this) and a CSV of every transaction (opens in any spreadsheet). The newest
              ${d.keep} backups are kept. Pocket can only see the files it saved there, nothing else in your Drive,
              and the files never pass through Pocket's servers. <b>Back up now</b> and <b>Restore</b> are free.
              With scheduled backups, Pocket shows <b>Back up now</b> when one is due, or saves it by itself
              if you switch on <b>Back up automatically</b>.
            </div>
          </details>`;
    if (!d.connected) {
      return `
        <div class="card-muted p-3 mb-3 drive-backup">${head}
          <div class="text-xs text-zinc-500 mb-2">Keep a copy of your book in your own Google Drive. Backing up and restoring are free.</div>
          <button class="btn btn-primary w-full justify-center drive-connect" onclick="window.__app.driveConnect()" ${d.busy ? 'disabled' : ''}>
            <i data-lucide="link"></i> ${d.busy ? 'Connecting…' : 'Connect Google Drive'}
          </button>${how}
        </div>`;
    }
    const last = d.lastAt ? AppNotices.day(d.lastAt) : 'not yet';
    return `
        <div class="card-muted p-3 mb-3 drive-backup">${head}
          <div class="text-xs text-zinc-500 mb-2">
            ${d.email ? `Connected to <b>${this.#esc(d.email)}</b>` : 'Connected'} · Last backup: <span class="drive-last">${this.#esc(last)}</span>${d.due ? ' · <span class="text-amber-600">due now</span>' : ''}
          </div>
          ${d.unlocked ? `
          <label class="text-xs text-zinc-500">Back up</label>
          <select class="select mb-2 drive-frequency" onchange="window.__app.driveSetFrequency(this.value)">
            ${BackupSchedule.choices().map((c) => `<option value="${c.key}" ${c.key === d.frequency ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>` : `
          <div class="flex items-start gap-3 mb-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 drive-unlock">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">Scheduled backups</div>
              <div class="text-xs text-zinc-500 leading-relaxed">
                Daily, weekly or monthly, and automatic if you like. A one-time add-on${d.offer ? ` of ${this.#esc(d.offer.price)}` : ''}; included in Sync and Family.
              </div>
            </div>
            <button type="button" class="btn btn-primary text-xs drive-unlock-buy" onclick="window.__app.driveUnlock()" ${d.busy || d.offer?.buying ? 'disabled' : ''}>
              ${d.offer?.buying ? 'Opening…' : d.offer ? `Unlock · ${this.#esc(d.offer.price)}` : 'Unlock'}
            </button>
          </div>`}
          ${d.unlocked && (d.automaticOffered || d.automatic) ? `
          <div class="flex items-start gap-3 mb-3 drive-auto">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">Back up automatically</div>
              <div class="text-xs text-zinc-500 leading-relaxed">
                ${d.automatic
                  ? 'On. When a backup is due, Pocket saves it by itself the next time you open it.'
                  : 'Off. When a backup is due, Pocket asks you to tap Back up now. Turn on to let it save by itself; Google will ask you once more to allow it.'}
              </div>
            </div>
            <button type="button" role="switch" aria-checked="${d.automatic}" class="btn ${d.automatic ? 'btn-primary' : 'btn-outline'} text-xs drive-auto-toggle"
                    onclick="window.__app.driveSetAutomatic(${!d.automatic})" ${d.busy ? 'disabled' : ''}>${d.automatic ? 'On' : 'Off'}</button>
          </div>` : ''}
          <div class="grid grid-cols-2 gap-2">
            <button class="btn btn-primary justify-center drive-now" onclick="window.__app.driveBackupNow()" ${d.busy ? 'disabled' : ''}>
              <i data-lucide="cloud-upload"></i> ${d.busy ? 'Backing up…' : 'Back up now'}
            </button>
            <button class="btn btn-outline justify-center drive-restore-open" onclick="window.__app.openDriveRestore()" ${d.busy ? 'disabled' : ''}>
              <i data-lucide="history"></i> Restore…
            </button>
          </div>
          <button class="w-full text-xs text-zinc-500 hover:text-rose-500 pt-2 drive-disconnect" onclick="window.__app.driveDisconnect()">
            Disconnect Google Drive
          </button>${how}
        </div>`;
  }

  /** Install Pocket as an app on this device (hidden once it is installed). */
  #install() {
    const i = window.__app?.installInfo?.();
    if (!i || i.installed) return '';
    return `
        <div class="card-muted p-3 mb-3 install-card">
          <div class="flex items-center gap-2 mb-1">
            <i data-lucide="smartphone" style="width:16px;height:16px" class="text-emerald-600"></i>
            <div class="font-medium text-sm flex-1">Install Pocket as an app</div>
          </div>
          <div class="text-xs text-zinc-500 ${i.canInstall ? 'mb-2' : ''}">
            Get Pocket on your home screen. It opens full screen and works without internet.
            ${i.canInstall ? '' : `<span class="install-steps">${this.#esc(i.steps)}</span>`}
          </div>
          ${i.canInstall ? `
          <button class="btn btn-primary w-full justify-center install-now" onclick="window.__app.installApp()">
            <i data-lucide="download"></i> Install Pocket
          </button>` : ''}
        </div>`;
  }

  /** Help: feedback and feature requests, version. */
  #help(sbUser) {
    return `
        <div class="card-muted p-3 mb-3">
          <div class="flex items-center gap-2 mb-1">
            <i data-lucide="message-square-heart" style="width:16px;height:16px" class="text-indigo-500"></i>
            <div class="font-medium text-sm">Feedback &amp; ideas</div>
          </div>
          <div class="text-xs text-zinc-500 mb-2">Tell us what’s working, what isn’t, or what you’d like Pocket to do. Every message is read.</div>
          <div class="grid grid-cols-2 gap-2">
            <button class="btn btn-outline justify-center settings-feedback" onclick="window.__app.openModal('feedback',{kind:'feedback'})">
              <i data-lucide="message-circle"></i> Send feedback
            </button>
            <button class="btn btn-outline justify-center settings-feature" onclick="window.__app.openModal('feedback',{kind:'feature'})">
              <i data-lucide="lightbulb"></i> Suggest a feature
            </button>
          </div>
          ${sbUser ? '' : '<div class="text-xs text-zinc-500 mt-2">Sign in to send.</div>'}
        </div>
        <div class="text-xs text-zinc-500 text-center mt-4">Pocket · v2.0</div>`;
  }

  /**
   * Renders the Hijri calendar settings section.
   * Extracted into a private method to avoid nested template-literal
   * escaping issues in the main render() return string.
   * @param {object} u  state.user
   * @returns {string} HTML
   */
  #renderHijriSection(u) {
    const toggleBtn = `
      <button class="btn ${u.showHijri ? 'btn-primary' : 'btn-outline'}"
              onclick="window.__app.toggleHijri()">${u.showHijri ? 'On' : 'Off'}</button>`;

    const offset = u.hijriOffset ?? 0;
    const todayHijri = u.showHijri ? this.#hijri.format(new Date(), { long: true }) : '';

    const offsetBadge = offset !== 0
      ? `<div class="text-xs mt-1 ${offset > 0 ? 'text-amber-600' : 'text-blue-600'}">
           Offset applied: ${offset > 0 ? '+' : ''}${offset} day${Math.abs(offset) !== 1 ? 's' : ''}
           <button class="ml-2 underline text-zinc-500"
                   onclick="window.__app.setHijriOffset(0)">reset</button>
         </div>`
      : '<div class="text-xs text-zinc-400 mt-1">No offset applied — using calculated date</div>';

    const calModes = [
      ['gregorian', 'Gregorian'],
      ['both',      'Both dates'],
      ['hijri',     'Hijri'],
    ];
    const calModeButtons = calModes.map(([k, l]) =>
      `<button class="btn ${(u.calendarMode || 'both') === k ? 'btn-primary' : 'btn-outline'} justify-center"
               onclick="window.__app.setCalendarMode('${k}')">${l}</button>`
    ).join('');

    const expandedSection = u.showHijri ? `
      <div class="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">

        <!-- Today's corrected date -->
        <div class="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-3 mb-3">
          <div class="text-xs text-zinc-500 mb-2">Today's Hijri date (after your correction)</div>
          <div class="text-base font-semibold">${todayHijri}</div>
          ${offsetBadge}
        </div>

        <!-- Day offset stepper -->
        <div class="mb-3">
          <label class="text-xs text-zinc-500 mb-2 block">
            Adjust if your local moon sighting differs from the calculated date
          </label>
          <div class="flex items-center gap-3">
            <button class="btn btn-outline px-4 text-lg font-bold"
                    onclick="window.__app.adjustHijriOffset(-1)"
                    ${offset <= -7 ? 'disabled' : ''}>−</button>
            <div class="flex-1 text-center">
              <div class="text-2xl font-bold tracking-tight">
                ${offset > 0 ? '+' : ''}${offset}
              </div>
              <div class="text-xs text-zinc-500">days</div>
            </div>
            <button class="btn btn-outline px-4 text-lg font-bold"
                    onclick="window.__app.adjustHijriOffset(+1)"
                    ${offset >= 7 ? 'disabled' : ''}>+</button>
          </div>
          <div class="text-xs text-zinc-400 text-center mt-2">
            Range: −7 to +7 days · Changes apply everywhere instantly
          </div>
        </div>

        <!-- Calendar view default -->
        <div>
          <label class="text-xs text-zinc-500 mb-1 block">Calendar view default</label>
          <div class="grid grid-cols-3 gap-2">
            ${calModeButtons}
          </div>
        </div>
      </div>` : '';

    return `
      <div class="card-muted p-3 mb-3">
        <div class="flex items-start gap-3">
          <div class="icon-pill" style="background:#0ea5e922;color:#0ea5e9">
            <i data-lucide="moon-star"></i>
          </div>
          <div class="flex-1">
            <div class="font-medium text-sm">Hijri calendar</div>
            <div class="text-xs text-zinc-500">Show Hijri dates and miqaats from the Mumineen Calendar</div>
          </div>
          ${toggleBtn}
        </div>
        ${expandedSection}
      </div>`;
  }

  #esc(s) {
    return (s || '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }

  /** Same escaping, named for the attribute-value context it is used in. */
  #escAttr(s) { return this.#esc(s); }

  /**
   * The payment methods offered in the default-method picker.
   *
   * Reads through the live service so a renamed or deleted method never lingers
   * here; falls back to the built-ins only if the service is somehow absent.
   * @returns {string[]}
   */
  #paymentTypes() {
    const offered = window.__app?.paymentTypeService?.allTypes?.() || ['card', 'cash', 'transfer', 'cheque', 'online'];
    const current = this.#store.getState().user?.defaultPaymentType;
    // Keep an out-of-list current value visible rather than silently showing
    // the user a different method as "selected".
    return (current && !offered.includes(current)) ? [current, ...offered] : offered;
  }
}
