// The public demo: every main page for each role at desktop and phone width, and honest messages where the engine is needed.
const { chromium } = require('playwright');
const { DEMO, ACCOUNTS, UPDATES_SITE, UPDATES_LOCAL, FULL, SHOTS: S, UPDATES_RELEASES, VERSION } = require('./lab.js');
const BASE = DEMO;
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const errors = [];
(async () => {
  const b = await chromium.launch();
  for (const [email, w] of [['avery@penny.demo', 1440], ['sam@penny.demo', 1440], ['riley@penny.demo', 390], ['jordan@penny.demo', 390]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
    await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${email}: ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && errors.push(`${email} console: ${m.text()}`));
    await p.goto(BASE); await p.waitForSelector('.role-card');
    await p.click(`.role-card[data-email="${email}"]`); await p.waitForSelector('#shell', { state: 'visible' });
    for (const h of ['', '#/work', '#/invoices/APINBOX_0001', '#/invoices/T5_unfamiliar_layout', '#/invoices/T5_unfamiliar_layout/manual', '#/batch', '#/rules', '#/audit', '#/help/manual-entry', '#/help/blockers', '#/help/recheck', '#/help/roles']) {
      await p.goto(BASE + h); await p.waitForTimeout(250);
      const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (over) ok(false, `${email} sideways scroll on ${h}`);
    }
    if (email === 'avery@penny.demo') {
      await p.goto(BASE + '#/invoices/APINBOX_0001'); await p.waitForTimeout(300);
      await p.click('[data-act="recheck"]'); await p.waitForTimeout(300);
      ok(/needs Penny on your computer/.test(await p.textContent('#dialog')), 'public demo: recheck explains it needs Penny on a computer');
      await p.click('#dlg-cancel');
      await p.goto(BASE + '#/invoices/T5_unfamiliar_layout/manual'); await p.waitForTimeout(300);
      ok(/Keying and the second check work here/.test(await p.textContent('#main')), 'public demo: manual entry banner is honest');
      ok(!(await p.$('#nb-waiting')), 'public demo: no waiting-batches list without a server');
    }
    await ctx.close();
  }
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
