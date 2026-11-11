// Takes the screenshots shown in the top-level README and the case study (docs/screenshots/). Not a test suite.
// Start the lab first (python tests/browser/lab.py), then: node tests/browser/screenshots.js
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const { DEMO } = require('./lab.js');
const OUT = path.join(__dirname, '..', '..', '..', 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

/** Open the demo signed in as one of the demo people, with the intro skipped and the welcome message gone. */
async function open(b, email, opts) {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const p = await ctx.newPage();
  await p.goto(DEMO); await p.waitForSelector('.role-card');
  await p.click(`.role-card[data-email="${email}"]`); await p.waitForSelector('#shell', { state: 'visible' });
  await p.addStyleTag({ content: '.toast { display: none !important; } * { scroll-behavior: auto !important; }' });
  return p;
}
/** Go to a page, wait for it to settle, and save a picture of what is on screen. */
async function shot(p, hash, name, before) {
  if (hash !== null) { await p.goto(DEMO + hash); await p.waitForTimeout(500); }
  if (before) await before();
  await p.waitForTimeout(350);
  await p.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('saved', name);
}

(async () => {
  const b = await chromium.launch();
  const desk = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };
  const p = await open(b, 'avery@penny.demo', desk);
  const held = await p.evaluate(() => X.docs.filter(openHold).sort((a, b) => b.amount - a.amount)[0].id);
  await shot(p, '#/', 'overview');
  await shot(p, '#/invoices/' + held, 'held-invoice');
  await shot(p, `#/invoices/${held}?tab=read`, 'source-highlighting', async () => { await p.waitForSelector('.pdf-pages canvas'); await p.click('[data-src="current_due"]'); await p.waitForSelector('.pdf-hl.on'); });
  await shot(p, '#/exceptions', 'exceptions');
  await shot(p, '#/', 'tour', async () => { await p.click('#main .page-head [data-tour]'); await p.waitForTimeout(300); await p.click('#tour-next'); });
  await p.context().close();

  const s = await open(b, 'sam@penny.demo', desk);
  await shot(s, '#/rules', 'rules');
  await shot(s, '#/exports', 'exports');
  await shot(s, '#/audit', 'audit-trail');
  await s.context().close();

  const d = await open(b, 'avery@penny.demo', { ...desk, colorScheme: 'dark' });
  await shot(d, '#/work', 'my-work-dark');
  await d.context().close();

  const m = await open(b, 'avery@penny.demo', { ...devices['iPhone 13'] });
  await shot(m, '#/invoices', 'phone-invoices');
  await shot(m, '#/invoices/' + held, 'phone-invoice');
  await m.context().close();
  await b.close();
})();
