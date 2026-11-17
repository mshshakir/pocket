/**
 * admin-bot-link.smoke.mjs — linking the admin bot from the dashboard (0062).
 *   B1  Overview offers "Link the admin bot"; tapping it shows a one-time
 *       code and the t.me link with it.
 * Run: node src/__smoke__/admin-bot-link.smoke.mjs
 */
import { OverviewView } from '../admin/views/OverviewView.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nAdmin bot link');
const api = {
  stats: async () => ({ users: 1, new7: 0, new30: 0, active7: 0, loggedEntries7: 0, telegramLinked: 0, groups: 0, plans: {}, lifetime: 0, trials: 0,
    expiring7: 0, revenue30: 0, revenueTotal: 0, aiUses30: 0, programme: {}, signupsByWeek: [], revenueByMonth: [], paymentsOpen: true }),
  adminBotCode: async () => ({ code: 'AB12CD34', expiresAt: new Date().toISOString(), linked: 0 }),
};
const v = new OverviewView(api, { toast() {}, async refresh() {} });
await v.load();
let h = v.html();
ok('B1 Overview offers to link the admin bot', /Link the admin bot/.test(h) && /data-action="bot-code"/.test(h));
await v.act('bot-code');
h = v.html();
ok('B1 a code and its t.me link', /https:\/\/t\.me\/Shakirs_PocketAdminBot\?start=AB12CD34/.test(h) && /\/start AB12CD34/.test(h));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
