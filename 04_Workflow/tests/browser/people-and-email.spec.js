// People, sign-in links, email and the Outbox: the public demo, then a computer with real accounts.
const { chromium } = require('playwright');
const { DEMO, ACCOUNTS, UPDATES_SITE, UPDATES_LOCAL, FULL, SHOTS: S, UPDATES_RELEASES, VERSION } = require('./lab.js');

const LOCAL = ACCOUNTS;
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const errors = [];
const text = async (p, sel = '#main') => ((await p.textContent(sel)) || '').replace(/\s+/g, ' ');
const wait = (p, ms = 400) => p.waitForTimeout(ms);
async function newPage(b, w = 1440) {
  const ctx = await b.newContext({ viewport: { width: w, height: 950 } });
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/(401|403|409)/.test(m.text()) && errors.push(m.text()));
  return { ctx, p };
}
async function demoSignIn(p, email, pw) {
  await p.goto(DEMO); await p.waitForSelector('#login-form');
  await p.fill('#login-email', email); await p.fill('#login-pw', pw); await p.click('#login-submit');
  await p.waitForSelector('#shell', { state: 'visible' }); await wait(p);
}
async function signOut(p) { await p.click('#user-btn'); await p.click('#sign-out'); await p.waitForSelector('#login-form'); }
async function lastMailLink(p) {
  await p.goto(DEMO + '#/outbox'); await wait(p);
  await p.click('[data-mail-open]'); await wait(p, 200);
  const href = await p.getAttribute('#dialog .mail-body a', 'href');
  await p.click('#dlg-cancel');
  return href;
}
(async () => {
  const b = await chromium.launch();
  // ================================================================ public demo
  let { ctx, p } = await newPage(b);
  await demoSignIn(p, 'sam@penny.demo', 'penny-admin');
  ok(await p.isVisible('[data-nav=users]') && await p.isVisible('[data-nav=outbox]'), 'Admin sees Users and Outbox');
  await p.goto(DEMO + '#/users'); await wait(p);
  let t = await text(p);
  ok(/Riley Brooks/.test(t) && /Demo account/.test(t) && /4 active/.test(t), 'Users lists the four demo accounts');
  await p.click('#user-invite');
  await p.fill('#dlg-name', 'Morgan Lee'); await p.fill('#dlg-email', 'morgan@hillpointe.com'); await p.fill('#dlg-title', 'AP specialist'); await p.selectOption('#dlg-role', 'clerk');
  await p.click('#dialog button[type=submit]'); await wait(p, 700);
  ok(/Morgan Lee/.test(await text(p)) && /Invited/.test(await text(p, '#users-body')), 'invited person appears as Invited');
  await p.screenshot({ path: S + 'v17-users.png' });
  const invite = await lastMailLink(p);
  ok(/#\/activate\?token=/.test(invite), 'invitation email in the Outbox has a one-time link');
  await signOut(p);
  await p.goto(invite); await p.waitForSelector('#link-form');
  ok(/Welcome to Penny, Morgan/.test(await text(p, '#auth')), 'link opens the set-up page');
  await p.fill('#link-pw', 'short'); await p.fill('#link-pw2', 'short'); await p.click('#link-submit'); await wait(p, 200);
  ok(/at least 10/.test(await text(p, '#link-error')), 'weak password refused with a reason');
  await p.fill('#link-pw', 'blue river lantern'); await p.fill('#link-pw2', 'blue river lantern'); await p.click('#link-submit');
  await p.waitForSelector('#login-form'); await wait(p, 200);
  ok((await p.inputValue('#login-email')) === 'morgan@hillpointe.com', 'back to sign-in with the email filled in');
  await p.goto(invite); await p.waitForSelector('#link-out');
  ok(/expired or was already used/.test(await text(p, '#auth')), 'the link works only once');
  await demoSignIn(p, 'morgan@hillpointe.com', 'blue river lantern');
  ok((await text(p, '#user-btn')).includes('Morgan Lee') && /AP Clerk/.test(await text(p, '#user-btn')), 'new person signs in with their role');
  ok(await p.isHidden('[data-nav=users]'), 'an AP Clerk has no Users page');
  // email an export
  await p.goto(DEMO + '#/exports'); await wait(p);
  await p.click('[data-email-file]'); await wait(p, 300);
  await p.fill('#dlg-to', 'friend@gmail.com'); await p.click('#dialog button[type=submit]'); await wait(p, 200);
  ok(/outside the domains/.test(await text(p, '#dlg-error')), 'outside address refused before sending');
  await p.fill('#dlg-to', 'ap@hillpointe.com'); await p.fill('#dlg-note', 'For review today.'); await p.click('#dialog button[type=submit]'); await wait(p, 500);
  await p.goto(DEMO + '#/outbox'); await wait(p);
  t = await text(p);
  ok(/ap@hillpointe\.com/.test(t) && /Demo: not sent/.test(t) && !/You're invited/.test(t), 'clerk sees only their own email in the Outbox');
  await signOut(p);
  // Admin changes and guards
  await demoSignIn(p, 'sam@penny.demo', 'penny-admin');
  await p.goto(DEMO + '#/users'); await wait(p);
  await p.click('[data-user-edit=morgan]'); await p.selectOption('#dlg-role', 'approver'); await p.click('#dialog button[type=submit]'); await wait(p, 500);
  ok(/Morgan Lee.*Approver/.test(await text(p, '#users-body')), 'Admin changes a role');
  await p.click('[data-user-reset=morgan]'); await wait(p, 500);
  const reset = await lastMailLink(p);
  ok(/#\/reset\?token=/.test(reset), 'password reset email has a link');
  await p.goto(DEMO + '#/users'); await wait(p);
  await p.click('[data-user-toggle=morgan]'); await p.click('#dialog button[type=submit]'); await wait(p, 500);
  ok(/Turned off/.test(await text(p, '#users-body')), 'Admin turns an account off');
  await p.click('[data-user-edit=sam]'); await p.selectOption('#dlg-role', 'viewer'); await p.click('#dialog button[type=submit]'); await wait(p, 500);
  ok(/cannot remove your own Admin role/.test(await text(p, '#dialog')), 'Admin cannot demote themselves');
  await p.click('#dlg-cancel');
  ok(!(await p.$('[data-user-toggle=sam]')), 'no turn-off button for yourself');
  await p.goto(DEMO + '#/audit'); await wait(p);
  t = await text(p, 'table.audit tbody');
  ok(/Invited someone/.test(t) && /Changed someone's account/.test(t) && /Sent a password reset/.test(t) && /Set up their account/.test(t) && /Sent an email/.test(t), 'audit trail records people and email actions');
  await signOut(p);
  await p.fill('#login-email', 'morgan@hillpointe.com'); await p.fill('#login-pw', 'blue river lantern'); await p.click('#login-submit'); await wait(p, 600);
  ok(/turned off/.test(await text(p, '#login-error')), 'a turned-off account cannot sign in');
  await p.click('[data-forgot]'); await p.fill('#forgot-email', 'nobody@hillpointe.com'); await p.click('#forgot-form button[type=submit]'); await wait(p, 300);
  ok(/If .* has an active Penny account/.test(await text(p, '#auth')), 'forgot password never says who has an account');
  // approval email as an Approver
  await p.click('#forgot-done-back');
  await demoSignIn(p, 'jordan@penny.demo', 'penny-approver');
  await p.goto(DEMO + '#/invoices/APINBOX_0003'); await wait(p);
  ok(!!(await p.$('[data-act="email-approval"]')), 'bill waiting for approval offers Email for approval');
  await p.click('[data-act="email-approval"]'); await wait(p, 300);
  await p.click('#dialog [data-add-to]'); await p.click('#dialog button[type=submit]'); await wait(p, 400);
  await p.goto(DEMO + '#/outbox'); await wait(p);
  ok(/Approval needed:/.test(await text(p)), 'approval request is in the Outbox');
  await p.setViewportSize({ width: 390, height: 844 });
  for (const h of ['#/outbox', '#/exports']) { await p.goto(DEMO + h); await wait(p, 300); ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `phone width fits ${h}`); }
  await ctx.close();

  // ================================================================ Penny on a computer with real accounts
  ({ ctx, p } = await newPage(b));
  await p.goto(LOCAL); await p.waitForSelector('#login-form');
  ok(!(await p.$('.role-card')) && /Use the email your Admin invited/.test(await text(p, '#auth')), 'server sign-in has no demo accounts');
  const blocked = await p.evaluate(async () => (await fetch('data/penny-data.json')).status);
  ok(blocked === 401, 'invoice data needs a session');
  await p.fill('#login-email', 'sam@hillpointe.com'); await p.fill('#login-pw', 'copper kettle morning'); await p.click('#login-submit');
  await p.waitForSelector('#shell', { state: 'visible' }); await wait(p, 600);
  ok((await text(p, '#user-btn')).includes('Sam Rivera'), 'signed in through the server');
  await p.goto(LOCAL + '#/users'); await wait(p, 600);
  ok(/Accounts on this computer/.test(await text(p)) && /Saved to the outbox, not sent/.test(await text(p)), 'Users page says how email goes out');
  await p.click('#user-invite');
  await p.fill('#dlg-name', 'Riley Brooks'); await p.fill('#dlg-email', 'riley@hillpointe.com'); await p.selectOption('#dlg-role', 'viewer');
  await p.click('#dialog button[type=submit]'); await wait(p, 900);
  ok(/saved to the Outbox, not sent/.test(await text(p, '#toast')), 'invite saved, not sent, and Penny says so');
  await p.goto(LOCAL + '#/outbox'); await wait(p, 600);
  await p.click('[data-mail-open]'); await wait(p, 200);
  const link = await p.getAttribute('#dialog .mail-body a', 'href');
  ok(/#\/activate\?token=/.test(link), 'saved invitation carries the link for the Admin to pass on');
  await p.click('#dlg-cancel');
  await p.goto(LOCAL + '#/exports'); await wait(p, 500);
  await p.click('[data-email-file]'); await wait(p, 300);
  await p.fill('#dlg-to', 'ap@hillpointe.com'); await p.click('#dialog button[type=submit]'); await wait(p, 800);
  ok(/Saved to the Outbox, not sent/.test(await text(p, '#toast')), 'export email goes through the server');
  const r2 = await ctx.newPage();
  await r2.goto(link); await r2.waitForSelector('#link-form');
  await r2.fill('#link-pw', 'quiet harbor evening'); await r2.fill('#link-pw2', 'quiet harbor evening'); await r2.click('#link-submit');
  await r2.waitForSelector('#login-form'); await wait(r2, 200);
  ok(/Your password is set/.test(await text(r2, '#auth')), 'activation through the server');
  await r2.close();
  await p.click('#user-btn'); await p.click('#sign-out'); await p.waitForSelector('#login-form');
  await p.fill('#login-email', 'riley@hillpointe.com'); await p.fill('#login-pw', 'quiet harbor evening'); await p.click('#login-submit');
  await p.waitForSelector('#shell', { state: 'visible' }); await wait(p, 600);
  ok(/Viewer/.test(await text(p, '#user-btn')) && await p.isHidden('[data-nav=users]'), 'the new Viewer signs in with Viewer access');
  const forged = await p.evaluate(async () => (await fetch('api/batches', { method: 'POST', headers: { 'X-Penny': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', user: { id: 'sam', role: 'admin', name: 'Sam' } }) })).status);
  ok(forged === 403, 'a Viewer cannot pretend to be an Admin');
  await p.goto(LOCAL + '#/audit'); await wait(p, 500);
  t = await text(p, 'table.audit tbody');
  ok(/Invited someone/.test(t) && /Set up their account/.test(t) && /Saved an email/.test(t), 'server audit log shows people and email');
  await p.screenshot({ path: S + 'v17-local-audit.png' });
  await ctx.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
