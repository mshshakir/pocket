import { JSDOM } from 'jsdom';
const dom = new JSDOM(`<div id=r></div>`, { runScripts: 'dangerously' });
const d = dom.window.document;
d.getElementById('r').innerHTML = `<button id="b" onclick="window.__hit('O&#39;Brien')">x</button>`;
dom.window.__hit = (s) => { dom.window.__got = s; };
dom.window.onerror = (e) => console.log('ONERROR', String(e));
const b = d.getElementById('b');
console.log('attr raw =', JSON.stringify(b.getAttribute('onclick')));
try { b.click(); } catch(e){ console.log('threw', e.message); }
console.log('got =', dom.window.__got);
