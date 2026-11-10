// Phones: the app is laid out for a small touch screen, not just squeezed onto one. Checked on an emulated iPhone:
// no sideways scrolling, tables shown as cards with the amount in view, thumb-sized controls, fields that do not
// make the page zoom, filters that fold away, dialogs that rise from the bottom, and the menu.
const { chromium, devices } = require('playwright');
const { DEMO } = require('./lab.js');
let fails = 0;
const ok = (c, m, extra) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); if (!c && extra) console.log('    ' + [].concat(extra).slice(0, 6).join('\n    ')); };
const errors = [];
const text = async (p, sel) => ((await p.textContent(sel)) || '').replace(/\s+/g, ' ');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto(DEMO); await p.waitForSelector('.role-card');
  await p.tap('.role-card[data-email="sam@penny.demo"]'); await p.waitForSelector('#shell', { state: 'visible' });
  const held = await p.evaluate(() => X.docs.find((d) => d.status === 'HOLD').id);
  const ready = await p.evaluate(() => X.docs.find((d) => d.pennyStatus === 'ENTER_INTACCT').id);
  const run = await p.evaluate(() => D.runs[0].id);

  // ---- every main screen: nothing scrolls sideways, page tables are cards, controls fit a thumb, fields are 16px
  const pages = [['Overview', '#/'], ['My work', '#/work'], ['Invoices', '#/invoices'], ['a held invoice', '#/invoices/' + held], ['what Penny read', `#/invoices/${held}?tab=read`],
    ['coding', `#/invoices/${ready}?tab=coding`], ['Run history', '#/runs'], ['a run', '#/runs/' + run], ['Exceptions', '#/exceptions'], ['Exports', '#/exports'],
    ['New batch', '#/batch'], ['Rules', '#/rules'], ['Audit trail', '#/audit'], ['Users', '#/users'], ['Outbox', '#/outbox'], ['Appearance', '#/appearance'],
    ['Help center', '#/help'], ['a help article', '#/help/exports'], ['Insights', '#/insights']];
  const problems = { sideways: [], tables: [], small: [], zoom: [] };
  for (const [name, hash] of pages) {
    await p.goto(DEMO + hash); await p.waitForTimeout(350);
    const m = await p.evaluate(() => {
      const vis = (el) => el.offsetParent && getComputedStyle(el).visibility !== 'hidden';
      const short = (el) => el.outerHTML.replace(/\s+/g, ' ').slice(0, 70);
      const controls = [...document.querySelectorAll('#main button, #main a.btn, #main select, #main input, #main textarea, .topbar button')].filter(vis)
        .filter((el) => !['checkbox', 'radio', 'hidden', 'file', 'color', 'range'].includes(el.type) && !el.closest('.chips-edit, .chip-list'));
      return {
        sideways: document.documentElement.scrollWidth > innerWidth + 1,
        tables: [...document.querySelectorAll('#main table.data')].filter((t) => vis(t) && t.parentElement.scrollWidth > t.parentElement.clientWidth + 1).length,
        small: controls.filter((el) => { const r = el.getBoundingClientRect(); return r.height < 36 || r.width < 36; }).map((el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)} ${short(el)}`; }),
        zoom: controls.filter((el) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && parseFloat(getComputedStyle(el).fontSize) < 16).map(short),
      };
    });
    if (m.sideways) problems.sideways.push(name);
    if (m.tables) problems.tables.push(name);
    m.small.forEach((s) => problems.small.push(`${name}: ${s}`));
    m.zoom.forEach((s) => problems.zoom.push(`${name}: ${s}`));
  }
  ok(!problems.sideways.length, `none of the ${pages.length} main screens scrolls sideways`, problems.sideways);
  ok(!problems.tables.length, 'no page table needs sideways scrolling: rows are shown as cards', problems.tables);
  ok(!problems.small.length, 'buttons and fields are thumb sized (36 pixels at the very least; most are 44)', problems.small);
  ok(!problems.zoom.length, 'every field uses 16 pixel text, so an iPhone does not zoom the page when you tap it', problems.zoom);

  // ---- the invoice list
  await p.goto(DEMO + '#/invoices'); await p.waitForSelector('#inv-results table.data');
  const card = await p.evaluate(() => {
    const row = document.querySelector('#inv-results tbody tr'); const amt = row.querySelector('td.num').getBoundingClientRect(); const first = row.querySelector('td').getBoundingClientRect();
    return { amountInView: amt.right <= innerWidth && amt.left > 0, sameLine: Math.abs(amt.top - first.top) < 12, role: document.querySelector('#inv-results table').getAttribute('role'), badge: (() => { const bd = row.querySelector('.badge').getBoundingClientRect(); return bd.right <= innerWidth; })() };
  });
  ok(card.amountInView && card.sameLine && card.badge, 'an invoice card shows the vendor and the amount side by side, with the whole status in view');
  ok(card.role === 'table', 'the table keeps its meaning for screen readers when it is laid out as cards');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#f-status')).display === 'none' || !document.querySelector('#f-status').offsetParent), 'the filters start folded away');
  ok(await p.evaluate(() => document.querySelector('#inv-results tbody tr').getBoundingClientRect().top < innerHeight * 1.6), 'so the first invoice is near the top, not a screen and a half down');
  await p.tap('#f-toggle');
  ok(await p.evaluate(() => !!document.querySelector('#f-status').offsetParent && document.querySelector('#f-toggle').getAttribute('aria-expanded') === 'true'), 'Filters opens them');
  await p.selectOption('#f-status', { index: 1 }); await p.waitForTimeout(200);
  ok(/Filters \(1\)/.test(await text(p, '#f-toggle')), 'the button counts the filters in use');
  await p.tap('#f-clear'); await p.waitForTimeout(200);
  await p.tap('#inv-results button[data-sort="amount"]'); await p.waitForTimeout(200);
  const amounts = await p.$$eval('#inv-results tbody td.num', (c) => c.map((x) => parseFloat(x.textContent.replace(/[^0-9.]/g, '')) || 0));
  ok(amounts.length > 3 && amounts.every((a, i) => !i || a <= amounts[i - 1]), 'the Sort by buttons above the cards sort the list');
  await p.tap('#inv-results tbody tr td .sub'); await p.waitForSelector('.record-nav');
  ok(true, 'tapping anywhere on a card opens the invoice');
  ok(await p.evaluate(() => [...document.querySelectorAll('.record-step .btn')].every((x) => x.getBoundingClientRect().height >= 44)), 'Previous and Next are full thumb size');

  // ---- other tables say which column each value is
  await p.goto(DEMO + '#/audit'); await p.waitForSelector('table.audit');
  ok(await p.evaluate(() => { const c = document.querySelectorAll('table.audit tbody tr td'); return c[1].dataset.label === 'Who' && getComputedStyle(c[1], '::before').content.includes('Who'); }), 'an audit entry labels each value (Who, Action, Details)');

  // ---- a dialog rises from the bottom and fits the screen
  await p.goto(DEMO + '#/exports'); await p.waitForSelector('[data-ex="imported"]');
  await p.tap('[data-ex="imported"]'); await p.waitForSelector('#dialog[open]');
  const dlg = await p.evaluate(() => { const r = document.querySelector('#dialog').getBoundingClientRect(); return { fits: r.left >= 0 && r.right <= innerWidth + 1 && r.height <= innerHeight, bottom: Math.abs(r.bottom - innerHeight) < 2, btn: [...document.querySelectorAll('#dialog .dialog-actions .btn')].every((x) => x.getBoundingClientRect().width > innerWidth * 0.8) }; });
  ok(dlg.fits && dlg.bottom && dlg.btn, 'a dialog sits at the bottom of the screen with full-width buttons');
  await p.tap('#dlg-cancel');

  // ---- the menu and the search box
  await p.tap('#menu-btn'); await p.waitForTimeout(350);
  ok(await p.evaluate(() => { const r = document.querySelector('.sidebar').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && [...document.querySelectorAll('#nav a')].every((a) => a.getBoundingClientRect().height >= 40); }), 'the menu slides in with thumb-sized links');
  await p.tap('#nav a[data-nav="invoices"]'); await p.waitForTimeout(350);
  ok(await p.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 0 && location.hash === '#/invoices'), 'choosing a page closes the menu');
  ok(await p.evaluate(() => { const s = document.querySelector('#search'); const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(s).font; return c.measureText(s.placeholder).width < s.clientWidth - 40; }), 'the hint in the search box is not cut off');

  // ---- turned sideways, and back on a desktop
  await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(300);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'fits with the phone turned sideways');
  await ctx.close();
  const desk = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await desk.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const d = await desk.newPage();
  await d.goto(DEMO); await d.click('.role-card[data-email="sam@penny.demo"]'); await d.waitForSelector('#shell', { state: 'visible' });
  await d.goto(DEMO + '#/invoices'); await d.waitForSelector('#inv-results table.data');
  ok(await d.evaluate(() => getComputedStyle(document.querySelector('#inv-results table')).display === 'table' && getComputedStyle(document.querySelector('#f-toggle')).display === 'none' && !!document.querySelector('#f-status').offsetParent && document.querySelector('.btn').getBoundingClientRect().height <= 38), 'on a desktop nothing changes: a real table, filters open, the same compact buttons');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
