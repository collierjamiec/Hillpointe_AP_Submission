// Export history: Created, Downloaded, Imported, Confirmed. A row count that does not match is refused, a second
// person confirms, a file that is already imported warns before it is downloaded again, and previews cannot be imported.
const { chromium } = require('playwright');
const { DEMO, SHOTS: S } = require('./lab.js');
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const errors = [];
const RUN = 'run1_batch01', FILE = 'intacct_bill_import.csv';
const row = `.file-row:has([data-dl="${FILE}"][data-run="${RUN}"])`;
const text = async (p, sel) => ((await p.textContent(sel)) || '').replace(/\s+/g, ' ');
async function signIn(p, email) {
  await p.goto(DEMO); await p.waitForSelector('.role-card');
  await p.click(`.role-card[data-email="${email}"]`); await p.waitForSelector('#shell', { state: 'visible' });
  await p.goto(DEMO + '#/exports'); await p.waitForSelector(row);
}
async function signOut(p) { await p.click('#user-btn'); await p.click('#sign-out'); await p.waitForSelector('.role-card'); }
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await signIn(p, 'avery@penny.demo');
  const rows = await p.evaluate(([r, f]) => D.runs.find((x) => x.id === r).files.find((x) => x.name === f).rows, [RUN, FILE]);
  let t = await text(p, row);
  ok(/Created\s*by Penny/.test(t) && /Downloaded\s*Not yet/.test(t) && /File fingerprint/.test(t), 'a new import file shows Created, and nothing after it yet');
  ok(/This was a preview/.test(await text(p, '#main')) && /This file is empty/.test(await text(p, '#main')), 'previews and empty files say they are not for import');
  ok(!(await p.$('.file-row:has([data-dl="review_workbook.xlsx"]) .ex-history')), 'review files have no import history');

  const [dl] = await Promise.all([p.waitForEvent('download'), p.click(`${row} a[data-dl]`)]);
  await dl.cancel().catch(() => null);
  await p.waitForTimeout(300);
  ok(/Downloaded\s*Avery Chen/.test(await text(p, row)), 'the download is noted with who and when');

  await p.click(`${row} [data-ex="imported"]`);
  await p.fill('#dlg-ref', 'IMP-2026-1107'); await p.fill('#dlg-rows', String(rows - 1));
  await p.click('#dialog button[type=submit]'); await p.waitForTimeout(200);
  ok(/do not mark this as imported/.test(await text(p, '#dlg-error')), 'a row count that does not match the file is refused');
  await p.fill('#dlg-rows', String(rows)); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(300);
  t = await text(p, row);
  ok(/Imported into Sage Intacct\s*Avery Chen/.test(t) && /reference IMP-2026-1107/.test(t) && /Waiting for a different person/.test(t), 'imported is recorded with the reference, and waits for a second person');
  ok(!(await p.$(`${row} [data-ex="confirmed"]`)), 'the person who imported it cannot confirm it');
  await p.screenshot({ path: S + 'export-history.png' });

  await p.click(`${row} a[data-dl]`); await p.waitForTimeout(300);
  ok(/already imported/.test(await text(p, '#dialog')) && /duplicate bills/.test(await text(p, '#dialog')), 'downloading an imported file warns about importing twice');
  await p.click('#dlg-cancel');

  const doc = await p.evaluate((r) => X.docs.find((d) => d.pennyStatus === 'ENTER_INTACCT' && d.cur.run_id === r).id, RUN);
  await p.goto(DEMO + '#/invoices/' + doc); await p.waitForTimeout(400);
  ok(/Import recorded/.test(await text(p, '.status-strip')) && /Ready for Intacct import/.test(await text(p, '.status-strip')), 'a bill in that file shows Import recorded (still not posted or paid)');
  await signOut(p);

  await signIn(p, 'jordan@penny.demo');
  ok(!(await p.$(`${row} [data-ex="imported"]`)) && !!(await p.$(`${row} [data-ex="confirmed"]`)), 'an Approver can confirm but not mark as imported');
  await p.click(`${row} [data-ex="confirmed"]`); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(200);
  ok(/Check it in Sage Intacct first/.test(await text(p, '#dlg-error')), 'confirming needs the box ticked');
  await p.check('#dialog input[name=seen]'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(300);
  ok(/Confirmed\s*Jordan Patel/.test(await text(p, row)), 'a different person confirms the import');
  await p.goto(DEMO + '#/audit'); await p.waitForTimeout(400);
  t = await text(p, 'table.audit tbody');
  ok(/Confirmed an import/.test(t) && /Marked a file as imported/.test(t) && /Downloaded a file/.test(t) && /IMP-2026-1107/.test(t), 'every step is in the audit trail');
  await signOut(p);

  await signIn(p, 'sam@penny.demo');
  await p.click(`${row} [data-ex="undo"]`); await p.fill('#dlg-note', 'Intacct reversed the batch after a vendor ID error.'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(300);
  t = await text(p, row);
  ok(/Imported into Sage Intacct\s*Not yet/.test(t) && !!(await p.$(`${row} [data-ex="imported"]`)), 'Mark as not imported puts it back, with a reason');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'fits a phone');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
