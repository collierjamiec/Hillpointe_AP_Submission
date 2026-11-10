// Help center: every article opens, nothing is empty, no placeholder is left unfilled.
const { chromium } = require('playwright');
const { DEMO, ACCOUNTS, UPDATES_SITE, UPDATES_LOCAL, FULL, SHOTS: S, UPDATES_RELEASES, VERSION } = require('./lab.js');
const BASE = DEMO;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE); await p.waitForSelector('.role-card');
  await p.click('.role-card[data-email="sam@penny.demo"]'); await p.waitForSelector('#shell', { state: 'visible' });
  await p.goto(BASE + '#/help'); await p.waitForTimeout(400);
  const slugs = await p.evaluate(() => window.PENNY_HELP.map((a) => a.slug));
  let empty = [], leftover = [];
  for (const s of slugs) {
    await p.goto(BASE + '#/help/' + s); await p.waitForTimeout(120);
    const t = (await p.textContent('#main')).replace(/\s+/g, ' ');
    if (t.length < 300) empty.push(s);
    if (/\{\{[a-z]+\}\}/.test(t)) leftover.push(s);
  }
  await p.goto(BASE + '#/help'); await p.waitForTimeout(300);
  await p.fill('#help-search, input[type=search]', 'maker-checker').catch(() => null);
  console.log(`articles opened: ${slugs.length}; short or empty: ${empty.join(', ') || 'none'}; unfilled placeholders: ${leftover.join(', ') || 'none'}`);
  console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors');
  process.exitCode = errors.length || empty.length || leftover.length ? 1 : 0;
  await b.close();
})();
