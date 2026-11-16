/**
 * drive-backup.smoke.mjs — backups to the person's own Google Drive.
 *
 *   S1  schedule: off / daily / weekly / monthly by calendar days; never backed up = due
 *   F1  files: a book (JSON, no transient keys) and a CSV, paired by the time in the name
 *   C1  DriveClient: big files go up in two steps; a stale token is renewed once; full Drive says so
 *   U1  no client ID → no card; demo → no card
 *   U2  Settings → Data: Connect, then connected with the email, schedule and buttons
 *   U3  Back up now saves the book + CSV into "Pocket backups"; the book restores the same data
 *   U4  only the newest 10 backups are kept
 *   U5  a due backup shows a box and a top-bar icon; Back up now clears both; Later / close hides the box
 *       (icon stays, tap to reopen); the box returns after 3 days, and for the next due backup;
 *       the icon is green after a backup and shades to amber when due, then red when overdue
 *   U6  Restore lists backups and swaps the book (after asking)
 *   U7  closing Google's window, or a blocked pop-up, says so and changes nothing
 *   U8  another person's book on this device is "not connected" (never saved into this Drive)
 *   U9  Disconnect forgets the link; files stay in Drive
 *   U10 the folder deleted by the person is made again on the next backup
 *   A1  automatic backups are opt-in: off after Connect; the switch shows only when the server offers it
 *   A2  switching on asks Google once more; then a due backup saves by itself when Pocket opens — no window, no box
 *   A3  not again within half an hour, nor from a second tab; switching off goes back to the Back up now box
 *   A4  Google withdrew the permission: automatic turns itself off and the box asks for a tap
 *   A5  Google gave no lasting permission, or the window was closed: stays off, says why
 *   L1  without the add-on: Connect, Back up now and Restore work; no schedule, no automatic switch, an Unlock row
 *   L2  nothing is ever due, no icon, and nothing runs by itself — even with settings left over from before
 *   L3  Unlock asks a signed-out person to sign in first
 *   L4  once the add-on is recorded for this book, the schedule and the switch are back
 *
 * Run: node src/__smoke__/drive-backup.smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { FakeGoogleDrive } from './FakeGoogleDrive.mjs';
import { BackupSchedule } from '../domain/services/BackupSchedule.js';
import { BackupFiles } from '../domain/services/BackupFiles.js';
import { DriveClient } from '../domain/services/DriveClient.js';
import { GoogleTokenClient } from '../core/GoogleTokenClient.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nGoogle Drive backup suite');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await wait(10); } return false; };

// ── S1 schedule ──────────────────────────────────────────────────────────
{
  const at = (s) => new Date(s);
  ok('S1 off is never due', !new BackupSchedule('off').isDue(null, at('2026-11-16T08:00')));
  ok('S1 never backed up is due', new BackupSchedule('daily').isDue(null, at('2026-11-16T08:00')));
  ok('S1 daily: not again the same day, due the next morning',
    !new BackupSchedule('daily').isDue('2026-11-16T00:10:00', at('2026-11-16T23:50'))
    && new BackupSchedule('daily').isDue(at('2026-11-16T23:50').toISOString(), at('2026-11-17T00:05')));
  ok('S1 weekly: day 6 no, day 7 yes',
    !new BackupSchedule('weekly').isDue(at('2026-11-10T09:00').toISOString(), at('2026-11-16T09:00'))
    && new BackupSchedule('weekly').isDue(at('2026-11-09T09:00').toISOString(), at('2026-11-16T09:00')));
  ok('S1 monthly: 29 days no, 30 days yes',
    !new BackupSchedule('monthly').isDue(at('2026-10-18T09:00').toISOString(), at('2026-11-16T09:00'))
    && new BackupSchedule('monthly').isDue(at('2026-10-17T09:00').toISOString(), at('2026-11-16T09:00')));
  ok('S1 an unknown choice falls back to weekly; four choices offered', new BackupSchedule('hourly').key === 'weekly' && BackupSchedule.choices().length === 4);
}

// ── F1 files ─────────────────────────────────────────────────────────────
{
  const state = { user: { homeCurrency: 'INR' }, accounts: [{ id: 'a1' }], transactions: [{ id: 't1' }], _sharedData: [{ secret: 1 }] };
  const made = BackupFiles.make(state, 'Date,Type\n2026-11-16,expense', new Date(2026, 10, 16, 8, 16, 5));
  const [book, csv] = made.files;
  ok('F1 two files named by date and time', book.name === 'Pocket book 2026-11-16 081605.json' && csv.name === 'Pocket transactions 2026-11-16 081605.csv', `${book.name} | ${csv.name}`);
  ok('F1 the book leaves out transient (_) keys and reads back', !('_sharedData' in JSON.parse(book.body)) && BackupFiles.parseBook(book.body).transactions.length === 1);
  const groups = BackupFiles.group([
    { id: '1', name: 'Pocket book 2026-11-16 081605.json', size: 10, createdTime: '' },
    { id: '2', name: 'Pocket transactions 2026-11-16 081605.csv', size: 5, createdTime: '' },
    { id: '3', name: 'Pocket book 2026-11-17 090000.json', size: 10, createdTime: '' },
    { id: '4', name: 'holiday.jpg', size: 1, createdTime: '' },
  ]);
  ok('F1 files pair up by their time, newest first; other files are ignored',
    groups.length === 2 && groups[0].stamp === '2026-11-17 090000' && !groups[0].csv && groups[1].book.id === '1' && groups[1].csv.id === '2' && groups[1].fileIds.length === 2);
  let threw = 0;
  for (const bad of ['not json', '{"accounts":[]}', 'null']) { try { BackupFiles.parseBook(bad); } catch (_) { threw++; } }
  ok('F1 a file that is not a Pocket book is refused', threw === 3);
}

// ── C1 DriveClient ───────────────────────────────────────────────────────
{
  const g = new FakeGoogleDrive();
  const win = { google: g.signIn(), document: {} };
  const tokens = new GoogleTokenClient({ clientId: 'test-client', scope: DriveClient.SCOPE, win });
  const drive = new DriveClient({ tokens, fetch: g.fetch });
  const folderId = await drive.ensureFolder('Pocket backups');
  ok('C1 the folder is made once and found after that', folderId === await drive.ensureFolder('Pocket backups') && g.windowsOpened === 1);
  const small = await drive.upload({ folderId, name: 'a.json', mime: 'application/json', body: '{"a":"₹ é \\r\\n--x"}' });
  const big = await drive.upload({ folderId, name: 'b.json', mime: 'application/json', body: 'x'.repeat(4_600_000) });
  ok('C1 a small file goes up in one request, a large one in two steps', g.requests.filter((r) => /multipart/.test(r)).length === 1 && g.requests.filter((r) => /resumable/.test(r)).length === 1 && g.requests.some((r) => r.startsWith('PUT')));
  ok('C1 both come back exactly as sent', await drive.download(small.id) === '{"a":"₹ é \\r\\n--x"}' && (await drive.download(big.id)).length === 4_600_000);
  g.expireTokens();
  const listed = await drive.list(folderId);
  ok('C1 a stale token is renewed and the call repeated', listed.length === 2 && g.windowsOpened === 2);
  g.full = true;
  let msg = '';
  try { await drive.upload({ folderId, name: 'c.json', mime: 'application/json', body: '{}' }); } catch (e) { msg = e.message; }
  ok('C1 a full Drive is reported in plain words', /Google Drive is full/.test(msg), msg);
  ok('C1 not set up without a client ID', !new GoogleTokenClient({ clientId: '', scope: DriveClient.SCOPE, win }).configured);
}

// ── UI ───────────────────────────────────────────────────────────────────
const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const book = () => ({
  user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri: false, hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [] },
  accounts: [{ id: 'a1', name: 'Bank', currency: 'INR', type: 'savings', color: '#3b82f6', icon: 'wallet', openingBalance: 0, balance: 0 }],
  categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#10b981', icon: 'tag' }],
  transactions: [{ id: 't1', date: '2026-11-10', type: 'expense', accountId: 'a1', categoryId: 'c1', amount: 12500, currency: 'INR', payee: 'Chai, "special"', note: '', tags: [] }],
  budgets: [], debts: [], family: [], merchantCategories: {}, accountGroups: [], regularItems: [],
});
function boot({ search = '', clientId = 'test-client', owner = null, drive = new FakeGoogleDrive(), storage = null, paid = true } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="planBanner"></div><div class="status-icons"></div><div id="appNotices"></div>
      <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
    </body></html>`, { url: `https://local.test/app.html${search}`, pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('pocket.v1', JSON.stringify(book()));
  if (owner) window.localStorage.setItem('pocket.v1.owner', owner);
  // Scheduled backups are an add-on; most of this suite runs with it unlocked for this book.
  if (paid) window.localStorage.setItem('pocket.v1.drive.unlocked', owner || 'guest');
  for (const [k, v] of Object.entries(storage || {})) window.localStorage.setItem(k, v);
  window.lucide = { createIcons() {} };
  window.Chart = function () { return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.google = drive.signIn();
  window.fetch = drive.fetch;
  window.confirm = () => true;
  window.alert = () => {};
  window.POCKET_GOOGLE_CLIENT_ID = clientId;
  window.eval(bundleSrc);
  return { w: window, g: drive };
}
const dataTab = async (w) => { w.__app.openModal('settings'); w.__app.setSettingsTab('data'); await wait(10); return w.document.querySelector('[data-settings-tab="data"]'); };
const toast = (w) => w.document.getElementById('toast')?.textContent || '';
const notice = (w) => w.document.querySelector('.app-notice-backup');

{
  const { w } = boot({ clientId: '' });
  await wait(80);
  ok('U1 no client ID: no Google Drive card', !(await dataTab(w)).querySelector('.drive-backup'));
  const own = boot({ clientId: undefined });
  await wait(80);
  ok('U1 Pocket\'s own client ID is built in: the card shows with Connect', !!(await dataTab(own.w)).querySelector('.drive-backup .drive-connect'));
  const demo = boot({ search: '?demo' });
  await wait(80);
  ok('U1 demo: no Google Drive card', !(await dataTab(demo.w)).querySelector('.drive-backup'));
}

{
  const { w, g } = boot();
  await wait(80);
  const app = w.__app;
  let tab = await dataTab(w);
  ok('U2 not connected: a Connect button and how it works', !!tab.querySelector('.drive-connect') && /Pocket backups/.test(tab.querySelector('.drive-backup').textContent) && !tab.querySelector('.drive-now'));
  await app.driveConnect();
  tab = w.document.querySelector('[data-settings-tab="data"]');
  ok('U2 connected: shows the Google account, weekly by default, Back up now / Restore / Disconnect',
    /me@example\.com/.test(tab.querySelector('.drive-backup').textContent) && tab.querySelector('.drive-frequency').value === 'weekly'
    && !!tab.querySelector('.drive-now') && !!tab.querySelector('.drive-restore-open') && !!tab.querySelector('.drive-disconnect'), tab.querySelector('.drive-backup')?.textContent);
  ok('U2 the folder is made in Drive; never backed up counts as due', !!g.folderId() && /not yet/.test(tab.querySelector('.drive-last').textContent) && !!notice(w));

  await app.driveBackupNow();
  const folder = g.folderId();
  const names = g.namesIn(folder);
  ok('U3 Back up now saves a book and a CSV into the folder', names.length === 2 && /^Pocket book .*\.json$/.test(names[0]) && /^Pocket transactions .*\.csv$/.test(names[1]), names.join(' | '));
  const saved = [...g.files.values()];
  const savedBook = JSON.parse(saved.find((f) => /^Pocket book/.test(f.name)).body);
  const savedCsv = saved.find((f) => /^Pocket transactions/.test(f.name)).body;
  ok('U3 the book holds the accounts and entries; the CSV has the import columns and the entry',
    savedBook.accounts[0].name === 'Bank' && savedBook.transactions[0].id === 't1' && !Object.keys(savedBook).some((k) => k.startsWith('_'))
    && savedCsv.startsWith('Date,Type,Account,') && /2026-11-10,expense,Bank,.*"Chai, ""special""".*125\.00,INR/.test(savedCsv), savedCsv);
  ok('U3 says so, shows the time, and the "due" note is gone', /Backed up to Google Drive/.test(toast(w)) && !/not yet/.test(w.document.querySelector('.drive-last').textContent) && !notice(w));
  ok('U3 the Google window opened once for connect + backup (the token is reused)', g.windowsOpened === 1);

  // U4 keep the newest 10
  for (let d = 1; d <= 11; d++) {
    const day = String(d).padStart(2, '0');
    g.add({ name: `Pocket book 2026-10-${day} 090000.json`, body: '{"accounts":[],"transactions":[]}', parents: [folder] });
    g.add({ name: `Pocket transactions 2026-10-${day} 090000.csv`, body: 'Date', parents: [folder], mimeType: 'text/csv' });
  }
  g.add({ name: 'my own notes.txt', body: 'keep me', parents: [folder] });
  await wait(1100); // a new second, so the new backup gets its own name
  await app.driveBackupNow();
  const left = g.namesIn(folder);
  ok('U4 after a backup only the newest 10 are kept (20 files); other files in the folder are left alone',
    left.filter((n) => /^Pocket book/.test(n)).length === 10 && left.filter((n) => /^Pocket transactions/.test(n)).length === 10
    && left.includes('my own notes.txt') && !left.includes('Pocket book 2026-10-01 090000.json') && !left.includes('Pocket book 2026-10-03 090000.json') && left.includes('Pocket book 2026-10-04 090000.json'), String(left.length));

  // U5 due note
  const settings = JSON.parse(w.localStorage.getItem('pocket.v1.drive'));
  w.localStorage.setItem('pocket.v1.drive', JSON.stringify({ ...settings, lastAt: new Date(Date.now() - 9 * 86_400_000).toISOString() }));
  app.driveSetFrequency('weekly');
  ok('U5 nine days after a weekly backup: the note shows with Back up now and Later', !!notice(w) && /is due/.test(notice(w).textContent) && /Back up now/.test(notice(w).textContent) && /Later/.test(notice(w).textContent));
  app.driveSetFrequency('monthly');
  ok('U5 switched to monthly: not due yet, no note', !notice(w));
  app.driveSetFrequency('off');
  ok('U5 switched off: no note', !notice(w) && w.document.querySelector('.drive-frequency').value === 'off');
  app.driveSetFrequency('daily');
  ok('U5 daily: due', !!notice(w));
  await wait(1100);
  const noteButton = notice(w).querySelector('button').getAttribute('onclick');
  await app.driveBackupNow();
  ok('U5 Back up now on the note saves a backup and clears it', /driveBackupNow\(\)/.test(noteButton) && !notice(w) && g.namesIn(folder).filter((n) => /^Pocket book/.test(n)).length === 10);
  w.localStorage.setItem('pocket.v1.drive', JSON.stringify({ ...JSON.parse(w.localStorage.getItem('pocket.v1.drive')), lastAt: '2026-01-01T00:00:00.000Z' }));
  app.driveSetFrequency('daily');
  const icon = () => w.document.querySelector('.status-icons .status-icon-backup');
  ok('U5 while a backup is due its icon is in the top bar, and the box has Later and a close button', !!icon() && !!notice(w).querySelector('.app-notice-close'));
  app.dismissNotice('backup');
  app.navigate('transactions');
  ok('U5 Later (or close) hides the box; the icon stays', !notice(w) && !!icon());
  app.toggleNotice('backup');
  ok('U5 tapping the icon opens the box again', !!notice(w));
  app.toggleNotice('backup');
  ok('U5 tapping it once more closes it', !notice(w) && !!icon());
  const seen = JSON.parse(w.localStorage.getItem('pocket.v1.notices'));
  w.localStorage.setItem('pocket.v1.notices', JSON.stringify({ ...seen, backupClosed: { ...seen.backupClosed, at: new Date(Date.now() - 2 * 86_400_000).toISOString() } }));
  app.driveSetFrequency('daily');
  ok('U5 two days after closing it, still just the icon', !notice(w) && !!icon());
  w.localStorage.setItem('pocket.v1.notices', JSON.stringify({ ...seen, backupClosed: { ...seen.backupClosed, at: new Date(Date.now() - 4 * 86_400_000).toISOString() } }));
  app.driveSetFrequency('daily');
  ok('U5 after three days with no backup the box comes back', !!notice(w));
  app.dismissNotice('backup');
  await wait(1100);
  await app.driveBackupNow();
  const hue = () => Number(/hsl\((\d+)/.exec(icon()?.innerHTML || '')?.[1]);
  ok('U5 once backed up, the box is gone and the icon is green with no dot', !notice(w) && !!icon() && hue() === 142 && !icon().querySelector('.status-dot'), String(hue()));
  app.toggleNotice('backup');
  ok('U5 tapping the green icon says it is up to date and when the next is due, with Back up now but no Later', /up to date/.test(notice(w).textContent) && /due tomorrow/.test(notice(w).textContent) && /Back up now/.test(notice(w).textContent) && !/Later/.test(notice(w).textContent));
  app.dismissNotice('backup');
  const ageBy = (days) => { w.localStorage.setItem('pocket.v1.drive', JSON.stringify({ ...JSON.parse(w.localStorage.getItem('pocket.v1.drive')), lastAt: new Date(Date.now() - days * 86_400_000).toISOString() })); };
  ageBy(3); app.driveSetFrequency('weekly');
  const mid = hue();
  ok('U5 weekly, 3 days old: not due, the icon has moved part of the way from green to amber', !notice(w) && mid < 142 && mid > 38 && !icon().querySelector('.status-dot'), String(mid));
  ageBy(7); app.driveSetFrequency('weekly');
  ok('U5 weekly, 7 days old: due — amber with a dot, and the box shows', hue() === 38 && !!icon().querySelector('.status-dot') && !!notice(w), String(hue()));
  app.dismissNotice('backup');
  ageBy(11); app.driveSetFrequency('weekly');
  const late = hue();
  ageBy(30); app.driveSetFrequency('weekly');
  ok('U5 overdue: the icon shades on towards red and stops there', late < 38 && late > 4 && hue() === 4, `${late} ${hue()}`);
  app.driveSetFrequency('off');
  ok('U5 no schedule: no icon', !icon());
  app.driveSetFrequency('daily'); app.dismissNotice('backup');
  await wait(1100);
  await app.driveBackupNow();
  w.localStorage.setItem('pocket.v1.drive', JSON.stringify({ ...JSON.parse(w.localStorage.getItem('pocket.v1.drive')), lastAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }));
  app.driveSetFrequency('daily');
  ok('U5 the next time a backup falls due the box shows again', !!notice(w) && !!icon());

  // U6 restore
  const older = g.add({ name: 'Pocket book 2026-11-01 070000.json', parents: [folder], body: JSON.stringify({ ...book(), accounts: [{ ...book().accounts[0], name: 'Restored bank' }], transactions: [] }) });
  app.openDriveRestore();
  ok('U6 the Restore window first says it is looking', /Looking in your Google Drive/.test(w.document.querySelector('.drive-restore').textContent));
  await until(() => w.document.querySelectorAll('.drive-restore-row').length > 0);
  const rows = w.document.querySelectorAll('.drive-restore-row');
  ok('U6 it lists the backups with a Restore button each', rows.length === 11 && /Restore/.test(rows[0].textContent), String(rows.length));
  w.confirm = () => false;
  await app.driveRestore(older);
  ok('U6 saying no to the question changes nothing', app.getState?.().accounts?.[0]?.name !== 'Restored bank' && JSON.parse(w.localStorage.getItem('pocket.v1')).accounts[0].name === 'Bank');
  w.confirm = () => true;
  await app.driveRestore(older);
  ok('U6 restoring swaps the book on this device', JSON.parse(w.localStorage.getItem('pocket.v1')).accounts[0].name === 'Restored bank' && JSON.parse(w.localStorage.getItem('pocket.v1')).transactions.length === 0 && /Backup restored/.test(toast(w)));
  g.add({ name: 'Pocket book 2026-11-02 070000.json', parents: [folder], body: 'garbage' });
  const bad = [...g.files.values()].find((f) => f.body === 'garbage').id;
  await app.driveRestore(bad);
  ok('U6 a damaged backup is refused and the book is kept', /not a Pocket book/.test(toast(w)) && JSON.parse(w.localStorage.getItem('pocket.v1')).accounts[0].name === 'Restored bank');
  app.closeModal();

  // U10 folder deleted by the person
  for (const f of [...g.files.values()]) g.files.delete(f.id);
  await wait(1100);
  await dataTab(w);
  await app.driveBackupNow();
  ok('U10 the folder was deleted in Drive: the next backup makes it again', !!g.folderId() && g.namesIn(g.folderId()).length === 2, toast(w));

  // U9 disconnect
  await app.driveDisconnect();
  const tabAfter = await dataTab(w);
  ok('U9 Disconnect: back to Connect, the link is forgotten, files stay in Drive', !!tabAfter.querySelector('.drive-connect') && w.localStorage.getItem('pocket.v1.drive') === null && g.namesIn(g.folderId()).length === 2);
}

{
  const { w, g } = boot();
  await wait(80);
  await dataTab(w);
  g.window = 'closed';
  await w.__app.driveConnect();
  ok('U7 closing Google\'s window: says so, still not connected', /closed before it finished/.test(toast(w)) && !!w.document.querySelector('.drive-connect') && w.localStorage.getItem('pocket.v1.drive') === null, toast(w));
  g.window = 'blocked';
  await w.__app.driveConnect();
  ok('U7 a blocked pop-up: asks to allow pop-ups', /Allow pop-ups/.test(toast(w)) && !w.document.querySelector('.drive-connect').disabled, toast(w));
  g.window = 'ok';
  await w.__app.driveConnect();
  g.failNext = 500;
  await w.__app.driveBackupNow();
  ok('U7 Drive having a problem: says so, the button works again, nothing recorded', /had a problem/.test(toast(w)) && !w.document.querySelector('.drive-now').disabled && /not yet/.test(w.document.querySelector('.drive-last').textContent), toast(w));
}

{
  const linked = JSON.stringify({ owner: 'guest', email: 'me@example.com', name: 'Me', folderId: 'f1', frequency: 'daily', lastAt: null });
  const g = new FakeGoogleDrive();
  g.add({ name: 'Pocket backups', mimeType: 'application/vnd.google-apps.folder' });
  const other = boot({ drive: g, owner: 'user-999', storage: { 'pocket.v1.drive': linked } });
  await wait(80);
  const st = other.w.__app.driveStatus();
  ok('U8 a book that belongs to someone else finds Drive not connected, and no note', st.available && !st.connected && !st.due && !notice(other.w));
  await other.w.__app.driveBackupNow();
  ok('U8 and a backup is refused — nothing is saved to that Drive', g.namesIn('f1').length === 0 && /Connect Google Drive first/.test(toast(other.w)), toast(other.w));
  const same = boot({ drive: new FakeGoogleDrive(), storage: { 'pocket.v1.drive': linked } });
  await wait(80);
  ok('U8 the guest who linked it is still connected, and a daily backup is due', same.w.__app.driveStatus().connected && same.w.__app.driveStatus().due && !!notice(same.w));
  ok('U8 the next Google window pre-selects the linked account', await (async () => { await same.w.__app.driveBackupNow(); return same.g.lastHint === 'me@example.com'; })());
}

{
  const none = boot();
  none.g.automatic = false;
  await wait(80);
  await dataTab(none.w);
  await none.w.__app.driveConnect();
  await wait(20);
  ok('A1 the server has no secret: no automatic switch, backups ask for a tap as before', !none.w.document.querySelector('.drive-auto') && !none.w.__app.driveStatus().automatic && !!notice(none.w));

  const { w, g } = boot();
  await wait(80);
  const app = w.__app;
  await dataTab(w);
  await app.driveConnect();
  await until(() => !!w.document.querySelector('.drive-auto'));
  const toggle = () => w.document.querySelector('.drive-auto-toggle');
  ok('A1 after Connect, automatic is off; the switch is offered and says what it does', !app.driveStatus().automatic && toggle()?.textContent.trim() === 'Off' && toggle().getAttribute('aria-checked') === 'false' && /asks you to tap/.test(w.document.querySelector('.drive-auto').textContent) && !JSON.parse(w.localStorage.getItem('pocket.v1.drive')).refreshToken);
  ok('A1 with it off, a due backup shows the box and nothing is saved by itself', !!notice(w) && g.namesIn(g.folderId()).length === 0);

  const windows = g.windowsOpened;
  await app.driveSetAutomatic(true);
  await until(() => g.namesIn(g.folderId()).length === 2);
  ok('A2 switching on opens Google\'s window once and keeps the lasting permission on this device only', g.windowsOpened === windows + 1 && g.lastHint === 'me@example.com' && /^rt-/.test(JSON.parse(w.localStorage.getItem('pocket.v1.drive')).refreshToken) && g.authCalls.includes('exchange'));
  ok('A2 the due backup is then saved by itself, the box goes and the switch reads On', g.namesIn(g.folderId()).length === 2 && !notice(w) && toggle().textContent.trim() === 'On' && /saves it by itself/.test(w.document.querySelector('.drive-auto').textContent));

  // a later visit: a new page, the same device storage, a backup due
  const carry = (lastAt, extra = {}) => ({ 'pocket.v1.drive': JSON.stringify({ ...JSON.parse(w.localStorage.getItem('pocket.v1.drive')), lastAt }), ...extra });
  const old = new Date(Date.now() - 9 * 86_400_000).toISOString();
  const later = boot({ drive: g, storage: carry(old) });
  await until(() => g.namesIn(g.folderId()).length === 4, 3000);
  ok('A2 next visit with a backup due: saved with no Google window and no box', g.namesIn(g.folderId()).length === 4 && g.windowsOpened === windows + 1 && !notice(later.w) && g.authCalls.includes('refresh') && /Backed up to Google Drive/.test(toast(later.w)), `${g.namesIn(g.folderId()).length} files`);
  ok('A2 the icon is green again afterwards', /hsl\(142/.test(later.w.document.querySelector('.status-icon-backup')?.innerHTML || ''));

  const stamp = later.w.localStorage.getItem('pocket.v1.drive.auto');
  const second = boot({ drive: g, storage: carry(old, { 'pocket.v1.drive.auto': stamp }) });
  await wait(300);
  ok('A3 another tab (or a reopen within half an hour) does not save a second copy', g.namesIn(g.folderId()).length === 4 && !notice(second.w));
  const hourAgo = String(Date.now() - 31 * 60_000);
  await wait(1100);
  const third = boot({ drive: g, storage: carry(old, { 'pocket.v1.drive.auto': hourAgo }) });
  await until(() => g.namesIn(g.folderId()).length === 6, 3000);
  ok('A3 after half an hour it tries again', g.namesIn(g.folderId()).length === 6);
  third.w.localStorage.setItem('pocket.v1.drive', carry(old)['pocket.v1.drive']);
  third.w.__app.driveSetAutomatic(false);
  ok('A3 switching off forgets the permission on the device and the Back up now box is back', !JSON.parse(third.w.localStorage.getItem('pocket.v1.drive')).refreshToken && !third.w.__app.driveStatus().automatic && !!notice(third.w));

  g.withdrawAccess();
  await wait(1100);
  const gone = boot({ drive: g, storage: carry(old) });
  await until(() => gone.w.__app && !gone.w.__app.driveStatus().automatic, 3000);
  ok('A4 Google withdrew the permission: automatic turns itself off, nothing saved, the box asks for a tap', !gone.w.__app.driveStatus().automatic && gone.w.__app.driveStatus().connected && g.namesIn(g.folderId()).length === 6 && !!notice(gone.w));

  const shy = boot();
  await wait(80);
  await dataTab(shy.w);
  await shy.w.__app.driveConnect();
  shy.g.givesRefreshToken = false;
  await shy.w.__app.driveSetAutomatic(true);
  ok('A5 Google gave no lasting permission: stays off and says how to fix it', !shy.w.__app.driveStatus().automatic && /myaccount\.google\.com\/permissions/.test(toast(shy.w)), toast(shy.w));
  shy.g.givesRefreshToken = true; shy.g.window = 'closed';
  await shy.w.__app.driveSetAutomatic(true);
  ok('A5 Google\'s window closed: stays off, the switch works again', !shy.w.__app.driveStatus().automatic && /closed before it finished/.test(toast(shy.w)) && !shy.w.document.querySelector('.drive-auto-toggle')?.disabled);
}

{
  const { w, g } = boot({ paid: false });
  await wait(80);
  const app = w.__app;
  await dataTab(w);
  await app.driveConnect();
  await wait(30);
  const card = () => w.document.querySelector('.drive-backup');
  ok('L1 without the add-on: connected, with Back up now, Restore and an Unlock row — no schedule choice, no automatic switch',
    /me@example\.com/.test(card().textContent) && !!card().querySelector('.drive-now') && !!card().querySelector('.drive-restore-open')
    && !!card().querySelector('.drive-unlock-buy') && /one-time add-on/.test(card().querySelector('.drive-unlock').textContent)
    && !card().querySelector('.drive-frequency') && !card().querySelector('.drive-auto'), card().textContent);
  await app.driveBackupNow();
  ok('L1 Back up now is free: the book and CSV are saved', g.namesIn(g.folderId()).length === 2 && /Backed up to Google Drive/.test(toast(w)));
  app.openDriveRestore();
  await until(() => w.document.querySelectorAll('.drive-restore-row').length === 1);
  ok('L1 Restore is free: the backup is listed', w.document.querySelectorAll('.drive-restore-row').length === 1);
  app.closeModal();

  const left = { ...JSON.parse(w.localStorage.getItem('pocket.v1.drive')), frequency: 'daily', lastAt: '2026-01-01T00:00:00.000Z', refreshToken: 'rt-left-over' };
  w.localStorage.setItem('pocket.v1.drive', JSON.stringify(left));
  app.driveSetFrequency('daily');
  app.navigate('transactions');
  await wait(300);
  const st = app.driveStatus();
  ok('L2 nothing is due, no icon or box, not automatic — even with a schedule and permission left over from before',
    st.connected && !st.unlocked && !st.due && st.frequency === 'off' && !st.automatic && !notice(w) && !w.document.querySelector('.status-icon-backup'));
  ok('L2 and nothing was saved by itself', g.namesIn(g.folderId()).length === 2 && !g.authCalls.includes('refresh'));
  await app.driveSetAutomatic(true);
  ok('L2 switching automatic on is refused until unlocked', !app.driveStatus().automatic && /Unlock them first/.test(toast(w)), toast(w));

  await app.driveUnlock();
  await wait(260);
  ok('L3 Unlock when signed out: asks to sign in first', /Sign in first/.test(toast(w)));
  app.closeModal();

  w.localStorage.setItem('pocket.v1.drive.unlocked', 'guest');
  const tab = await dataTab(w);
  ok('L4 with the add-on recorded for this book: the schedule is back (daily, due) and Unlock is gone',
    app.driveStatus().unlocked && tab.querySelector('.drive-frequency')?.value === 'daily' && !tab.querySelector('.drive-unlock') && app.driveStatus().due);
  w.localStorage.setItem('pocket.v1.drive.unlocked', 'someone-else');
  ok('L4 the add-on recorded for another person\'s book does not unlock this one', !app.driveStatus().unlocked);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
