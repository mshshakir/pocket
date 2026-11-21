/**
 * settings-feedback.smoke.mjs — the tabbed Settings, feedback & feature ideas, admin Feedback tab.
 *
 *   S1  Settings has General · Account · Data · Help; General shows, the rest wait
 *   S2  switching tabs shows that panel, and the tab survives a re-draw (changing a setting)
 *   S3  General is compact: currencies, defaults, date format and theme side by side (theme is one select)
 *   F1  Help tab has Send feedback and Suggest a feature; More has Feedback
 *   F2  signed out, the feedback window asks to sign in
 *   F3  signed in: Feedback / Feature idea toggle, message box, Send
 *   A1  admin Feedback tab: counts, filters by status and kind, moves a message along
 *   P1  no piggy-bank icon anywhere in the account form or the type list
 *
 * Run: node src/__smoke__/settings-feedback.smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nSettings & feedback suite');

const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function boot() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
    </body></html>`, { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('pocket.v1', JSON.stringify({
    user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri: false, hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [] },
    accounts: [{ id: 'a1', name: 'Bank', currency: 'INR', type: 'savings', color: '#3b82f6', icon: 'wallet', openingBalance: 0, balance: 0 }],
    categories: [], transactions: [], budgets: [], debts: [], family: [], merchantCategories: {}, accountGroups: [], regularItems: [],
  }));
  window.lucide = { createIcons() {} };
  window.Chart = function () { return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch = () => Promise.reject(new Error('offline'));
  window.confirm = () => true;
  window.alert = () => {};
  window.eval(bundleSrc);
  return window;
}
const w = boot();
await wait(100);
const app = w.__app;
const shown = (key) => w.document.querySelector(`[data-settings-tab="${key}"]`)?.style.display === '';
{
  app.openModal('settings');
  await wait(10);
  const tabs = [...w.document.querySelectorAll('[data-settings-tab-btn]')].map((b) => b.textContent.trim());
  ok('S1 five tabs: General · Account · Data · Add-ons · Help', tabs.join(' · ') === 'General · Account · Data · Add-ons · Help', tabs.join(' · '));
  ok('S1 General shows; Account, Data, Help are hidden', shown('general') && !shown('account') && !shown('data') && !shown('help'));
  app.setSettingsTab('data');
  ok('S2 Data tab shows Export JSON and Import CSV', shown('data') && !shown('general') && /Export JSON/.test(w.document.querySelector('[data-settings-tab="data"]').textContent) && /Import CSV/.test(w.document.querySelector('[data-settings-tab="data"]').textContent));
  app.setTheme?.('dark');
  await wait(10);
  ok('S2 after a setting re-draws the sheet, Data is still the open tab', shown('data'));
  app.setSettingsTab('general');
  const general = w.document.querySelector('[data-settings-tab="general"]');
  ok('S3 General: five settings in a two-column grid (no default payment), theme is a select', general.querySelectorAll('.grid.grid-cols-2 select').length === 5 && !!general.querySelector('select[onchange*="setTheme"]'));
  app.setSettingsTab('help');
  ok('F1 Help tab: Send feedback and Suggest a feature', shown('help') && w.document.querySelector('.settings-feedback') && w.document.querySelector('.settings-feature'));
  app.closeModal();
  app.navigate('__more');
  await wait(10);
  ok('F1 More has a Feedback button', !!w.document.querySelector('.more-feedback'));
  app.closeModal();
  app.openModal('feedback', { kind: 'feature' });
  await wait(10);
  ok('F2 signed out: asks to sign in, no message box', /Sign in to send feedback/.test(w.document.body.textContent) && !w.document.querySelector('form.feedback-form'));
  app.closeModal();
}
{
  // F3: the window for a signed-in person, rendered inside the page so the toggle can be driven
  const { FeedbackModal } = await import('../ui/modals/FeedbackModal.js');
  const html = new FeedbackModal({ signedIn: () => true }).render({ kind: 'feature' });
  const host = w.document.createElement('div');
  host.innerHTML = html;
  w.document.body.appendChild(host);
  const f = host.querySelector('form.feedback-form');
  ok('F3 opens as a Feature idea, with a message box and Send', f && f.querySelector('input[name="kind"]').value === 'feature' && f.querySelector('textarea[name="message"]') && /Send/.test(f.querySelector('button[type="submit"]').textContent));
  app.setFeedbackKind('feedback');
  ok('F3 switching to Feedback changes the kind and the hint, keeps the box', f.querySelector('input[name="kind"]').value === 'feedback' && /working/.test(f.querySelector('textarea').placeholder) && f.querySelector('[data-feedback-kind="feedback"]').classList.contains('btn-primary'));
  host.remove();
}
{
  const { FeedbackView } = await import('../admin/views/FeedbackView.js');
  const calls = [];
  const api = {
    feedback: async () => ({ counts: { new: 2, done: 1 }, items: [
      { id: 1, kind: 'feature', message: 'Dark mode for charts', email: 'a@x.com', page: 'reports', status: 'new', at: '2026-11-15T08:00:00Z' },
      { id: 2, kind: 'feedback', message: 'Love the merge', email: 'b@x.com', status: 'new', at: '2026-11-15T07:00:00Z' },
      { id: 3, kind: 'feedback', message: 'Old one', email: 'c@x.com', status: 'done', at: '2026-11-10T07:00:00Z' },
    ] }),
    setFeedback: async (id, status) => { calls.push([id, status]); return { id, status }; },
  };
  const v = new FeedbackView(api, { toast() {}, refresh: async () => {} });
  await v.load();
  let h = v.html();
  ok('A1 opens on New: two messages, counts All 3 · New 2 · Done 1', (h.match(/fb-item/g) || []).length === 2 && /All <span class="sub">3/.test(h) && /New <span class="sub">2/.test(h) && /Done <span class="sub">1/.test(h));
  await v.act('fb-kind', { dataset: { kind: 'feature' } });
  h = v.html();
  ok('A1 Feature ideas only: one message, with email, page and a Reply link', (h.match(/fb-item/g) || []).length === 1 && /Dark mode for charts/.test(h) && /a@x\.com/.test(h) && /from reports/.test(h) && /mailto:/.test(h));
  await v.act('fb-status', { dataset: { id: '1', status: 'planned' } });
  h = v.html();
  ok('A1 marking it Planned calls the server and moves it out of New', calls[0]?.[0] === 1 && calls[0]?.[1] === 'planned' && (h.match(/fb-item/g) || []).length === 0 && /Planned <span class="sub">1/.test(h));
}
{
  app.openModal('account', { id: 'a1' });
  await wait(10);
  const icons = [...w.document.querySelectorAll('input[name="icon"]')].map((i) => i.value);
  const acc = app.store.getState().accounts[0];
  ok('P1 no piggy-bank in the icon choices; a Savings account gets the vault', !icons.includes('piggy-bank') && acc.icon === 'vault', `${icons.join()} · ${acc.icon}`);
  ok('P1 no piggy-bank anywhere in the app bundle', !/piggy/.test(bundleSrc));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
