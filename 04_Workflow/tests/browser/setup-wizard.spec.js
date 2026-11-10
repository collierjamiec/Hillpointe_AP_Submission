// The setup wizard (v2.1): a fresh Penny, walked through from "is this computer ready" to "all set". Checks that
// the wizard is closed without its one-time key, finds the invoice package, creates the first Admin with a real
// password, saves the choices, passes the accessibility check on every screen, and fits a phone.
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const { SETUP, SETUP_KEY, SETUP_PACKAGE, LAB, SHOTS } = require('./lab.js');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
let fails = 0;
const ok = (c, m, extra) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); if (!c && extra !== undefined) console.log('    ' + JSON.stringify(extra).slice(0, 600)); };
const errors = [];
const text = async (p, sel) => ((await p.textContent(sel)) || '').replace(/\s+/g, ' ');
const h1 = (p, t) => p.waitForFunction((t) => { const h = document.querySelector('#wizard h1'); return h && h.textContent.includes(t); }, t);
async function axe(p, name) {
  if (!(await p.evaluate(() => !!window.axe))) await p.addScriptTag({ content: AXE });
  const res = await p.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }));
  ok(!res.violations.length, `${name}: no WCAG 2.2 AA problems found by axe`, res.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true });     // bypassCSP only so the test can add axe
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/(401|404|422)/.test(m.text()) && errors.push(m.text()));

  // ---- closed without the key
  await p.goto(SETUP + 'setup.html'); await h1(p, 'Setup is closed');
  ok(/only opens when Penny starts it/.test(await text(p, '#wizard')) && /\.\/penny setup/.test(await text(p, '#wizard')), 'without the one-time key the wizard is closed, and says how to open it');
  const noKey = await p.evaluate(async () => [(await fetch('api/setup', { headers: { 'X-Penny': '1' } })).status,
    (await fetch('api/setup', { headers: { 'X-Penny': '1', 'X-Penny-Setup': 'wrong-key-wrong-key' } })).status,
    (await fetch('api/setup/admin', { method: 'POST', headers: { 'X-Penny': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mallory', email: 'm@evil.test', password: 'copper kettle morning' }) })).status]);
  ok(noKey.every((s) => s === 404), 'the wizard answers "not found" to a request with no key or the wrong key, including one that tries to create an Admin', noKey);
  await axe(p, 'setup closed');

  // ---- step 1: this computer
  await p.goto(SETUP + 'setup.html#key=' + SETUP_KEY); await h1(p, 'Is this computer ready?');
  ok(!/key=/.test(p.url()), 'the key is taken out of the address bar straight away');
  ok(/Python/.test(await text(p, '.check-list')) && /pdfplumber/.test(await text(p, '.check-list')) && /Database/.test(await text(p, '.check-list')) && /This computer is ready/.test(await text(p, '#wizard')), 'step 1 checks Python, the libraries, the database and says the computer is ready');
  ok(await p.$eval('#steps li[aria-current="step"]', (x) => x.textContent.includes('This computer')), 'the step list marks where you are');
  await axe(p, 'step 1');
  await p.screenshot({ path: SHOTS + 'setup-1-check.png' });
  await p.click('[data-go="next"]'); await h1(p, 'Where is your invoice package?');
  ok(await p.evaluate(() => document.activeElement.id === 'wizard'), 'moving to a new step moves focus to it, for keyboard and screen reader users');

  // ---- step 2: the invoice package
  ok(await p.$eval('[data-go="next"]', (x) => x.disabled), 'Continue waits until a folder is checked');
  await p.fill('#pkg-path', '/no/such/folder'); await p.click('#pkg-form button[type=submit]'); await p.waitForSelector('#wizard [role=alert]');
  ok(/no folder at that path/.test(await text(p, '#wizard [role=alert]')), 'a path that does not exist is explained');
  await p.fill('#pkg-path', LAB); await p.click('#pkg-form button[type=submit]'); await p.waitForFunction(() => /not the invoice package/.test(document.querySelector('#wizard [role=alert]')?.textContent || ''));
  ok(true, 'a folder that is not the package is explained');
  await p.fill('#pkg-path', path.dirname(SETUP_PACKAGE)); await p.click('#pkg-form button[type=submit]'); await p.waitForSelector('.setup-found');
  ok(/This is the invoice package/.test(await text(p, '.setup-found')) && /1 reference file and 1 invoice PDF in 1 folder/.test(await text(p, '.setup-found')) && (await p.inputValue('#pkg-path')) === fs.realpathSync(SETUP_PACKAGE),
    'the package is found even from the folder above it, and Penny says what is inside');
  await axe(p, 'step 2');
  await p.click('[data-go="next"]'); await h1(p, 'Who will use Penny?');

  // ---- step 3: who uses Penny
  ok(await p.isChecked('input[name=mode][value=solo]') && !(await p.$('#ad-name')), 'it starts on "Just me", with nothing to fill in');
  await p.check('input[name=mode][value=team]'); await p.waitForSelector('#ad-name');
  await axe(p, 'step 3');
  await p.fill('#ad-name', 'Sam Rivera'); await p.fill('#ad-email', 'sam@hillpointe.com'); await p.fill('#ad-pw', 'short');
  await p.click('#people-form button[type=submit]'); await p.waitForSelector('#wizard [role=alert]');
  ok(/at least 10 characters/.test(await text(p, '#wizard [role=alert]')) && (await p.inputValue('#ad-name')) === 'Sam Rivera' && (await p.inputValue('#ad-pw')) === '', 'a weak password is refused with the reason; the name is kept and the password is not');
  await p.fill('#ad-pw', 'sam rivera loves ap'); await p.click('#people-form button[type=submit]');
  await p.waitForFunction(() => /name in the password/.test(document.querySelector('#wizard [role=alert]')?.textContent || ''));
  ok(true, 'a password with your own name in it is refused');
  await p.fill('#ad-pw', 'copper kettle morning');
  await p.click('#pw-toggle');
  ok(await p.$eval('#ad-pw', (x) => x.type === 'text') && await p.$eval('#pw-toggle', (x) => x.getAttribute('aria-pressed') === 'true'), 'Show reveals the password');
  await p.click('#people-form button[type=submit]'); await h1(p, 'A few settings');
  ok(true, 'a good password creates the first Admin and moves on');

  // ---- step 4: settings
  ok(await p.isChecked('input[name=https][value=""]') && /Saved to the outbox/.test(await text(p, '#wizard')), 'settings start on "Only this computer" and say honestly where email goes');
  await p.selectOption('#zone', 'America/Chicago'); await p.check('input[name=watch]');
  await p.check('input[name=https][value="1"]'); await p.waitForSelector('#host');
  ok(await p.inputValue('#zone') === 'America/Chicago' && await p.isChecked('input[name=watch]'), 'choosing the network keeps what was already chosen on the screen');
  await p.click('#settings-form button[type=submit]'); await p.waitForSelector('#wizard [role=alert]');
  ok(/Make a certificate first/.test(await text(p, '#wizard [role=alert]')), 'Penny will not finish with the network on and no certificate');
  await p.fill('#host', 'bad host!'); await p.click('[data-go="cert"]');
  await p.waitForFunction(() => /not a computer name/.test(document.querySelector('#wizard [role=alert]')?.textContent || ''));
  ok(true, 'a computer name that cannot go on a certificate is refused');
  await p.fill('#host', 'ap-server.hillpointe.local'); await p.click('[data-go="cert"]'); await p.waitForSelector('.setup-cert .setup-found', { timeout: 30000 });
  ok(/A certificate is ready/.test(await text(p, '.setup-cert')) && fs.existsSync(path.join(LAB, 'setup', 'state', 'tls', 'cert.pem')), 'Make a certificate makes one and says until when it is good');
  await axe(p, 'step 4');
  await p.screenshot({ path: SHOTS + 'setup-4-settings.png', fullPage: true });
  await p.click('#settings-form button[type=submit]'); await h1(p, 'Penny is set up');

  // ---- step 5: all set
  const saved = JSON.parse(fs.readFileSync(path.join(LAB, 'setup', 'state', 'setup.json'), 'utf8'));
  ok(saved.mode === 'team' && saved.https === true && saved.host === '0.0.0.0' && saved.watch === true && saved.package === fs.realpathSync(SETUP_PACKAGE) && !!saved.done, 'the choices are saved for ./penny start', saved);
  ok(JSON.parse(fs.readFileSync(path.join(LAB, 'setup', 'rules.json'), 'utf8')).display.time_zone === 'America/Chicago', 'the time zone is saved to the rules');
  const done = await text(p, '#wizard');
  ok(/You are the Admin: sam@hillpointe.com/.test(done) && /https:\/\/ap-server\.hillpointe\.local:8765\//.test(done) && /double-clicking Start Penny/.test(done) && /One more step/.test(done), 'the last screen says what was chosen and how to start Penny from now on');
  ok(!/copper kettle/.test(JSON.stringify(saved)) && !/copper kettle/.test(await p.content()), 'the password is nowhere on the page or in the saved choices');
  await axe(p, 'step 5');
  await p.screenshot({ path: SHOTS + 'setup-5-done.png', fullPage: true });

  // ---- the account really works, and a second first-Admin is refused
  const again = await p.evaluate(async (key) => { const r = await fetch('api/setup/admin', { method: 'POST', headers: { 'X-Penny': '1', 'X-Penny-Setup': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Second Admin', email: 'two@hillpointe.com', password: 'copper kettle morning' }) }); return [r.status, (await r.json()).error]; }, SETUP_KEY);
  ok(again[0] === 422 && /already set up/.test(again[1]), 'once people exist, the wizard will not create another "first" Admin', again);
  await p.goto(SETUP); await p.waitForSelector('#login-form');
  await p.fill('#login-email', 'sam@hillpointe.com'); await p.fill('#login-pw', 'copper kettle morning'); await p.click('#login-submit');
  await p.waitForSelector('#shell', { state: 'visible' });
  ok(/Team/.test(await text(p, '.demo-pill')) && /Admin/.test(await text(p, '#user-role')), 'the Admin the wizard made can sign in, and Penny is in team mode');
  await p.goto(SETUP + '#/batch'); await p.waitForSelector('#main h1');
  ok(await p.evaluate(() => !!(SERVER && SERVER.engine)), 'the invoice package chosen in the wizard is in use straight away');

  // ---- running the wizard again starts from what was saved
  await p.goto(SETUP + 'setup.html#key=' + SETUP_KEY); await h1(p, 'Is this computer ready?');
  await p.click('[data-go="next"]'); await p.waitForSelector('.setup-found');
  await p.click('[data-go="next"]'); await h1(p, 'Who will use Penny?');
  ok(/Sign-in is already on: 1 person/.test(await text(p, '#wizard')) && await p.isChecked('input[name=mode][value=team]') && await p.$eval('input[name=mode][value=solo]', (x) => x.disabled) && !(await p.$('#ad-name')),
    'run again, the wizard remembers the folder and knows sign-in is already on');
  await ctx.close();

  // ---- on a phone
  const phone = await b.newContext({ ...devices['iPhone 13'] });
  const m = await phone.newPage();
  m.on('pageerror', (e) => errors.push(e.message));
  await m.goto(SETUP + 'setup.html#key=' + SETUP_KEY); await h1(m, 'Is this computer ready?');
  const fit = async () => !(await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1));
  let fits = await fit();
  await m.tap('[data-go="next"]'); await m.waitForSelector('#pkg-path'); fits = fits && await fit();
  ok(fits && await m.evaluate(() => [...document.querySelectorAll('#wizard .btn, #wizard input')].filter((x) => x.offsetParent).every((x) => x.getBoundingClientRect().height >= 40)), 'the wizard fits a phone, with thumb-sized buttons and fields');
  await m.screenshot({ path: SHOTS + 'setup-phone.png' });
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
