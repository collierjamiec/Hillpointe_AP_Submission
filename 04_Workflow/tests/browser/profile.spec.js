// My profile: each person changes their own name, title, about line, backup person and photo. The username and user
// ID are shown and cannot be changed. A photo is shrunk in the browser. "My activity" is private. With real accounts
// the server saves the profile and changes the password. It fits a phone and passes the keyboard and WCAG checks.
const fs = require('fs');
const { chromium, devices } = require('playwright');
const { DEMO, ACCOUNTS, SHOTS } = require('./lab.js');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
let fails = 0;
const ok = (c, m, extra) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); if (!c && extra) console.log('    ' + extra); };
const errors = [];
const watch = (p, quiet) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && !(quiet && quiet.test(m.text())) && errors.push(m.text())); };
const settle = (p) => p.waitForTimeout(300);
const PW = 'copper kettle morning';
/** A real PNG, 300 by 200 and mostly red, made in the page so the test needs no picture file. */
const picture = (p) => p.evaluate(() => new Promise((done) => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#c0392b'; g.fillRect(0, 0, 300, 200); c.toBlob((b) => b.arrayBuffer().then((a) => done([...new Uint8Array(a)])), 'image/png'); }));
async function audit(p) {
  await p.addScriptTag({ content: AXE });
  const res = await p.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }));
  return res.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true });   // bypassCSP only so the test can add axe
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const p = await ctx.newPage(); watch(p);
  await p.goto(DEMO); await p.click('.role-card[data-email="avery@penny.demo"]'); await p.waitForSelector('#shell', { state: 'visible' });

  // ---- finding it, and what it shows
  await p.click('#user-btn');
  ok(await p.isVisible('#my-profile'), 'My profile is in the menu under your name');
  await p.click('#my-profile'); await settle(p);
  ok(await p.evaluate(() => location.hash === '#/profile' && document.querySelector('#user-pop').hidden && document.title.startsWith('My profile')), 'it opens the page and closes the menu');
  ok(await p.evaluate(() => document.querySelector('#pf-name').value === 'Avery Chen' && document.querySelector('#pf-avatar').textContent.trim() === 'AC'), 'the form starts with your name, and your initials stand in for a photo');
  ok(await p.evaluate(() => document.querySelector('#pf-username').textContent === 'avery@penny.demo' && !document.querySelector('#main input[type=email]') && /cannot be changed/.test(document.querySelector('#main').textContent)), 'the username and user ID are shown as facts, with no way to edit them');
  ok(await p.evaluate(() => /Demo accounts sign in with a click/.test(document.querySelector('.pf-pw').textContent) && !document.querySelector('#pw-form')), 'a demo person has no password to change, and the page says so');
  ok(await p.evaluate(() => [...document.querySelectorAll('#pf-backup option')].map((o) => o.textContent).join('|').includes('Sam Rivera') && ![...document.querySelectorAll('#pf-backup option')].some((o) => o.textContent.startsWith('Avery'))), 'the backup list has your teammates and not you');
  const found = await audit(p);
  ok(!found.length, 'no WCAG 2.2 AA problems found by axe', found.join('; '));

  // ---- changing details
  await p.fill('#pf-name', 'A'); await p.click('#pf-save'); await settle(p);
  ok(await p.evaluate(() => !document.querySelector('#pf-error').hidden && /Enter your name/.test(document.querySelector('#pf-error').textContent) && document.activeElement.id === 'pf-name'), 'a one-letter name is refused, and focus goes to the field');
  await p.fill('#pf-name', 'Avery M. Chen'); await p.fill('#pf-title', 'Senior AP specialist'); await p.fill('#pf-about', 'Construction invoices. Out on Fridays.');
  ok(await p.evaluate(() => document.querySelector('#pf-count').textContent === '(38 of 280)'), 'the about line counts its characters');
  await p.selectOption('#pf-backup', { label: 'Sam Rivera, AP manager' });
  const before = await p.evaluate(() => EV.length);
  await p.click('#pf-save'); await settle(p);
  ok(await p.evaluate(() => /Saved/.test(document.querySelector('#pf-saved').textContent) && document.querySelector('#user-name').textContent === 'Avery M. Chen' && document.querySelector('#user-avatar').textContent === 'AM'), 'saving updates the name and initials in the top bar at once');
  const ev = await p.evaluate((n) => { const e = EV[EV.length - 1]; return { more: EV.length - n, type: e.type, changes: e.changes }; }, before);
  ok(ev.more === 1 && ev.type === 'user.profile_updated' && ev.changes.name[1] === 'Avery M. Chen' && ev.changes.title[1] === 'Senior AP specialist', 'the change is one entry in the audit trail, with before and after', JSON.stringify(ev));
  await p.click('#pf-save'); await settle(p);
  ok(await p.evaluate((n) => EV.length === n + 1 && /Nothing to save/.test(document.querySelector('#pf-saved').textContent), before), 'saving again with nothing changed records nothing');

  // ---- the photo
  const png = await picture(p);
  await p.setInputFiles('#pf-file', { name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(png) }); await settle(p);
  const shown = await p.evaluate(() => { const i = document.querySelector('#pf-avatar img'); return i && { head: i.src.slice(0, 23), size: i.src.length, kept: document.querySelector('#pf-about').value, top: !!document.querySelector('#user-avatar img') }; });
  ok(shown && shown.head === 'data:image/jpeg;base64,' && shown.size < 40000, 'a chosen picture is cut to a small square JPEG in the browser', JSON.stringify(shown));
  ok(shown && shown.kept === 'Construction invoices. Out on Fridays.' && !shown.top, 'what you typed is kept, and nothing changes elsewhere until you save');
  const dims = await p.evaluate(() => new Promise((done) => { const i = new Image(); i.onload = () => done([i.naturalWidth, i.naturalHeight]); i.src = document.querySelector('#pf-avatar img').src; }));
  ok(dims[0] === 192 && dims[1] === 192, 'it is 192 by 192 pixels', dims.join('x'));
  await p.click('#pf-save'); await settle(p);
  ok(await p.evaluate(() => !!document.querySelector('#user-avatar img') && document.querySelector('#user-avatar img').alt === ''), 'after saving, the photo replaces your initials in the top bar');
  ok(await p.evaluate(() => { const e = EV[EV.length - 1]; return e.changes.photo.join() === 'none,a new photo' && !JSON.stringify(EV).includes('base64'); }), 'the audit trail says the photo changed and never holds the picture');
  await p.screenshot({ path: SHOTS + 'profile.png' });
  await p.setInputFiles('#pf-file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }); await settle(p);
  ok(await p.evaluate(() => /PNG, JPEG or WebP/.test(document.querySelector('#pf-error').textContent)), 'a file that is not a picture is refused in plain words');
  await p.setInputFiles('#pf-file', { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not really a picture') }); await settle(p);
  ok(await p.evaluate(() => /could not be read/.test(document.querySelector('#pf-error').textContent)), 'so is a file that only claims to be one');

  // ---- it stays after a reload, shows on Users, and comes off again
  await p.reload(); await p.waitForSelector('#shell', { state: 'visible' }); await settle(p);
  ok(await p.evaluate(() => document.querySelector('#pf-name').value === 'Avery M. Chen' && !!document.querySelector('#user-avatar img') && document.querySelector('#pf-backup').selectedOptions[0].textContent.startsWith('Sam Rivera')), 'the profile is still there after a reload');
  await p.click('#pf-photo-remove'); await settle(p); await p.click('#pf-save'); await settle(p);
  ok(await p.evaluate(() => !document.querySelector('#user-avatar img') && document.querySelector('#user-avatar').textContent === 'AM'), 'removing the photo brings your initials back');

  // ---- my activity is yours alone
  await p.goto(DEMO + '#/invoices'); await settle(p);
  const held = await p.evaluate(() => X.docs.filter(openHold)[0].id);
  await p.evaluate((id) => record('note.add', { doc: id, text: 'Checked with the PM.' }), held);
  await p.goto(DEMO + '#/profile'); await settle(p);
  const act = await p.evaluate(() => ({ n: +document.querySelector('#pf-actions').textContent, rows: [...document.querySelectorAll('.pf-breakdown tbody tr')].map((r) => r.textContent.trim()), note: /Only you can see this/.test(document.querySelector('#main').textContent) }));
  ok(act.n === 4 && act.rows.some((r) => r.startsWith('Changed their profile')) && act.rows.some((r) => r.startsWith('Added a note')), 'My activity counts your own actions by kind', JSON.stringify(act));
  ok(act.note, 'and says only you can see it');
  await p.click('#user-btn'); await p.click('#sign-out'); await settle(p);
  await p.click('.role-card[data-email="sam@penny.demo"]'); await p.waitForSelector('#shell', { state: 'visible' });
  await p.goto(DEMO + '#/profile'); await settle(p);
  ok(await p.evaluate(() => document.querySelector('#pf-name').value === 'Sam Rivera' && document.querySelector('#pf-actions').textContent === '0'), "another person sees their own profile and their own count, not Avery's");
  await p.goto(DEMO + '#/users'); await settle(p);
  ok(await p.evaluate(() => { const row = [...document.querySelectorAll('#main table.users tbody tr')].find((r) => r.textContent.includes('Avery M. Chen')); return row && /Senior AP specialist/.test(row.textContent) && /Out on Fridays/.test(row.textContent) && /Covered by Sam Rivera/.test(row.textContent); }), 'an Admin sees the title, about line and backup person on Users');
  await p.goto(DEMO + '#/audit'); await settle(p);
  ok(await p.evaluate(() => /Changed their profile/.test(document.querySelector('#main table.audit').textContent)), 'the audit trail names the profile change');
  await ctx.close();

  // ---- on a phone
  const ph = await b.newContext({ ...devices['iPhone 13'] });
  await ph.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const m = await ph.newPage(); watch(m);
  await m.goto(DEMO); await m.tap('.role-card[data-email="jordan@penny.demo"]'); await m.waitForSelector('#shell', { state: 'visible' });
  await m.goto(DEMO + '#/profile'); await settle(m);
  const fit = await m.evaluate(() => { const vis = (el) => el.offsetParent; const ctl = [...document.querySelectorAll('#main button, #main label.btn, #main select, #main input:not([type=file]), #main textarea')].filter(vis).map((x) => x.getBoundingClientRect()); return { sideways: document.documentElement.scrollWidth > innerWidth + 1, small: ctl.filter((r) => r.height < 40).length, zoom: [...document.querySelectorAll('#main input:not([type=file]), #main textarea, #main select')].filter((x) => parseFloat(getComputedStyle(x).fontSize) < 16).length }; });
  ok(!fit.sideways, 'on a phone nothing scrolls sideways');
  ok(fit.small === 0, 'every control is thumb sized', String(fit.small));
  ok(fit.zoom === 0, 'and typing does not zoom the page', String(fit.zoom));
  await ph.close();

  // ---- with real accounts: the server saves the profile and changes the password
  const team = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await team.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const t = await team.newPage(); watch(t, /(400|401|403|409|422|429)/);
  const signIn = async (pw) => { await t.goto(ACCOUNTS); await t.waitForSelector('#login-form'); await t.fill('#login-email', 'jordan@hillpointe.com'); await t.fill('#login-pw', pw); await t.click('#login-submit'); };
  await signIn(PW); await t.waitForSelector('#shell', { state: 'visible' });
  await t.goto(ACCOUNTS + '#/profile'); await t.waitForSelector('#pf-form'); await settle(t);
  ok(await t.evaluate(() => /Penny account/.test(document.querySelector('.pf-facts').textContent) && !!document.querySelector('#pw-form')), 'with real accounts the page offers a password change');
  await t.fill('#pf-about', 'Approvals for Pointe Grand.'); await t.click('#pf-save'); await settle(t);
  await t.reload(); await t.waitForSelector('#pf-form'); await settle(t);
  ok(await t.evaluate(() => document.querySelector('#pf-about').value === 'Approvals for Pointe Grand.' && localStorage.getItem('penny.users.v1') === null), 'the profile is saved on the server, not in this browser');
  await t.goto(ACCOUNTS + '#/audit'); await t.waitForSelector('#main table.audit'); await settle(t);
  ok(await t.evaluate(() => /Changed their profile/.test(document.querySelector('#main table.audit').textContent)), 'and the server wrote it into the team audit trail');
  await t.goto(ACCOUNTS + '#/profile'); await t.waitForSelector('#pf-form'); await settle(t);
  const sent = await t.evaluate(async () => { const r = await fetch('api/me/profile', { method: 'POST', headers: { 'X-Penny': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ changes: { email: 'boss@hillpointe.com', role: 'admin' } }) }); const j = await r.json(); return [r.status, j.user.email, j.user.role, Object.keys(j.changes).length]; });
  ok(sent.join() === '200,jordan@hillpointe.com,approver,0', 'asking the server to change the username or role changes nothing', sent.join());
  const NEW = 'walnut ferry lantern';
  await t.fill('#pw-current', 'not my password'); await t.fill('#pw-new', NEW); await t.fill('#pw-again', NEW); await t.click('#pw-save'); await settle(t);
  ok(await t.evaluate(() => /not your current password/.test(document.querySelector('#pw-error').textContent)), 'a wrong current password is refused');
  await t.fill('#pw-current', PW); await t.fill('#pw-again', NEW + '!'); await t.click('#pw-save'); await settle(t);
  ok(await t.evaluate(() => /do not match/.test(document.querySelector('#pw-error').textContent)), 'two new passwords that differ are caught before anything is sent');
  await t.fill('#pw-again', NEW); await t.click('#pw-save'); await settle(t);
  ok(await t.evaluate(() => /Password changed/.test(document.querySelector('#pw-saved').textContent) && document.querySelector('#pw-current').value === ''), 'the right one works, the form clears, and you stay signed in');
  await t.click('#user-btn'); await t.click('#sign-out'); await t.waitForSelector('#login-form');
  await signIn(PW); await settle(t);
  ok(await t.evaluate(() => document.querySelector('#shell').hidden), 'the old password no longer signs in');
  await signIn(NEW); await t.waitForSelector('#shell', { state: 'visible' });
  ok(true, 'the new one does');
  // put the lab back the way the other suites expect it
  await t.goto(ACCOUNTS + '#/profile'); await t.waitForSelector('#pw-form');
  await t.fill('#pf-about', ''); await t.click('#pf-save'); await settle(t);
  await t.evaluate(async ([cur, old]) => { await fetch('api/me/password', { method: 'POST', headers: { 'X-Penny': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ current: cur, password: 'a stepping stone phrase' }) }); await fetch('api/me/password', { method: 'POST', headers: { 'X-Penny': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ current: 'a stepping stone phrase', password: old }) }); }, [NEW, PW]);
  await team.close();

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
