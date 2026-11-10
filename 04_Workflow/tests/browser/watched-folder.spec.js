// The watched folder: the New batch page shows it, "Check now" picks up a PDF that has stopped changing, leaves a
// non-PDF alone with the reason, and the pickup is in the audit trail. The public demo explains it instead.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { DEMO, ACCOUNTS, LAB } = require('./lab.js');
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const errors = [];
const text = async (p, sel) => ((await p.textContent(sel)) || '').replace(/\s+/g, ' ');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/(401|403|409)/.test(m.text()) && errors.push(m.text()));

  // Drop one real PDF and one text file, both written a minute ago so they count as finished.
  const drop = path.join(LAB, 'accounts', 'inbox', '_incoming');
  fs.mkdirSync(drop, { recursive: true });
  const old = new Date(Date.now() - 60000);
  fs.copyFileSync(path.join(LAB, 'site', 'data', 'pdfs', 'APINBOX_0001.pdf'), path.join(drop, 'scan-from-printer.pdf'));
  fs.writeFileSync(path.join(drop, 'readme.txt'), 'not an invoice');
  for (const f of ['scan-from-printer.pdf', 'readme.txt']) fs.utimesSync(path.join(drop, f), old, old);

  await p.goto(ACCOUNTS); await p.waitForSelector('#login-form');
  await p.fill('#login-email', 'sam@hillpointe.com'); await p.fill('#login-pw', 'copper kettle morning'); await p.click('#login-submit');
  await p.waitForSelector('#shell', { state: 'visible' });
  await p.goto(ACCOUNTS + '#/batch'); await p.waitForSelector('#watch-card');
  let t = await text(p, '#watch-card');
  ok(/Watched folder\s*On/.test(t) && /inbox\/_incoming/.test(t) && /never runs a batch for real/.test(t), 'the New batch page shows the watched folder and says it only previews');
  await p.click('#watch-scan'); await p.waitForSelector('#watch-scan:not([disabled])');
  await p.waitForTimeout(300);
  await p.click('#watch-scan');
  await p.waitForSelector('text=Picked up 1 file', { timeout: 15000 });
  await p.waitForSelector('#watch-card');
  t = await text(p, '#watch-card');
  ok(/Last pickup: 1 file into inbox\/\d{4}-\d{2}-\d{2}_watched-folder/.test(t), 'Check now files the finished PDF as a dated batch');
  ok(/readme\.txt: It is not a PDF/.test(t), 'a file that is not a PDF is left alone, with the reason');
  ok(fs.existsSync(path.join(drop, 'readme.txt')) && !fs.existsSync(path.join(drop, 'scan-from-printer.pdf')), 'the PDF was moved; nothing was deleted');
  await p.waitForSelector('[data-wait-run]', { timeout: 10000 });
  ok(/watched-folder/.test(await text(p, '#nb-waiting')), 'the batch is waiting for a person to preview or run it');
  await p.goto(ACCOUNTS + '#/audit'); await p.waitForTimeout(500);
  t = await text(p, 'table.audit tbody');
  ok(/Picked up files from the watched folder/.test(t) && /scan-from-printer\.pdf/.test(t) && /nothing was entered/.test(t), 'the pickup is in the audit trail');
  await ctx.close();

  const c2 = await b.newContext();
  await c2.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const d = await c2.newPage();
  await d.goto(DEMO); await d.waitForSelector('.role-card');
  await d.click('.role-card[data-email="avery@penny.demo"]'); await d.waitForSelector('#shell', { state: 'visible' });
  await d.goto(DEMO + '#/batch'); await d.waitForTimeout(400);
  ok(/it is not part of this public demo/.test(await text(d, '.watch-card')), 'the public demo explains the watched folder instead of pretending');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
