/**
 * plan-link.smoke.mjs — the website's pricing buttons open the app at the
 * plan chooser.
 *
 *   L1  app.html#plans=family_year: the hash is cleared, the choice is kept
 *       for after sign-in, and (signed out) the sign-in window opens.
 *   L2  A page without the link opens nothing and keeps nothing.
 *
 * Run: node src/__smoke__/plan-link.smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function boot(hash) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="viewContent"></div><div id="sidebarNav"></div>
       <div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
     </body></html>`,
    { url: `https://local.test/app.html${hash}`, pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.lucide = { createIcons() {} };
  window.Chart  = function () { return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch   = () => Promise.reject(new Error('offline'));
  window.confirm = () => true;
  window.alert   = () => {};
  window.eval(bundleSrc);
  return window;
}

console.log('\nPlan link suite');
{
  const w = boot('#plans=family_year');
  await wait(1000);
  ok('L1 the link is taken off the address', w.location.hash === '');
  ok('L1 the chosen plan is kept for after sign-in', w.sessionStorage.getItem('pocket.pendingPlans') === 'family_year');
  ok('L1 signed out: the sign-in window opens', w.__app && /sign in|email/i.test(w.document.body.textContent));
}
{
  const w = boot('');
  await wait(1000);
  ok('L2 no link: nothing kept', w.sessionStorage.getItem('pocket.pendingPlans') === null);
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
