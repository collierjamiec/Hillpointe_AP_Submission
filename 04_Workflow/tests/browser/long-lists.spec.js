// Long lists: tables show one page at a time, the page lives in the address, totals describe the whole list, and
// Previous and Next on an invoice cross page edges. A stress test loads 5,000 invoices and times the main pages.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { DEMO, LAB } = require('./lab.js');
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const errors = [];
const text = async (p, sel) => ((await p.textContent(sel)) || '').replace(/\s+/g, ' ');
const rowCount = (p) => p.$$eval('#main tbody tr[data-href]', (r) => r.length);
const BIG = 5000;
/** Wait until the pager on screen says this page (the page is redrawn a moment after the address changes). */
const atPage = (p, n) => p.waitForFunction((n) => { const el = document.querySelector('#main .pager-at'); return el && el.textContent.startsWith(`Page ${n} of`); }, n);

/** The demo data, with its invoices copied until there are BIG of them (new ids, new invoice numbers, one run). */
function bigData() {
  const d = JSON.parse(fs.readFileSync(path.join(LAB, 'site', 'data', 'penny-data.json'), 'utf8'));
  const run = d.runs[0].id;
  const base = d.results.filter((r) => r.run_id === run);
  const docs = {}, results = [];
  for (let i = 0; i < BIG; i++) {
    const r = base[i % base.length], id = 'STRESS_' + String(i + 1).padStart(5, '0');
    const doc = JSON.parse(JSON.stringify(d.documents[r.doc_id]));
    doc.id = id;
    if (doc.extracted) { doc.extracted.supdoc_id = id; doc.extracted.invoice_no = `${doc.extracted.invoice_no || 'INV'}-${i + 1}`; }
    docs[id] = doc;
    results.push(Object.assign(JSON.parse(JSON.stringify(r)), { doc_id: id, key: `${r.key}|${i + 1}` }));
  }
  d.documents = docs; d.results = results;
  d.runs = [Object.assign(d.runs[0], { documents: BIG })];
  return JSON.stringify(d);
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const signIn = async () => {
    await p.goto(DEMO); await p.waitForSelector('.role-card');
    await p.click('.role-card[data-email="sam@penny.demo"]'); await p.waitForSelector('#shell', { state: 'visible' });
  };

  // ---- the demo as published: 26 invoices, so the list just spills onto a second page
  await signIn();
  await p.goto(DEMO + '#/invoices'); await p.waitForSelector('.pager');
  const total = await p.evaluate(() => X.docs.length);
  ok((await rowCount(p)) === 25 && new RegExp(`Showing 1 to 25 of ${total} invoices`).test(await text(p, '.pager')), 'the invoice list shows the first 25 and says how many there are');
  ok(new RegExp(`${total} invoices`).test(await text(p, '.filter-summary')), 'the count above the table is for the whole list, not the page');
  ok(await p.$eval('.pager [data-page="1"]', (x) => x.disabled), 'First and Previous are off on page 1');
  await p.click('.pager button[aria-label="Next page"]'); await atPage(p, 2);
  ok((await rowCount(p)) === total - 25 && /Page 2 of 2/.test(await text(p, '.pager')), 'Next shows the rest, and the page is in the address');
  await p.goBack(); await atPage(p, 1);
  ok((await rowCount(p)) === 25, 'the Back button returns to page 1');
  await p.fill('#f-q', 'zzzz-no-such'); await p.waitForTimeout(200);
  ok(!(await p.$('.pager')), 'a short list has no pager');

  // ---- 5,000 invoices
  const body = bigData();
  await ctx.route('**/data/penny-data.json*', (r) => r.fulfill({ contentType: 'application/json', body }));
  await p.goto(DEMO + '#/'); await p.reload(); await p.waitForSelector('#shell', { state: 'visible' }); await p.waitForFunction(() => typeof X !== 'undefined' && X && X.docs);
  ok((await p.evaluate(() => X.docs.length)) === BIG, `the stress data loads ${BIG.toLocaleString()} invoices`);
  const times = {};
  for (const [name, hash] of [['Overview', '#/'], ['Invoices', '#/invoices'], ['Run', '#/runs/' + JSON.parse(body).runs[0].id], ['My work', '#/work'], ['Exceptions', '#/exceptions'], ['Audit trail', '#/audit'], ['Insights', '#/insights']]) {
    times[name] = await p.evaluate(async (h) => {
      const t = performance.now(); location.hash = h;
      await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return Math.round(performance.now() - t);
    }, hash);
  }
  console.log('page times with 5,000 invoices (ms):', JSON.stringify(times));
  ok(Object.values(times).every((t) => t < 2000), 'every main page draws in under 2 seconds with 5,000 invoices');
  await p.goto(DEMO + '#/invoices'); await p.waitForSelector('.pager');
  ok((await rowCount(p)) === 25 && /Showing 1 to 25 of 5,000 invoices/.test(await text(p, '.pager')) && /Page 1 of 200/.test(await text(p, '.pager')), 'the list still draws only 25 rows');
  await p.selectOption('.pager select[data-per]', '100'); await p.waitForFunction(() => document.querySelectorAll('#main tbody tr[data-href]').length === 100);
  ok((await rowCount(p)) === 100 && /Page 1 of 50/.test(await text(p, '.pager')), 'Rows 100 shows 100 at a time');
  await p.click('.pager button[aria-label="Last page"]'); await atPage(p, 50);
  ok(/Showing 4,901 to 5,000 of 5,000/.test(await text(p, '.pager')) && await p.$eval('.pager button[aria-label="Next page"]', (x) => x.disabled), 'Last goes to the end, where Next is off');
  await p.click('#inv-results button[data-sort="vendor"]'); await p.waitForTimeout(200);
  ok(/Page 1 of 50/.test(await text(p, '.pager')) && /per=100/.test(await p.evaluate(() => location.hash)), 'sorting starts again at page 1 and keeps the page size');
  await p.goto(DEMO + '#/invoices?page=9999'); await atPage(p, 200);
  ok(/Page 200 of 200/.test(await text(p, '.pager')), 'a page number past the end shows the last page');
  await p.goto(DEMO + '#/invoices?page=2'); await atPage(p, 2);
  const ids = await p.$$eval('#main tbody tr[data-href]', (r) => r.map((x) => decodeURIComponent(x.dataset.href.match(/invoices\/([^?]+)/)[1])));
  await p.click('#main tbody tr[data-href]'); await p.waitForSelector('.record-nav');
  ok(/26 of 5,?000/.test(await text(p, '.record-nav')), 'an invoice opened from page 2 knows its place in the whole list');
  await p.click('.record-nav [data-key="prev"]'); await p.waitForFunction((id) => !document.querySelector('.record-nav .crumb-id').textContent.includes(id), ids[0]);
  ok(/25 of 5,?000/.test(await text(p, '.record-nav')), 'Previous crosses back onto page 1');
  await p.click('.record-nav .back-link'); await p.waitForSelector('.pager');
  ok(/page=2/.test(await p.evaluate(() => location.hash)), 'Back to the list returns to the same page');
  await p.goto(DEMO + '#/runs/' + JSON.parse(body).runs[0].id); await p.waitForSelector('#main tfoot');
  ok(/5,000 invoices/.test(await text(p, '#main tfoot')) && (await rowCount(p)) === 25, 'a run page totals the whole run while showing one page');
  await p.focus('.pager button[aria-label="Next page"]'); await p.keyboard.press('Enter'); await atPage(p, 2);
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => !!document.activeElement.closest('.pager')), 'the pager works from the keyboard and keeps focus');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'fits a phone');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
