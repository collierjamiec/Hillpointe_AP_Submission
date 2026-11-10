// Versions and updates: footer, What's new, optional and required banners, Check for updates, on the site and on a computer.
const { chromium } = require('playwright');
const { DEMO, ACCOUNTS, UPDATES_SITE, UPDATES_LOCAL, FULL, SHOTS: S, UPDATES_RELEASES, VERSION } = require('./lab.js');
const fs = require('fs');

const REL = UPDATES_RELEASES;
const base = JSON.parse(fs.readFileSync(REL, 'utf8'));
const publish = (extra) => fs.writeFileSync(REL, JSON.stringify({ ...base, releases: [...extra.map((r) => ({ ...r, version: REAL[r.version] })), ...base.releases] }));
const STATIC = UPDATES_SITE, LOCAL = UPDATES_LOCAL;
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const errors = [];
// The checks below were written for 1.6.0 (next fixes 1.6.1 and 1.6.2, next version 1.7.0). canon() maps today's real
// versions onto those names, so the suite follows VERSION without being rewritten each release.
const [MAJ, MIN, PAT] = VERSION.split('.').map(Number);
const REAL = { '1.7.0': `${MAJ}.${MIN + 1}.0`, '1.6.2': `${MAJ}.${MIN}.${PAT + 2}`, '1.6.1': `${MAJ}.${MIN}.${PAT + 1}`, '1.6.0': VERSION };
const canon = (t) => Object.entries(REAL).reduce((s, [name, real], i) => s.split(real).join(`\u0000${i}`), t)
  .replace(/\u0000(\d)/g, (_, i) => Object.keys(REAL)[+i]);
const text = async (p, sel = 'body') => canon((await p.textContent(sel)).replace(/\s+/g, ' '));
async function signIn(b, url, email, w = 1440) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/409/.test(m.text()) && errors.push(m.text()));
  await p.goto(url); await p.waitForSelector('.role-card');
  ok((await text(p, '.auth-credit')).includes('Penny v1.6.0'), `sign-in screen shows the version (${url})`);
  await p.click(`.role-card[data-email="${email}"]`); await p.waitForSelector('#shell', { state: 'visible' });
  await p.waitForTimeout(500);
  return { ctx, p };
}
(async () => {
  const b = await chromium.launch();
  // ---------------------------------------------------------------- website, up to date
  publish([]);
  let { ctx, p } = await signIn(b, STATIC, 'avery@penny.demo');
  ok((await text(p, '#app-version')) === "Penny v1.6.0 · What's new", 'footer shows the version and What\'s new');
  ok(await p.isHidden('#update-banner'), 'no banner when up to date');
  await p.click('#user-btn'); await p.click('#check-updates'); await p.waitForSelector('#uc-body .uc-grid');
  let t = await text(p, '#dialog');
  ok(/This version\s*1\.6\.0/.test(t) && /Newest version\s*1\.6\.0/.test(t) && /You are up to date/.test(t) && !/Update now/.test(t), 'Check for updates: up to date, no update button');
  await p.click('#dlg-cancel');
  await p.click('#app-version'); await p.waitForTimeout(300);
  t = await text(p, '#main');
  ok(/What's new/.test(t) && /Penny 1\.6\.0/.test(t) && /You are on this version/.test(t) && /Penny 1\.0\.0/.test(t), 'What\'s new lists every version and marks this one');
  await p.screenshot({ path: S + 'v16-whatsnew.png' });

  // ---------------------------------------------------------------- website, optional update published while open
  publish([{ version: '1.6.1', date: '2026-11-20', required: false, summary: 'Small fixes to the manual entry form.', notes: ['Tab order fixed.'] }]);
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p.waitForTimeout(500);
  t = await text(p, '#update-banner');
  ok(/Penny 1\.6\.1 is ready/.test(t) && /Skip this version/.test(t) && /Update now/.test(t), 'optional update shows a calm banner with update, what\'s new and skip');
  ok((await p.getAttribute('#update-banner', 'role')) === 'status', 'optional banner is a status, not an alert');
  await p.screenshot({ path: S + 'v16-optional.png' });
  await p.click('#user-btn'); await p.click('#check-updates'); await p.waitForSelector('#uc-body .uc-grid');
  t = await text(p, '#dialog');
  ok(/This version\s*1\.6\.0/.test(t) && /Newest version\s*1\.6\.1/.test(t) && /optional update is ready/.test(t) && /Update now/.test(t) && /Skip this version/.test(t), 'Check for updates: optional update with update and skip');
  await p.screenshot({ path: S + 'v16-check.png' });
  await p.click('#dlg-cancel');
  await p.click('[data-update-skip]'); await p.waitForTimeout(200);
  ok(await p.isHidden('#update-banner'), 'skip hides the banner');
  ok(/1\.6\.1 available/.test(await text(p, '#app-version')), 'footer still says a version is available');
  await p.reload(); await p.waitForSelector('#shell', { state: 'visible' }); await p.waitForTimeout(500);
  ok(await p.isHidden('#update-banner'), 'the skip is remembered after reload');
  publish([{ version: '1.6.2', date: '2026-11-25', required: false, summary: 'Another small fix.', notes: [] },
           { version: '1.6.1', date: '2026-11-20', required: false, summary: 'Small fixes.', notes: [] }]);
  await p.reload(); await p.waitForSelector('#shell', { state: 'visible' }); await p.waitForTimeout(500);
  ok(/Penny 1\.6\.2 is ready/.test(await text(p, '#update-banner')), 'a newer version brings the banner back');

  // ---------------------------------------------------------------- website, required update
  publish([{ version: '1.7.0', date: '2026-12-01', required: true, summary: 'Fixes how tax is split across lines.', notes: ['Tax splits round to the cent.'] }]);
  await p.reload(); await p.waitForSelector('#shell', { state: 'visible' }); await p.waitForTimeout(600);
  t = await text(p, '#update-banner');
  ok(/Update required: Penny 1\.7\.0/.test(t) && /read-only/.test(t) && !/Skip/.test(t), 'required update shows a warning banner with no skip');
  ok((await p.getAttribute('#update-banner', 'role')) === 'alert', 'required banner is an alert');
  await p.screenshot({ path: S + 'v16-required.png' });
  await p.goto(STATIC + '#/invoices/APINBOX_0001'); await p.waitForTimeout(400);
  ok((await text(p, '#main')).includes('PBS-604418'), 'reading an invoice still works');
  await p.goto(STATIC + '#/whats-new'); await p.reload(); await p.waitForSelector('#shell', { state: 'visible' }); await p.waitForTimeout(700);
  ok(/Penny 1\.7\.0/.test(await text(p, '#main')) && /New/.test(await text(p, '#main')), 'opening What\'s new directly shows the notes, with 1.7.0 marked new');
  await p.goto(STATIC + '#/invoices/APINBOX_0001'); await p.waitForTimeout(400);
  await p.click('[data-act="note"]'); await p.fill('#dlg-note', 'Trying to change something.'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(300);
  ok(/Paused until you update/.test(await text(p, '#toast')), 'a change is refused with a reason');
  const notes = await p.evaluate(() => JSON.parse(localStorage.getItem('penny.sandbox.v1') || '{"events":[]}').events.filter((e) => e.type === 'note.add').length);
  ok(notes === 0, 'nothing was saved');
  await p.goto(STATIC + '#/help/updates'); await p.waitForTimeout(300);
  ok(/Versions and updates/.test(await text(p, '#main')), 'help article explains updates');
  // Update now: the page reloads and picks up whatever the site now serves (here still 1.6.0 code, so still required).
  const nav = p.waitForNavigation();
  await p.click('[data-update-now]'); await nav; await p.waitForSelector('#shell', { state: 'visible' });
  ok(true, 'Update now reloads the page');
  await p.setViewportSize({ width: 390, height: 844 }); await p.goto(STATIC + '#/'); await p.waitForTimeout(400);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'banner and footer fit a phone');
  await p.screenshot({ path: S + 'v16-required-phone.png' });
  await ctx.close();
  publish([]);

  // ---------------------------------------------------------------- Penny on a computer, required update
  ({ ctx, p } = await signIn(b, LOCAL, 'sam@penny.demo'));
  t = await text(p, '#update-banner');
  ok(/Update required: Penny 1\.7\.0/.test(t) && /real runs/.test(t) && /How to update/.test(t), 'local copy: required banner says real runs are paused');
  await p.click('#user-btn'); await p.click('#check-updates'); await p.waitForSelector('#uc-body .uc-grid', { timeout: 15000 });
  t = await text(p, '#dialog');
  ok(/This version\s*1\.6\.0/.test(t) && /Newest version\s*1\.7\.0/.test(t) && /required update is waiting/.test(t) && /\.\/penny update/.test(t) && !/Skip this version/.test(t), 'Check for updates on a computer: required, terminal steps, no skip');
  await p.screenshot({ path: S + 'v16-check-local.png' });
  await p.click('#dlg-cancel');
  await p.click('[data-update-help]'); await p.waitForTimeout(200);
  ok(/\.\/penny update/.test(await text(p, '#dialog')), 'how-to-update dialog gives the terminal command');
  await p.click('#dlg-cancel');
  const res = await p.evaluate(async () => { const r = await fetch('api/batches', { method: 'POST', headers: { 'X-Penny': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'blocked', user: { id: 'sam', name: 'Sam Rivera', role: 'admin' } }) }); return [r.status, (await r.json()).error]; });
  ok(res[0] === 409 && /required update/.test(res[1]), `server refuses a new batch (${res[0]})`);
  await p.goto(LOCAL + '#/runs/run1_batch01'); await p.waitForTimeout(300);
  ok((await text(p, '#main')).includes('Batch 01'), 'reading runs still works on the local copy');
  await ctx.close();

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
