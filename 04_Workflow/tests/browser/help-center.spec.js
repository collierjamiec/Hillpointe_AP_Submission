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
  let empty = [], leftover = [], why = 0;
  for (const s of slugs) {
    await p.goto(BASE + '#/help/' + s); await p.waitForTimeout(120);
    const t = (await p.textContent('#main')).replace(/\s+/g, ' ');
    if (await p.$('#main .help-why')) why++;
    if (t.length < 300) empty.push(s);
    if (/\{\{[a-z]+\}\}/.test(t)) leftover.push(s);
  }
  await p.goto(BASE + '#/help'); await p.waitForTimeout(300);
  await p.fill('#help-search, input[type=search]', 'maker-checker').catch(() => null);
  // (v2.1.1) The reasons behind the choices are in the demo itself: one article, and a note on the feature articles.
  await p.goto(BASE + '#/help/decisions'); await p.waitForSelector('#main table');
  const dec = (await p.textContent('#main')).replace(/\s+/g, ' ');
  const decisionsOk = /Jamie Collier made every decision here/.test(dec) && /It never decides what happens to a bill/.test(dec) && /chose not to build/.test(dec) && /still needs a person/.test(dec)
    && (await p.$$eval('#main table tbody tr', (r) => r.length)) >= 20;
  await p.screenshot({ path: S + 'help-decisions.png' });
  await p.goto(BASE + '#/help/updates'); await p.waitForSelector('#main .help-why');
  const noteOk = /Why it works this way/.test(await p.textContent('#main .help-why')) && !!(await p.$('#main .help-why a[href="#/help/decisions"]'));
  await p.locator('#main .help-why').scrollIntoViewIfNeeded(); await p.screenshot({ path: S + 'help-why-note.png' });
  console.log(`decisions article ${decisionsOk ? 'ok' : 'MISSING PARTS'}; articles with a "Why it works this way" note: ${why}${noteOk ? '' : ' (note on Updates is wrong)'}`);
  if (!decisionsOk || !noteOk || why < 20) errors.push('the decisions article or the why notes are missing');
  console.log(`articles opened: ${slugs.length}; short or empty: ${empty.join(', ') || 'none'}; unfilled placeholders: ${leftover.join(', ') || 'none'}`);
  console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors');
  process.exitCode = errors.length || empty.length || leftover.length ? 1 : 0;
  await b.close();
})();
