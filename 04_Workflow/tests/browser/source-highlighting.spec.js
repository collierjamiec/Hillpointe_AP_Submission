// Where values appear on the page: one value at a time, all at once, the right place when a number repeats, and an
// honest message when a file has no text to point to.
const { chromium } = require('playwright');
const { DEMO, SHOTS: S } = require('./lab.js');
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const errors = [];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto(DEMO); await p.waitForSelector('.role-card');
  await p.click('.role-card[data-email="riley@penny.demo"]'); await p.waitForSelector('#shell', { state: 'visible' });
  await p.goto(DEMO + '#/invoices/APINBOX_0001?tab=read'); await p.waitForSelector('.pdf-pages canvas');
  await p.waitForSelector('[data-src-all]:not([hidden])');
  const box = (key) => p.$eval(`.pdf-hl[data-key="${key}"]`, (e) => {
    const r = e.getBoundingClientRect(), c = e.closest('.pdf-page').getBoundingClientRect();
    return { x: (r.left - c.left) / c.width, y: (r.top - c.top) / c.height, w: r.width / c.width };
  });
  await p.click('[data-src="invoice_no"]'); await p.waitForSelector('.pdf-hl.on');
  ok((await p.$$('.pdf-hl')).length === 1 && (await p.textContent('.pdf-hl.on span')) === 'Invoice number', 'Show on page draws one labeled box for the invoice number');
  ok(/Invoice number is highlighted/.test(await p.textContent('#toast')), 'and says so in words, for people who cannot see the box');
  const inv = await box('invoice_no');
  ok(inv.x > 0.5 && inv.y < 0.3, `the box is where the invoice number is printed (top right: ${inv.x.toFixed(2)}, ${inv.y.toFixed(2)})`);
  await p.click('[data-src="total"]'); await p.waitForTimeout(200);
  const total = await box('total');
  await p.click('[data-src="subtotal"]'); await p.waitForTimeout(200);
  const sub = await box('subtotal');
  ok(total.y > sub.y, 'Total is found on the Total line, below Subtotal');
  await p.click('[data-src-all]'); await p.waitForTimeout(200);
  const n = (await p.$$('.pdf-hl')).length;
  ok(n >= 9 && (await p.getAttribute('[data-src-all]', 'aria-pressed')) === 'true', `Highlight what Penny read shows every value (${n} boxes)`);
  await p.screenshot({ path: S + 'source-all.png' });
  await p.click('[data-src-all]'); await p.waitForTimeout(150);
  ok((await p.$$('.pdf-hl')).length === 0, 'and turns off again');

  // A pay application.
  await p.goto(DEMO + '#/invoices/APINBOX_0009?tab=read'); await p.waitForSelector('[data-src-all]:not([hidden])');
  await p.click('[data-src="current_due"]'); await p.waitForTimeout(300);
  ok((await p.$$('.pdf-hl.on')).length >= 1, 'a pay application shows where the current payment due is');

  // A value that is not printed is reported as not found, not guessed.
  const notFound = await p.evaluate(() => { SRC.doc = { ...SRC.doc, ex: { ...SRC.doc.ex, invoice_no: 'ZZZ-NOT-ON-PAGE' } }; showSource('invoice_no'); return document.querySelector('#toast').textContent; });
  ok(/was not found as printed text/.test(notFound) && (await p.$$('.pdf-hl')).length === 0, 'a value that is not on the page is reported as not found');

  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(DEMO + '#/invoices/APINBOX_0001?tab=read'); await p.waitForSelector('[data-src-all]:not([hidden])');
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'fits a phone');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
