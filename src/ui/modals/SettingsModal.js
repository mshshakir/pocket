/**
 * SettingsModal — App preferences: currency, date format, theme,
 * Hijri calendar, data import/export, cloud sync, AI receipt scanner.
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { HijriCalendarService } from '../../domain/services/HijriCalendarService.js';
import { CURRENCIES }      from '../../data/constants.js';

export class SettingsModal {
  /** @type {Store} */                #store;
  /** @type {CurrencyService} */      #fx;
  /** @type {HijriCalendarService} */ #hijri;

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
    this.#hijri = new HijriCalendarService();
  }

  render() {
    const state    = this.#store.getState();
    const u        = state.user;
    const isSaaS   = window.__app?.isManagedMode?.() ?? true;
    const sbUser   = window.__app?.getSbUser?.() ?? null;

    return `
      <div class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">Settings</h3>
          <button class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>

        <!-- Home currency -->
        <div class="card-muted p-3 mb-3">
          <label class="text-xs text-zinc-500">Home currency</label>
          <div class="text-xs text-zinc-500 mb-1">All balances and totals are converted to this currency.</div>
          <select class="select" onchange="window.__app.setHomeCurrency(this.value)">
            ${CURRENCIES.map((c) => `<option value="${c}" ${u.homeCurrency === c ? 'selected' : ''}>${this.#fx.label(c)}</option>`).join('')}
          </select>
        </div>

        <!-- Default currency -->
        <div class="card-muted p-3 mb-3">
          <label class="text-xs text-zinc-500">Default currency for new entries</label>
          <div class="text-xs text-zinc-500 mb-1">Pre-selected when adding a transaction, account, budget, or regular item.</div>
          <select class="select" onchange="window.__app.setDefaultCurrency(this.value)">
            ${CURRENCIES.map((c) => `<option value="${c}" ${u.defaultCurrency === c ? 'selected' : ''}>${this.#fx.label(c)}</option>`).join('')}
          </select>
        </div>

        <!-- Date format -->
        <div class="card-muted p-3 mb-3">
          <label class="text-xs text-zinc-500">Date format</label>
          <div class="text-xs text-zinc-500 mb-1">Used everywhere dates are displayed.</div>
          <select class="select" onchange="window.__app.setDateFormat(this.value)">
            <option value="auto"       ${u.dateFormat === 'auto'       ? 'selected' : ''}>Auto (system locale)</option>
            <option value="YYYY-MM-DD" ${u.dateFormat === 'YYYY-MM-DD' ? 'selected' : ''}>YYYY-MM-DD (2026-05-20)</option>
            <option value="MM/DD/YYYY" ${u.dateFormat === 'MM/DD/YYYY' ? 'selected' : ''}>MM/DD/YYYY (05/20/2026)</option>
            <option value="DD/MM/YYYY" ${u.dateFormat === 'DD/MM/YYYY' ? 'selected' : ''}>DD/MM/YYYY (20/05/2026)</option>
          </select>
        </div>

        <!-- Theme -->
        <div class="card-muted p-3 mb-3">
          <label class="text-xs text-zinc-500 mb-1 block">Theme</label>
          <div class="grid grid-cols-3 gap-2">
            ${['light', 'dark', 'system'].map((t) => `
              <button class="btn ${u.theme === t ? 'btn-primary' : 'btn-outline'} justify-center"
                      onclick="window.__app.setTheme('${t}')">${t}</button>
            `).join('')}
          </div>
        </div>

        <!-- Hijri calendar -->
        <div class="card-muted p-3 mb-3">
          <div class="flex items-start gap-3">
            <div class="icon-pill" style="background:#0ea5e922;color:#0ea5e9"><i data-lucide="moon-star"></i></div>
            <div class="flex-1">
              <div class="font-medium text-sm">Hijri calendar</div>
              <div class="text-xs text-zinc-500">Show Hijri dates and miqaats from the Mumineen Calendar</div>
            </div>
            <button class="btn ${u.showHijri ? 'btn-primary' : 'btn-outline'}"
                    onclick="window.__app.toggleHijri()">${u.showHijri ? 'On' : 'Off'}</button>
          </div>
          ${u.showHijri ? `<div class="text-xs text-zinc-500 mt-2 pl-12">Today is ${this.#hijri.format(new Date(), { long: true })}</div>` : ''}
          ${u.showHijri ? `
            <div class="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <label class="text-xs text-zinc-500 mb-1 block">Calendar view default</label>
              <div class="grid grid-cols-3 gap-2">
                ${[['gregorian', 'Gregorian'], ['both', 'Both dates'], ['hijri', 'Hijri']].map(([k, l]) => `
                  <button class="btn ${(u.calendarMode || 'both') === k ? 'btn-primary' : 'btn-outline'} justify-center"
                          onclick="window.__app.setCalendarMode('${k}')">${l}</button>
                `).join('')}
              </div>
            </div>` : ''}
        </div>

        <!-- Migrate from CSV -->
        <div class="card-muted p-3 mb-3">
          <div class="flex items-start gap-3 mb-3">
            <div class="icon-pill" style="background:#10b98122;color:#10b981"><i data-lucide="file-down"></i></div>
            <div class="flex-1">
              <div class="font-medium text-sm">Migrate from another app</div>
              <div class="text-xs text-zinc-500">
                Download the CSV template, paste your transactions, then re-upload.
                Accounts, categories and subcategories are auto-created.
                Transfers, currencies, notes, payees and tags are preserved.
                <span class="text-zinc-700 dark:text-zinc-300">Dates:</span>
                <code>YYYY-MM-DD</code> is preferred (e.g. <code>2026-05-22</code>), but
                <code>DD/MM/YYYY</code>, <code>MM/DD/YYYY</code>, and <code>YYYY/MM/DD</code>
                also work — ambiguous slash dates follow your Settings → Date format preference.
                <span class="text-zinc-700 dark:text-zinc-300">Splits:</span> rows that share
                the same <code>SplitOf</code> value are merged into one transaction.
                <span class="text-zinc-700 dark:text-zinc-300">Debts:</span> use
                <code>borrowed</code> or <code>lent</code> as the Type.
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <button class="btn btn-outline justify-center"
                    onclick="window.__app.downloadImportTemplate()">
              <i data-lucide="download"></i> Download template
            </button>
            <label class="btn btn-primary justify-center cursor-pointer">
              <i data-lucide="upload"></i> Import CSV
              <input type="file" accept=".csv,text/csv" class="hidden"
                     onchange="window.__app.startImport(this)">
            </label>
          </div>
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
                    onclick="window.__app.resetData()">
              <i data-lucide="rotate-ccw"></i> Reset data
            </button>
          </div>
        </div>

        <!-- Cloud sync -->
        <div class="card-muted p-3 mb-3">
          <div class="flex items-start gap-3 mb-3">
            <div class="icon-pill" style="background:#10b98122;color:#10b981"><i data-lucide="cloud"></i></div>
            <div class="flex-1">
              <div class="font-medium text-sm">Cloud Sync &amp; Multi-device</div>
              <div class="text-xs text-zinc-500">
                ${isSaaS
                  ? 'All your devices stay in sync. Sign in to access your data anywhere.'
                  : 'Connect your own free <a href="https://supabase.com" target="_blank" class="underline">Supabase</a> project. All your devices stay in sync in real time.'}
              </div>
            </div>
            ${sbUser ? `<span class="chip" style="background:#10b98122;color:#10b981"><i data-lucide="check-circle-2" style="width:11px;height:11px;display:inline"></i> Connected</span>` : ''}
          </div>

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

            <details class="text-xs">
              <summary class="cursor-pointer text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 select-none">
                <strong>One-time setup: SQL to run in Supabase →</strong>
              </summary>
              <div class="mt-2 rounded-lg overflow-hidden">
                <div class="bg-zinc-900 text-zinc-100 p-3 rounded-lg text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre js-sql-block">-- Run this once in Supabase → SQL Editor
create table if not exists public.user_data (
  id   uuid references auth.users on delete cascade primary key,
  data jsonb not null default '{}',
  updated_at timestamptz default now()
);
alter table public.user_data enable row level security;
create policy "Users own their data"
  on public.user_data for all
  using  (auth.uid() = id)
  with check (auth.uid() = id);
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger user_data_updated_at
  before update on public.user_data
  for each row execute function public.touch_updated_at();
-- Enable real-time for the table:
alter publication supabase_realtime add table public.user_data;

-- ── Family sharing table (run this too) ──────────────────────────────
create table if not exists public.family_shares (
  owner_id     uuid references auth.users on delete cascade not null,
  member_email text not null,
  snapshot     jsonb not null default '{}',
  updated_at   timestamptz default now(),
  primary key (owner_id, member_email)
);
alter table public.family_shares enable row level security;
create policy "owner_manages_shares"
  on public.family_shares for all
  using  (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
create policy "member_reads_shares"
  on public.family_shares for select
  using (member_email = lower((auth.jwt()->>'email')));
create trigger family_shares_updated_at
  before update on public.family_shares
  for each row execute function public.touch_updated_at();</div>
                <button class="btn btn-outline w-full mt-1 justify-center text-xs"
                        onclick="window.__app.copySql()">
                  <i data-lucide="copy"></i> Copy SQL
                </button>
              </div>
            </details>
          `}
        </div>

        <!-- AI Receipt Scanner -->
        <div class="card-muted p-3 mb-3">
          <div class="flex items-start gap-3 mb-2">
            <div class="icon-pill" style="background:#4285f422;color:#4285f4"><i data-lucide="scan-line"></i></div>
            <div class="flex-1">
              <div class="font-medium text-sm">AI Receipt Scanner</div>
              <div class="text-xs text-zinc-500">
                Powered by <strong>Gemini 2.0 Flash</strong> (Google AI).
                Free tier: 1,500 scans/day — no credit card needed.
                Get a free key at
                <a href="https://aistudio.google.com/apikey" target="_blank" class="underline">aistudio.google.com/apikey</a>.
                Reads the receipt image, maps line items to your categories, and pre-fills splits automatically.
              </div>
            </div>
          </div>
          <div class="relative">
            <input id="geminiKeyInput" class="input pr-20" type="password"
                   placeholder="AIzaSy..."
                   value="${this.#esc(u.geminiApiKey || '')}"
                   oninput="window.__app.setGeminiKey(this.value.trim())">
            <button type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                    onclick="(()=>{ const i=document.getElementById('geminiKeyInput'); i.type=i.type==='password'?'text':'password'; })()">
              Show/Hide
            </button>
          </div>
          <div class="text-xs text-zinc-500 mt-1">Key is stored only in your browser (localStorage). Only sent to <code>generativelanguage.googleapis.com</code>.</div>
        </div>

        <div class="text-xs text-zinc-500 text-center mt-4">Pocket · v2.0</div>
      </div>`;
  }

  #esc(s) {
    return (s || '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }
}
