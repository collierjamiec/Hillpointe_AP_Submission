// Appearance: presets, a custom color kept readable, comfort settings, the company look, saved preferences.
const { chromium } = require('playwright');
const { DEMO, ACCOUNTS, UPDATES_SITE, UPDATES_LOCAL, FULL, SHOTS: S, UPDATES_RELEASES, VERSION } = require('./lab.js');

const LOCAL = ACCOUNTS;
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const errors = [];
const wait = (p, ms = 400) => p.waitForTimeout(ms);
const v = (p, name) => p.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const ratio = (p, a, b) => p.evaluate(([a, b]) => {
  const rgb = (c) => { const x = document.createElement('i'); x.style.color = c; document.body.appendChild(x); const m = getComputedStyle(x).color.match(/\d+/g).map(Number); x.remove(); return m; };
  const L = (c) => { const s = rgb(c).slice(0, 3).map((u) => { u /= 255; return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); }); return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
  const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}, [a, b]);
async function signIn(b, base, email, pw, w = 1440) {
  const ctx = await b.newContext({ viewport: { width: w, height: 950 } });
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/(401|403)/.test(m.text()) && errors.push(m.text()));
  await p.goto(base); await p.waitForSelector('#login-form');
  await p.fill('#login-email', email); await p.fill('#login-pw', pw); await p.click('#login-submit');
  await p.waitForSelector('#shell', { state: 'visible' }); await wait(p);
  return { ctx, p };
}
(async () => {
  const b = await chromium.launch();
  let { ctx, p } = await signIn(b, DEMO, 'avery@penny.demo', 'penny-clerk');
  ok((await v(p, '--accent')) === '#0f766e', 'starts with Penny teal');
  await p.goto(DEMO + '#/appearance'); await wait(p);
  ok((await p.$$('[data-preset]')).length === 8, 'seven presets plus custom');
  await p.click('[data-preset=harbor]'); await wait(p, 600);
  const blue = await v(p, '--accent');
  ok(blue !== '#0f766e' && (await ratio(p, blue, '#ffffff')) >= 4.5, `Harbor blue applies and reads well (${blue})`);
  ok(/Saved to your account/.test(await p.textContent('#look-saved')), 'saved to the account');
  await p.screenshot({ path: S + 'v17-appearance.png', fullPage: true });
  await p.click('[data-preset=custom]'); await wait(p, 300);
  await p.fill('#look-hex', '#ffee00'); await wait(p, 500);
  const yellow = await v(p, '--accent');
  ok((await ratio(p, yellow, '#ffffff')) >= 4.5 && /a little darker than your color/.test(await p.textContent('#look-page')), `a hard-to-read custom color is darkened just enough (${yellow})`);
  await p.click('[data-feel=mode][data-v=dark]'); await wait(p, 400);
  ok((await p.getAttribute('html', 'data-theme')) === 'dark', 'dark mode');
  const dk = await v(p, '--accent'), surf = await v(p, '--surface');
  ok((await ratio(p, dk, surf)) >= 4.5, `custom color in dark mode reads well on dark surfaces (${dk} on ${surf})`);
  await p.screenshot({ path: S + 'v17-appearance-dark.png' });
  await p.click('[data-feel=text][data-v=l]'); await p.click('[data-feel=density][data-v=compact]'); await p.click('[data-feel=motion][data-v=reduce]'); await wait(p, 500);
  ok(await p.evaluate(() => document.body.style.zoom === '1.1' && document.body.classList.contains('density-compact') && document.body.classList.contains('reduce-motion')), 'text size, density and motion apply');
  ok(!(await p.$('#look-make-company')), 'an AP Clerk cannot set the company look');
  await p.click('#user-btn'); await p.click('#sign-out'); await p.waitForSelector('#login-form');
  ok(await p.evaluate(() => !document.body.classList.contains('density-compact')), 'signing out drops personal comfort settings');
  await p.fill('#login-email', 'avery@penny.demo'); await p.fill('#login-pw', 'penny-clerk'); await p.click('#login-submit');
  await p.waitForSelector('#shell', { state: 'visible' }); await wait(p, 500);
  ok((await v(p, '--accent')) === dk && await p.evaluate(() => document.body.classList.contains('density-compact')), 'settings come back on sign-in');
  await ctx.close();
  // Admin sets the company look; someone following it sees it
  ({ ctx, p } = await signIn(b, DEMO, 'sam@penny.demo', 'penny-admin'));
  await p.goto(DEMO + '#/appearance'); await wait(p);
  await p.click('[data-preset=plum]'); await wait(p, 400);
  await p.click('#look-make-company'); await p.fill('#dlg-note', 'Matches our brand colors.'); await p.click('#dialog button[type=submit]'); await wait(p, 400);
  ok(/Company look saved/.test(await p.textContent('#toast')), 'Admin saves the company look with a reason');
  await p.goto(DEMO + '#/rules'); await wait(p);
  ok(/Company look: Penny teal → Plum/.test((await p.textContent('#main')).replace(/\s+/g, ' ')), 'it is in the Rules change history');
  await p.click('#user-btn'); await p.click('#sign-out'); await p.waitForSelector('#login-form');
  await p.fill('#login-email', 'jordan@penny.demo'); await p.fill('#login-pw', 'penny-approver'); await p.click('#login-submit');
  await p.waitForSelector('#shell', { state: 'visible' }); await wait(p, 400);
  const jp = await v(p, '--accent');
  ok(jp !== '#0f766e' && jp !== '' , `someone following the company look sees Plum (${jp})`);
  await p.setViewportSize({ width: 390, height: 844 }); await p.goto(DEMO + '#/appearance'); await wait(p);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'appearance page fits a phone');
  await ctx.close();
  // On a computer with accounts, preferences are saved on the server
  ({ ctx, p } = await signIn(b, LOCAL, 'sam@hillpointe.com', 'copper kettle morning'));
  await p.goto(LOCAL + '#/appearance'); await wait(p);
  await p.click('[data-preset=evergreen]'); await wait(p, 900);
  const me = await p.evaluate(async () => (await (await fetch('api/auth/me')).json()).user.prefs);
  ok(me && me.look && me.look.preset === 'evergreen' && me.follow === false, 'server account keeps the preference');
  await ctx.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
