// The guided tour: it starts from the Overview, the help center and the menu under your name; each stop opens a real
// page and outlines the part it describes; Back, Next, Finish, the X and Escape all work; it changes nothing; it fits
// a phone; it works with real accounts; and signing out ends it.
const { chromium, devices } = require('playwright');
const { DEMO, ACCOUNTS, SHOTS } = require('./lab.js');
let fails = 0;
const ok = (c, m, extra) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); if (!c && extra) console.log('    ' + extra); };
const errors = [];
const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && errors.push(m.text())); };
const settle = (p) => p.waitForTimeout(260);
const card = (p) => p.evaluate(() => { const c = document.querySelector('#tour'); return !c || c.hidden ? null : { step: document.querySelector('#tour-step').textContent, title: document.querySelector('#tour-title').textContent, text: document.querySelector('#tour-text').textContent, next: document.querySelector('#tour-next').textContent, backOff: document.querySelector('#tour-back').disabled, focus: document.activeElement && document.activeElement.id, spots: document.querySelectorAll('.tour-spot').length, hash: location.hash || '#/' }; });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const p = await ctx.newPage(); watch(p);
  await p.goto(DEMO); await p.click('.role-card[data-email="avery@penny.demo"]'); await p.waitForSelector('#shell', { state: 'visible' });

  // ---- where it starts from
  ok(await p.isVisible('#main .page-head [data-tour]'), 'the Overview has a Take the tour button');
  ok(await card(p) === null, 'the tour is not showing until it is asked for');
  const before = await p.evaluate(() => JSON.stringify(EV));
  await p.click('#main .page-head [data-tour]'); await settle(p);
  let c = await card(p);
  ok(c && /stop 1 of 9/.test(c.step) && c.title === 'Start with what needs you', 'it opens on stop 1 of 9, the Overview', JSON.stringify(c));
  ok(c.backOff && c.next === 'Next', 'Back is off on the first stop');
  ok(c.focus === 'tour-title', 'focus moves to the stop heading, so a screen reader reads it');
  ok(c.spots === 1 && await p.evaluate(() => document.querySelector('.card.attention').classList.contains('tour-spot')), 'the part being described is outlined');
  await p.screenshot({ path: SHOTS + 'tour-1-overview.png' });

  // ---- every stop: a real page, the right part outlined, plain words
  const seen = [c];
  for (let i = 2; i <= 9; i++) { await p.click('#tour-next'); await settle(p); seen.push(await card(p)); }
  const routes = seen.map((s) => s.hash.replace(/APINBOX_\d+|[A-Z]+_\d+/, 'ID'));
  ok(JSON.stringify(routes) === JSON.stringify(['#/', '#/invoices/ID', '#/invoices/ID?tab=read', '#/invoices/ID?tab=coding', '#/exceptions', '#/exports', '#/rules', '#/audit', '#/help/decisions']), 'the nine stops open the nine pages in order', routes.join(' '));
  ok(seen.slice(0, 8).every((s) => s.spots === 1) && seen[8].spots === 0, 'each stop outlines one part of its page (the last has none)', seen.map((s) => s.spots).join(''));
  ok(seen.every((s, i) => s.step.includes(`stop ${i + 1} of 9`) && s.focus === 'tour-title'), 'each stop says where you are and takes focus');
  ok(seen.every((s) => s.text.length > 60 && s.text.length < 260 && !s.text.includes('—')), 'each stop is a few plain sentences');
  ok(seen[3].text.includes('Ready for Intacct import') && !/has been (entered|paid)/.test(seen[3].text), 'the ready bill stop uses the honest label');
  ok(seen[8].next === 'Finish', 'the last stop says Finish');
  ok(await p.evaluate(() => document.title.startsWith('Decisions and why')), 'the last stop is the Decisions and why article');

  // ---- Back, and the page behind the card still works
  await p.click('#tour-back'); await settle(p);
  c = await card(p);
  ok(c.hash === '#/audit' && /stop 8 of 9/.test(c.step), 'Back returns to the stop before');
  await p.click('#nav a[data-nav="invoices"]'); await settle(p);
  c = await card(p);
  ok(c && c.hash === '#/invoices' && c.spots === 0, 'you can use the page behind the card; the tour waits');
  await p.click('#tour-next'); await settle(p);
  ok((await card(p)).hash === '#/help/decisions', 'and Next carries on from where the tour was');
  await p.click('#tour-next'); await settle(p);
  ok(await card(p) === null && await p.evaluate(() => location.hash === '#/help/decisions' && !document.querySelector('.tour-spot') && !document.documentElement.classList.contains('touring')), 'Finish closes the tour and leaves you on the page');
  ok(await p.evaluate((was) => JSON.stringify(EV) === was, before), 'the tour changed nothing: no action was recorded');

  // ---- the other ways in, and the ways out
  await p.goto(DEMO + '#/help'); await settle(p);
  await p.click('#main .page-head [data-tour]'); await settle(p);
  ok(/stop 1 of 9/.test((await card(p)).step), 'the help center starts it too');
  await p.keyboard.press('Escape'); await settle(p);
  ok(await card(p) === null && await p.evaluate(() => location.hash === '#/'), 'Escape ends the tour');
  await p.click('#user-btn'); await p.click('#take-tour'); await settle(p);
  ok(/stop 1 of 9/.test((await card(p)).step) && await p.evaluate(() => document.querySelector('#user-pop').hidden), 'the menu under your name starts it, and closes');
  await p.click('#tour-end'); await settle(p);
  ok(await card(p) === null, 'the X ends it');
  await p.goto(DEMO + '#/help/tour'); await settle(p);
  ok(await p.evaluate(() => /Take the guided tour/.test(document.querySelector('#main h1').textContent) && document.querySelectorAll('#main article ol li').length === 9), 'the help article lists the nine stops');
  await p.click('#main article [data-tour]'); await settle(p);
  ok(await card(p) !== null, 'and its button starts the tour');
  await p.click('#user-btn'); await p.click('#sign-out'); await settle(p);
  ok(await card(p) === null && await p.isVisible('.role-card'), 'signing out ends the tour');

  // ---- keyboard only
  await p.click('.role-card[data-email="jordan@penny.demo"]'); await p.waitForSelector('#shell', { state: 'visible' });
  await p.focus('#main .page-head [data-tour]'); await p.keyboard.press('Enter'); await settle(p);
  await p.keyboard.press('Tab');
  ok(await p.evaluate(() => document.activeElement.id === 'tour-next'), 'Tab from the heading reaches Next (Back is off on stop 1)');
  await p.keyboard.press('Enter'); await settle(p);
  ok(/stop 2 of 9/.test((await card(p)).step), 'Enter on Next moves on, as a Viewer');
  await p.keyboard.press('Escape'); await settle(p);

  // ---- when there is nothing held and nothing ready, those stops are left out
  await p.evaluate(() => { X.docs.forEach((d) => { d.pennyStatus = 'SKIP'; }); startTour(); }); await settle(p);
  ok(/stop 1 of 6/.test((await card(p)).step), 'with no open hold and no ready bill the tour has 6 stops');
  await ctx.close();

  // ---- on a phone
  const ph = await b.newContext({ ...devices['iPhone 13'] });
  await ph.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const m = await ph.newPage(); watch(m);
  await m.goto(DEMO); await m.tap('.role-card[data-email="sam@penny.demo"]'); await m.waitForSelector('#shell', { state: 'visible' });
  await m.tap('#main .page-head [data-tour]'); await settle(m);
  const fit = await m.evaluate(() => { const r = document.querySelector('#tour').getBoundingClientRect(); const btns = [...document.querySelectorAll('#tour button')].map((x) => x.getBoundingClientRect()); return { inside: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.top > innerHeight * 0.4, thumbs: btns.every((x) => x.height >= 40 && x.width >= 40), sideways: document.documentElement.scrollWidth > innerWidth + 1 }; });
  ok(fit.inside, 'on a phone the card sits across the bottom and leaves the top of the page in view');
  ok(fit.thumbs, 'its buttons are thumb sized');
  ok(!fit.sideways, 'and nothing scrolls sideways');
  await m.screenshot({ path: SHOTS + 'tour-phone.png' });
  for (let i = 0; i < 8; i++) { await m.tap('#tour-next'); await settle(m); }
  ok((await card(m)).next === 'Finish', 'the whole tour can be walked on a phone');
  await ph.close();

  // ---- with real accounts (team mode)
  const team = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await team.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const t = await team.newPage();
  t.on('pageerror', (e) => errors.push(e.message)); t.on('console', (m) => m.type() === 'error' && !/(401)/.test(m.text()) && errors.push(m.text()));   // the first look for a session is a 401 by design
  await t.goto(ACCOUNTS); await t.waitForSelector('#login-form');
  await t.fill('#login-email', 'avery@hillpointe.com'); await t.fill('#login-pw', 'copper kettle morning'); await t.click('#login-submit');
  await t.waitForSelector('#shell', { state: 'visible' });
  const log = await t.evaluate(() => TEAM.last);
  await t.click('#main .page-head [data-tour]'); await settle(t);
  for (let i = 0; i < 3; i++) { await t.click('#tour-next'); await settle(t); }
  ok(/stop 4 of/.test((await card(t)).step), 'the tour runs with real accounts');
  await t.click('#tour-end'); await settle(t);
  ok(await t.evaluate((was) => TEAM.last === was, log), 'and sends nothing to the server');
  await team.close();

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
