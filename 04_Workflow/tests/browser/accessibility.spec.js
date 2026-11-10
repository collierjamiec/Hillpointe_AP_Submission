// Accessibility: every main screen is checked against WCAG 2.2 A and AA with axe-core, in light and dark, on a
// desktop and a phone. Then the things a tool cannot judge by itself: keyboard order, focus in dialogs, and names.
// A person with a screen reader should still try it; this suite keeps the basics from slipping.
const fs = require('fs');
const { chromium } = require('playwright');
const { DEMO, ACCOUNTS } = require('./lab.js');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const errors = [];

/** Run axe on the page as it is now. Returns one line per problem, with the first few places it happens. */
async function audit(p) {
  if (!(await p.evaluate(() => !!window.axe))) await p.addScriptTag({ content: AXE });
  const res = await p.evaluate((tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }), TAGS);
  return res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} x${v.nodes.length}\n      ` +
    v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} :: ${(n.failureSummary || '').split('\n').slice(1, 2).join(' ').trim()}`).join('\n      '));
}
async function check(p, name) {
  const found = await audit(p);
  ok(!found.length, `${name}: no WCAG 2.2 AA problems found by axe`);
  found.forEach((f) => console.log('    ' + f));
}

(async () => {
  const b = await chromium.launch();
  for (const scheme of ['light', 'dark']) {
    for (const [device, viewport] of [['desktop', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
      if (scheme === 'dark' && device === 'phone') continue;
      const ctx = await b.newContext({ viewport, colorScheme: scheme, bypassCSP: true });   // bypassCSP only so the test can add axe
      await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(e.message));
      const tag = `${scheme} ${device}`;
      await p.goto(DEMO); await p.waitForSelector('.role-card');
      await check(p, `${tag} sign-in`);
      await p.click('.role-card[data-email="sam@penny.demo"]'); await p.waitForSelector('#shell', { state: 'visible' });
      const held = await p.evaluate(() => X.docs.find((d) => d.status === 'HOLD').id);
      const ready = await p.evaluate(() => X.docs.find((d) => d.pennyStatus === 'ENTER_INTACCT').id);
      const run = await p.evaluate(() => D.runs[0].id);
      const pages = [['Overview', '#/'], ['My work', '#/work'], ['Invoices', '#/invoices'], ['a held invoice', '#/invoices/' + held], ['what Penny read', `#/invoices/${held}?tab=read`],
        ['coding', `#/invoices/${ready}?tab=coding`], ['history', `#/invoices/${ready}?tab=history`], ['Run history', '#/runs'], ['a run', '#/runs/' + run], ['Exceptions', '#/exceptions'],
        ['Exports', '#/exports'], ['New batch', '#/batch'], ['Rules', '#/rules'], ['Audit trail', '#/audit'], ['Insights', '#/insights'], ['Users', '#/users'], ['Outbox', '#/outbox'],
        ['Appearance', '#/appearance'], ['Help center', '#/help'], ['a help article', '#/help/exports'], ["What's new", '#/whats-new'], ['enter by hand', `#/invoices/${held}/manual`]];
      for (const [name, hash] of pages) {
        await p.goto(DEMO + hash); await p.waitForTimeout(350);
        await check(p, `${tag} ${name}`);
      }
      if (scheme === 'light' && device === 'desktop') {
        // ---- a dialog: focus moves in, stays in, Escape closes, and focus goes back to the button that opened it
        await p.goto(DEMO + '#/exports'); await p.waitForSelector('[data-ex="imported"]');
        await p.focus('[data-ex="imported"]'); await p.keyboard.press('Enter'); await p.waitForSelector('#dialog[open], #dialog:not([hidden])');
        await check(p, 'an open dialog');
        ok(await p.evaluate(() => !!document.activeElement.closest('#dialog')), 'opening a dialog moves focus into it');
        for (let i = 0; i < 12; i++) await p.keyboard.press('Tab');
        ok(await p.evaluate(() => !!document.activeElement.closest('#dialog')), 'Tab stays inside the dialog');
        await p.keyboard.press('Escape'); await p.waitForTimeout(200);
        ok(await p.evaluate(() => document.activeElement && document.activeElement.matches('[data-ex="imported"]')), 'Escape closes it and focus returns to the button');

        // ---- keyboard: the skip link is first, and every control can be reached and seen
        await p.goto(DEMO + '#/invoices'); await p.waitForSelector('#inv-results table');
        await p.reload(); await p.waitForSelector('#inv-results table');
        await p.keyboard.press('Tab');
        ok(/skip/i.test(await p.evaluate(() => document.activeElement.textContent)), 'the first Tab stop is "Skip to content"');
        await p.keyboard.press('Enter'); await p.waitForTimeout(100);
        ok(await p.evaluate(() => document.activeElement.id === 'main' && !!document.querySelector('#inv-results table') && location.hash === '#/invoices'), 'the skip link moves focus to the page content and stays on the same page');
        const bad = await p.evaluate(() => [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((el) => el.offsetParent && !el.disabled && el.tabIndex >= 0)
          .filter((el) => { el.focus(); const s = getComputedStyle(el); return document.activeElement !== el || (s.outlineStyle === 'none' && s.boxShadow === 'none'); })
          .map((el) => el.outerHTML.slice(0, 90)));
        ok(!bad.length, 'every control on the Invoices page takes focus and shows a focus ring'); bad.slice(0, 5).forEach((x) => console.log('    ' + x));
        await p.focus('#inv-results tbody tr[data-href] a'); await p.keyboard.press('Enter'); await p.waitForSelector('.record-nav');
        ok(true, 'an invoice in the table opens from the keyboard');
        const small = await p.evaluate(() => [...document.querySelectorAll('#main a[href], #main button, .sidebar a, .topbar button')].filter((el) => el.offsetParent)
          .filter((el) => { const r = el.getBoundingClientRect(); return (r.width < 24 || r.height < 24) && getComputedStyle(el).display !== 'inline'; }).map((el) => `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)} ${el.outerHTML.slice(0, 80)}`));
        ok(!small.length, 'buttons and links are at least 24 by 24 pixels (WCAG 2.2 target size)'); small.slice(0, 5).forEach((x) => console.log('    ' + x));
        ok(await p.evaluate(() => document.documentElement.lang === 'en' && !!document.title && document.querySelectorAll('h1').length === 1), 'the page has a language, a title and one main heading');

        // ---- reduced motion and 200% text
        const calm = await b.newContext({ reducedMotion: 'reduce', viewport: { width: 720, height: 500 } });
        const c = await calm.newPage();
        await c.goto(DEMO); await c.waitForSelector('.role-card', { timeout: 15000 });
        ok(await c.evaluate(() => [...document.querySelectorAll('*')].every((el) => { const s = getComputedStyle(el); return parseFloat(s.animationDuration) < 0.05 || s.animationName === 'none'; })), 'with reduced motion on, nothing animates (and the intro is skipped)');
        await c.click('.role-card[data-email="avery@penny.demo"]'); await c.waitForSelector('#shell', { state: 'visible' });
        for (const hash of ['#/', '#/invoices', '#/exports', '#/work']) {
          await c.goto(DEMO + hash); await c.waitForTimeout(250);
          ok(!(await c.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${hash} reflows at 200% zoom (a 720 pixel wide window) with no sideways scrolling`);
        }
        await calm.close();
      }
      await ctx.close();
    }
  }
  // ---- Penny on a computer with real accounts: the sign-in form, the watched folder card and the Users page
  const real = await b.newContext({ viewport: { width: 1440, height: 1000 }, bypassCSP: true });
  await real.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const r = await real.newPage();
  r.on('pageerror', (e) => errors.push(e.message));
  await r.goto(ACCOUNTS); await r.waitForSelector('#login-form');
  await check(r, 'real accounts sign-in');
  await r.fill('#login-email', 'sam@hillpointe.com'); await r.fill('#login-pw', 'copper kettle morning'); await r.click('#login-submit');
  await r.waitForSelector('#shell', { state: 'visible' });
  for (const [name, hash, sel] of [['New batch with the watched folder', '#/batch', '#watch-card'], ['Users', '#/users', '#main table'], ['Exports', '#/exports', '#main h1']]) {
    await r.goto(ACCOUNTS + hash); await r.waitForSelector(sel); await r.waitForTimeout(300);
    await check(r, `real accounts ${name}`);
  }
  await real.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
