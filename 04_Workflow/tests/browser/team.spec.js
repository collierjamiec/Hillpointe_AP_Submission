// Working as a team (v2.0): three people signed in to the same Penny at once. What one does shows up for the others
// without a reload, the server decides who is acting and what they may do, two people cannot both resolve a hold,
// rule changes become the rules on disk, and nothing is kept in the browser.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ACCOUNTS, LAB } = require('./lab.js');
let fails = 0;
const ok = (c, m, extra) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); if (!c && extra !== undefined) console.log('    ' + JSON.stringify(extra).slice(0, 400)); };
const errors = [];
const PW = 'copper kettle morning';
const text = async (p, sel) => ((await p.textContent(sel)) || '').replace(/\s+/g, ' ');

async function signIn(b, email, before) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  if (before) await ctx.addInitScript(before);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${email}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !/(400|401|403|409|422)/.test(m.text()) && errors.push(`${email}: ${m.text()}`));
  await p.goto(ACCOUNTS); await p.waitForSelector('#login-form');
  await p.fill('#login-email', email); await p.fill('#login-pw', PW); await p.click('#login-submit');
  await p.waitForSelector('#shell', { state: 'visible' });
  return p;
}
/** Send an action straight to the server, the way a tampered browser might. */
const post = (p, event) => p.evaluate(async (event) => {
  const r = await fetch('api/events', { method: 'POST', headers: { 'X-Penny': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ event }) });
  return { status: r.status, body: await r.json() };
}, event);
const newId = (p) => p.evaluate(() => newId());
/** Wait until an action this page recorded has been confirmed by the server (or taken back). */
const settled = (p, id) => p.waitForFunction((id) => { const e = EV.find((x) => x.id === id); return !e || !e.pending; }, id);

(async () => {
  const b = await chromium.launch();
  // Sam's browser still holds two actions from before 2.0.
  const sam = await signIn(b, 'sam@hillpointe.com', () => {
    if (!localStorage.getItem('penny.sandbox.v1')) localStorage.setItem('penny.sandbox.v1', JSON.stringify({ version: 1, events: [
      { id: 'aaaaaaaaaaaaaaaa', at: '2026-10-30T15:00:00.000Z', type: 'note.add', doc: 'APINBOX_0002', note: 'Called the vendor about the PO.', user: { id: 'sam', name: 'Sam Rivera', role: 'admin', initials: 'SR' } },
      { id: 'bbbbbbbbbbbbbbbb', at: '2026-10-30T15:05:00.000Z', type: 'rules.update', changes: [{ path: 'thresholds.overpo_tolerance', before: 500, after: 9999 }], note: 'An old test.', user: { id: 'sam', name: 'Sam Rivera', role: 'admin', initials: 'SR' } }] }));
  });

  // ---- moving a browser's earlier work
  await sam.waitForSelector('#dialog[open]');
  ok(/Move this browser's earlier work into Penny/.test(await text(sam, '#dialog')) && /2 actions/.test(await text(sam, '#dialog')), 'an Admin is offered to move the work this browser saved before 2.0');
  await sam.click('#dialog button[type=submit]');
  await sam.waitForSelector('text=Moved 2 actions into Penny');
  ok(await sam.evaluate(() => EV.some((e) => e.id === 'aaaaaaaaaaaaaaaa' && e.moved && e.moved_by.name === 'Sam Rivera' && e.at === '2026-10-30T15:00:00.000Z')), 'they are in the team log with their original time, marked as moved and by whom');
  ok(await sam.evaluate(() => S.rules.thresholds.overpo_tolerance) === 500, 'a moved rule change is history only: the rules Penny runs with did not change');
  ok(await sam.evaluate(() => !!localStorage.getItem('penny.sandbox.v1')), 'nothing was removed from the browser');

  const avery = await signIn(b, 'avery@hillpointe.com');
  const jordan = await signIn(b, 'jordan@hillpointe.com');
  ok(/Team/.test(await text(sam, '.demo-pill')) && await avery.evaluate(() => teamMode() && EV.some((e) => e.id === 'aaaaaaaaaaaaaaaa')), 'everyone is in team mode and sees the same audit log');
  ok(!(await avery.$('#dialog[open]')), 'only an Admin is offered the move');

  // ---- live updates: Avery resolves a hold with the real buttons, Sam is looking at the list
  const [h1, h2, h3] = await sam.evaluate(() => X.docs.filter(openHold).map((d) => d.id));
  await sam.goto(ACCOUNTS + '#/work'); await sam.waitForSelector(`tr[data-href*="${h1}"]`);
  await avery.goto(ACCOUNTS + '#/invoices/' + h1); await avery.waitForSelector('.record-nav');
  await avery.click('button:has-text("Resolve hold")'); await avery.waitForSelector('#dialog[open]');
  await avery.check('#dialog input[name=outcome][value=cleared]').catch(() => null);
  await avery.fill('#dlg-note', 'PO change order CO-12 approved by the project manager.');
  await avery.click('#dialog button[type=submit]');
  await sam.waitForFunction((id) => !document.querySelector(`#main tr[data-href*="${id}"]`), h1, { timeout: 15000 });
  ok(true, "Sam's work queue drops the hold on its own, with no reload");
  ok(/Avery Chen: resolved a hold/.test(await text(sam, '#toast')), 'and a short message says who did what');
  const held = await sam.evaluate((id) => ({ ...S.holds[id], seq: EV.find((e) => e.doc === id && e.type === 'hold.resolve').seq }), h1);
  ok(!!held.outcome && held.by.name === 'Avery Chen' && held.by.role === 'clerk' && held.seq > 0, 'the action carries the person and number the server gave it', held);
  ok(await avery.evaluate(() => localStorage.getItem('penny.sandbox.v1')) === null, "nothing is saved in Avery's browser: the server holds the team's work");

  // ---- two people cannot both resolve the same hold
  const [ida, ids] = [await newId(avery), await newId(sam)];
  await avery.goto(ACCOUNTS + '#/invoices/' + h2); await avery.waitForSelector('.record-nav');
  const both = await Promise.all([
    post(avery, { id: ida, type: 'hold.resolve', doc: h2, outcome: 'cleared', note: 'Avery clears it.' }),
    post(sam, { id: ids, type: 'hold.resolve', doc: h2, outcome: 'rejected', note: 'Sam rejects it.' })]);
  const codes = both.map((r) => r.status).sort();
  ok(codes[0] === 200 && codes[1] === 409 && /already resolved this hold/.test(both.find((r) => r.status === 409).body.error), 'when two people resolve the same hold at the same moment, one is saved and the other is told who got there first', both);
  // The same through the real page: Sam's screen is a moment behind, he resolves h3 after Avery already has.
  await post(avery, { id: await newId(avery), type: 'hold.resolve', doc: h3, outcome: 'cleared', note: 'Avery was first.' });
  const lateId = await sam.evaluate((id) => { S.holds[id] = {}; return record('hold.resolve', { doc: id, outcome: 'rejected', note: 'Sam was second.', before: 'On hold', after: 'Rejected' }).id; }, h3);
  await sam.waitForSelector('#dialog[open]');
  ok(/Penny did not save that/.test(await text(sam, '#dialog')) && /Avery Chen already resolved this hold/.test(await text(sam, '#dialog')), 'the late action is taken back off the screen with the reason');
  ok(await sam.evaluate(([id, late]) => S.holds[id].outcome === 'cleared' && !EV.some((e) => e.id === late), [h3, lateId]), "and Sam now sees Avery's decision");
  await sam.click('#dlg-cancel');

  // ---- the server decides who may do what
  const ready = await sam.evaluate(() => X.docs.find((d) => d.pennyStatus.startsWith('ENTER_') && approvalSteps(d).length).id);
  const step = await sam.evaluate((id) => approvalSteps(X.docById[id])[0].label, ready);
  let r = await post(avery, { id: await newId(avery), type: 'bill.approve', doc: ready, step, user: { id: 'x', name: 'Sam Rivera', role: 'admin' } });
  ok(r.status === 403 && /Only an Approver or Admin/.test(r.body.error), 'an AP Clerk cannot approve a bill, even by sending the request by hand and claiming to be an Admin');
  r = await post(avery, { id: await newId(avery), type: 'batch.run', batch: 'x', dry_run: false });
  ok(r.status === 400 && /records that itself/.test(r.body.error), 'a browser cannot claim a batch run happened');
  r = await post(jordan, { id: await newId(jordan), type: 'bill.approve', doc: ready, step, note: 'Looks right.' });
  ok(r.status === 200 && r.body.event.user.name === 'Jordan Patel' && r.body.event.user.role === 'approver', 'an Approver can, and the server stamps who and when');
  r = await post(sam, { id: await newId(sam), type: 'bill.approve', doc: ready, step });
  ok(r.status === 409 && /Jordan Patel already approved this step/.test(r.body.error), 'the same sign-off is not recorded twice');
  await sam.waitForFunction(([id, s]) => (S.approvals[id] || {})[s] && S.approvals[id][s].by.name === 'Jordan Patel', [ready, step]);
  ok(true, "Jordan's approval reaches Sam live");

  // ---- import history is checked on the server
  const file = await sam.evaluate(() => { const run = D.runs.find((x) => !x.dry_run && x.files.some((f) => f.name === 'intacct_bill_import.csv' && f.rows)); return { run: run.id, rows: run.files.find((f) => f.name === 'intacct_bill_import.csv').rows }; });
  const imp = { type: 'export.imported', run: file.run, file: 'intacct_bill_import.csv', ref: 'IMP-2026-2001' };
  r = await post(avery, { ...imp, id: await newId(avery), rows: file.rows - 1 });
  ok(r.status === 422 && /Do not mark this as imported/.test(r.body.error), 'a row count that does not match the real file is refused by the server');
  r = await post(avery, { ...imp, id: await newId(avery), rows: file.rows });
  ok(r.status === 200, 'the right row count is accepted');
  r = await post(avery, { id: await newId(avery), type: 'export.confirmed', run: file.run, file: imp.file });
  ok(r.status === 403, 'an AP Clerk cannot confirm an import');
  await post(sam, { id: await newId(sam), type: 'export.undo', run: file.run, file: imp.file, note: 'Testing the second person rule.' });
  await post(sam, { ...imp, id: await newId(sam), rows: file.rows });
  r = await post(sam, { id: await newId(sam), type: 'export.confirmed', run: file.run, file: imp.file });
  ok(r.status === 403 && /different person/.test(r.body.error), 'the person who imported a file cannot confirm it, even as an Admin');
  r = await post(jordan, { id: await newId(jordan), type: 'export.confirmed', run: file.run, file: imp.file });
  ok(r.status === 200, 'a different person can');
  await avery.goto(ACCOUNTS + '#/exports'); await avery.waitForSelector('.file-row');
  ok(/Confirmed\s*Jordan Patel/.test(await text(avery, `.file-row:has([data-dl="${imp.file}"][data-run="${file.run}"])`)), 'and Avery sees it on the Exports page');

  // ---- rule changes are the rules Penny runs with
  const rulesFile = path.join(LAB, 'accounts', 'rules.json');
  await avery.goto(ACCOUNTS + '#/rules'); await avery.waitForTimeout(300);
  const ruleId = await sam.evaluate(() => record('rules.update', { changes: [{ path: 'thresholds.overpo_tolerance', before: 500, after: 750, label: 'PO overage tolerance' }], note: 'Agreed with Supply Chain.' }).id);
  await settled(sam, ruleId);
  ok(JSON.parse(fs.readFileSync(rulesFile, 'utf8')).thresholds.overpo_tolerance === 750, "a rule change from the web app is written to the server's rules file");
  ok(fs.readdirSync(path.join(LAB, 'accounts', 'state', 'rules_history')).length >= 1, 'and the file as it was before is kept');
  await avery.waitForFunction(() => S.rules.thresholds.overpo_tolerance === 750);
  ok(true, 'Avery sees the new rule without reloading');
  r = await post(sam, { id: await newId(sam), type: 'rules.update', changes: [{ path: 'thresholds.overpo_tolerance', before: 500, after: 900 }] });
  ok(r.status === 409 && /changed while you were working/.test(r.body.error) && JSON.parse(fs.readFileSync(rulesFile, 'utf8')).thresholds.overpo_tolerance === 750, 'a change made from an out-of-date value is refused, and the file is untouched');
  r = await post(sam, { id: await newId(sam), type: 'rules.update', changes: [{ path: 'thresholds.overpo_tolerance', before: 750, after: 'lots' }] });
  ok(r.status === 422, 'a rule cannot be changed to the wrong kind of value');
  r = await post(avery, { id: await newId(avery), type: 'rules.update', changes: [{ path: 'thresholds.overpo_tolerance', before: 750, after: 1 }] });
  ok(r.status === 403, 'only an Admin can change rules');
  const undoId = await sam.evaluate((id) => record('rules.revert', { target: id, note: 'Back to the policy value.' }).id, ruleId);
  await settled(sam, undoId);
  ok(JSON.parse(fs.readFileSync(rulesFile, 'utf8')).thresholds.overpo_tolerance === 500 && await sam.evaluate(() => S.rules.thresholds.overpo_tolerance) === 500, 'undoing a rule change puts the old value back on disk');

  // ---- typing is never interrupted; a reload shows the same picture; the audit trail has everyone
  await sam.goto(ACCOUNTS + '#/invoices/' + ready); await sam.waitForSelector('.record-nav');
  await sam.click('[data-act="note"]'); await sam.waitForSelector('#dialog[open]');
  await sam.fill('#dlg-note', 'Half-written note');
  await post(avery, { id: await newId(avery), type: 'note.add', doc: ready, note: 'Avery adds a note while Sam is typing.' });
  await sam.waitForSelector('#team-note:not([hidden])');
  ok(await sam.inputValue('#dlg-note') === 'Half-written note', 'a live update never wipes out what you are typing; Penny offers to show the changes instead');
  await sam.click('#dlg-cancel'); await sam.click('#team-note'); await sam.waitForTimeout(200);
  ok(/Avery adds a note while Sam is typing/.test(await text(sam, '#main')) || await sam.evaluate((id) => (S.notes[id] || []).some((n) => /while Sam is typing/.test(n.note)), ready), 'choosing it shows them');
  await sam.reload(); await sam.waitForSelector('#shell', { state: 'visible' });
  ok(await sam.evaluate(([a, c]) => S.holds[a].outcome === 'cleared' && S.holds[c].by.name === 'Avery Chen', [h1, h3]), 'after a reload the picture is the same, because it comes from the server');
  await sam.goto(ACCOUNTS + '#/audit?per=100'); await sam.waitForSelector('table.audit');
  const trail = await text(sam, 'table.audit tbody');
  ok(/Avery Chen/.test(trail) && /Jordan Patel/.test(trail) && /Sam Rivera/.test(trail) && /Changed rules/.test(trail) && /Confirmed an import/.test(trail), "one audit trail holds everyone's work");

  // ---- signed out, the server says nothing
  await sam.click('#user-btn'); await sam.click('#sign-out'); await sam.waitForSelector('#login-form');
  const anon = await sam.evaluate(async () => (await fetch('api/events?after=0')).status);
  ok(anon === 401, 'without a session the audit log is not readable');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
