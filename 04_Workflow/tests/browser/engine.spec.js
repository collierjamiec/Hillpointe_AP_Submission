// Needs the assessment package (FULL lab): blockers, recheck, manual entry with a second check, a real run, the rule simulator.
const { chromium } = require('playwright');
const { DEMO, ACCOUNTS, UPDATES_SITE, UPDATES_LOCAL, FULL, SHOTS: S, UPDATES_RELEASES, VERSION } = require('./lab.js');

const BASE = FULL;
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const errors = [];
// A real 1x1 PNG, then padded so each "screenshot" has its own fingerprint.
const png = (tag) => Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a3e5d0a20000000049454e44ae426082', 'hex'), Buffer.from(tag)]);
const text = async (p, sel = '#main') => (await p.textContent(sel)).replace(/\s+/g, ' ');
async function signIn(b, email, ctxOpts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, ...ctxOpts });
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${email}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errors.push(`${email} console: ${m.text()}`));
  await p.goto(BASE);
  await p.waitForSelector('.role-card');
  await p.click(`.role-card[data-email="${email}"]`);
  await p.waitForSelector('#shell', { state: 'visible' });
  return { ctx, p };
}
async function switchUser(p, email) {
  await p.click('#user-btn'); await p.click('#sign-out');
  await p.waitForSelector('.role-card');
  await p.click(`.role-card[data-email="${email}"]`);
  await p.waitForSelector('#shell', { state: 'visible' });
}
async function submitDialog(p) { await p.click('#dialog button[type=submit]'); await p.waitForTimeout(350); }
const go = async (p, hash) => { await p.goto(BASE + hash); await p.waitForTimeout(500); };

(async () => {
  const b = await chromium.launch();
  const { ctx, p } = await signIn(b, 'avery@penny.demo');

  // ---------------------------------------------------------------- blockers
  await go(p, '#/invoices/APINBOX_0001');
  let t = await text(p);
  ok(/Blockers\s*0 of 1 cleared/.test(t), 'blockers card shows 0 of 1');
  await p.click('[data-act="blocker"][data-code="OVERPO"]');
  await p.selectOption('#dlg-status', 'waiting');
  const yesterday = new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10);
  await p.fill('#dlg-due', yesterday);
  await p.fill('#dlg-note', 'Asked the PM for a PO change order.');
  await p.setInputFiles('#dlg-files', { name: 'po-request.png', mimeType: 'image/png', buffer: png('a') });
  await p.waitForTimeout(400);
  ok(/fingerprint/.test(await text(p, '#dlg-file-list')), 'attached file is checked and fingerprinted');
  await submitDialog(p);
  t = await text(p);
  ok(/Waiting for evidence/.test(t) && /overdue/.test(t) && /po-request\.png/.test(t), 'blocker shows status, overdue target and the file');
  await go(p, '#/work');
  const firstRow = (await p.$$eval('#main tbody tr', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' '))))[0];
  ok(/Pinecrest/.test(firstRow) && /Blocker .*overdue/.test(firstRow), 'My work puts the overdue blocker first and says why');
  await p.screenshot({ path: S + 'v15-work.png' });
  await go(p, '#/work?tab=holds&order=team');
  ok(/Most urgent/.test(await text(p)) && (await p.$$('.team-head')).length > 1, 'By team view still available');

  // clear it as Avery with a note
  await go(p, '#/invoices/APINBOX_0001');
  await p.click('[data-act="blocker-clear"][data-code="OVERPO"]');
  await p.fill('#dlg-note', 'PM approved change order CO-14 for the overage.');
  await submitDialog(p);
  t = await text(p);
  ok(/1 of 1 cleared/.test(t) && /Verified by\s*Avery Chen/.test(t) && /All blockers are cleared/.test(t), 'cleared blocker records the verifier');

  // ---------------------------------------------------------------- recheck (same reading)
  await p.click('[data-act="recheck"]');
  await submitDialog(p);
  await p.waitForSelector('#rc-h', { timeout: 15000 });
  t = await text(p);
  ok(/Recheck preview/.test(t) && /No change/.test(t) && /Register/.test(t) && /a copy; not changed/.test(t), 'recheck preview shows before/after and versions');
  await p.screenshot({ path: S + 'v15-recheck.png', fullPage: true });

  // ---------------------------------------------------------------- manual entry under the limit (T5)
  await go(p, '#/invoices/T5_unfamiliar_layout');
  ok(/Can you open this file in another program/.test(await text(p)), 'unreadable-layout invoice offers manual entry');
  await go(p, '#/invoices/T5_unfamiliar_layout/manual');
  await p.setInputFiles('#m-files', { name: 'T5 screenshot.png', mimeType: 'image/png', buffer: png('t5') });
  await p.waitForTimeout(500);
  ok(!!(await p.$('#m-preview img')), 'screenshot preview shows beside the form');
  await p.fill('#m-vendor_name', 'Pinecrest Building Supply Co');
  await p.fill('#m-invoice_no', 'PBS-910005');
  await p.fill('#m-date', '2026-10-28');
  await p.selectOption('#m-terms', 'Net 30');
  await p.fill('#m-bill_to', 'Hillpointe Construction, LLC');
  await p.fill('#m-ship_to', 'Pointe Grand Columbia, Bldg 4');
  await p.fill('[data-lf="desc"][data-i="0"]', '2x4x8 framing lumber, kiln dried');
  await p.fill('[data-lf="qty"][data-i="0"]', '150');
  await p.fill('[data-lf="rate"][data-i="0"]', '4.00');
  await p.click('[data-m-line-add]');
  await p.fill('[data-lf="desc"][data-i="1"]', '2x6x10 framing lumber, treated');
  await p.fill('[data-lf="qty"][data-i="1"]', '40');
  await p.fill('[data-lf="rate"][data-i="1"]', '8.50');
  await p.waitForTimeout(200);
  ok((await p.inputValue('#m-subtotal')) === '940.00' && (await p.inputValue('#m-total')) === '940.00', 'amounts, subtotal and total fill in as you type');
  ok(/same as the subtotal/.test(await text(p, '#m-tie')) && /same as the total/.test(await text(p, '#m-tie')), 'tie-out shows green');
  await p.click('#m-save');
  ok(/Fix this before saving/.test(await text(p)) && /why this invoice is keyed by hand/.test(await text(p)), 'saving without a reason lists what to fix');
  await p.fill('#m-reason', 'Statement layout Penny cannot read; keyed from the PDF opened in Preview.');
  await p.click('#m-save');
  await p.waitForTimeout(400);
  t = await text(p);
  ok(/Manual entry ready/.test(t) && /Not needed under \$2,500/.test(t), 'under the limit: ready without a second check');
  await p.screenshot({ path: S + 'v15-manual-ready.png', fullPage: true });
  await p.click('#m-penny');
  await p.waitForSelector('#rc-h', { timeout: 15000 });
  t = await text(p);
  ok(/Penny would pass the keyed invoice/.test(t) && /read by a person \(manual entry\)/.test(t), 'Penny checks the keyed invoice and passes it');
  await p.click('#m-store');
  await p.waitForSelector('text=Saved to', { timeout: 15000 });
  t = await text(p);
  ok(/Manual entry saved for the next run/.test(t) && /inbox\/\d{4}-\d{2}-\d{2}_manual-t5-unfamiliar-layout/.test(t), 'saved to an inbox batch folder');

  // ---------------------------------------------------------------- maker-checker over the limit (T6)
  await go(p, '#/invoices/T6_scanned_picture_only/manual');
  await p.setInputFiles('#m-files', { name: 'T6 scan.png', mimeType: 'image/png', buffer: png('t6') });
  await p.fill('#m-vendor_name', 'Pinecrest Building Supply Co');
  await p.fill('#m-invoice_no', 'PBS-920001');
  await p.fill('#m-date', '2026-10-30');
  await p.fill('#m-bill_to', 'Hillpointe Construction, LLC');
  await p.fill('#m-customer_ref', 'PO2410315-008');
  await p.fill('[data-lf="desc"][data-i="0"]', 'Lumber package');
  await p.fill('[data-lf="amount"][data-i="0"]', '9000.00');
  await p.waitForTimeout(150);
  ok(/a second person will key/.test(await text(p, '#m-tie')), 'over the limit the form says a second check is needed');
  await p.fill('#m-reason', 'Scanned picture; keyed from the image.');
  await p.click('#m-save');
  await p.waitForTimeout(400);
  ok(/Waiting for a second check/.test(await text(p)), 'maker sees waiting for a second check');
  ok(!(await p.$('#m-check')), 'the maker cannot check their own entry');
  await switchUser(p, 'sam@penny.demo');
  await go(p, '#/invoices/T6_scanned_picture_only/manual');
  t = await text(p);
  ok(/Second check: key it again/.test(t) && !/PBS-920001/.test(t), 'checker sees a blind form, not the first entry');
  await p.fill('#mc-no', 'PBS-920001'); await p.fill('#mc-total', '900.00');
  await p.click('#m-check button[type=submit]'); await p.waitForTimeout(400);
  ok(/did not match/.test(await text(p)), 'a wrong total is caught');
  await p.fill('#mc-no', 'pbs 920001'); await p.fill('#mc-total', '9,000.00');
  await p.click('#m-check button[type=submit]'); await p.waitForTimeout(400);
  t = await text(p);
  ok(/Manual entry ready/.test(t) && /Both matched/.test(t), 'a matching second check makes it ready');

  // ---------------------------------------------------------------- Admin runs the saved manual entry
  await go(p, '#/batch');
  await p.waitForSelector('[data-wait-run]', { timeout: 10000 });
  t = await text(p);
  ok(/manual-t5-unfamiliar-layout/.test(t) && /1 manual entry/.test(t) && /1 evidence file/.test(t), 'New batch lists the waiting manual-entry batch');
  await p.click('[data-wait-run][data-real="1"]');
  await p.waitForSelector('text=Run finished', { timeout: 30000 });
  await go(p, '#/invoices/T5_unfamiliar_layout');
  t = await text(p);
  ok(/Ready for Intacct import/.test(t) && /Keyed by hand/.test(t) && /Avery Chen keyed this invoice/.test(t), 'after the real run the invoice is ready and marked keyed by hand');
  await p.screenshot({ path: S + 'v15-keyed-invoice.png' });

  // ---------------------------------------------------------------- rule simulator
  await go(p, '#/rules');
  await p.fill('#in-overpo_tolerance', '1000000');
  await p.waitForTimeout(200);
  await p.click('#rules-sim');
  await p.waitForSelector('.sim-list, .rc-verdict', { timeout: 30000 });
  t = await text(p, '#dialog');
  ok(/would change/.test(t) && /Pinecrest/.test(t), 'simulator lists the documents a higher tolerance would change');
  await p.screenshot({ path: S + 'v15-sim.png' });
  await p.click('#dlg-cancel');
  await p.click('#rules-discard');

  // ---------------------------------------------------------------- audit trail
  await go(p, '#/audit');
  t = await text(p);
  for (const label of ['Rechecked an invoice (preview)', 'Saved a manual entry for the next run', 'Checked a manual entry', 'Keyed an invoice by hand', 'Cleared a blocker', 'Updated a blocker']) ok(t.includes(label), `audit trail has: ${label}`);
  const rowsText = await text(p, 'table.audit tbody');
  ok((rowsText.match(/Saved a manual entry for the next run/g) || []).length === 1, 'the manual save is listed once (browser and disk entries merged)');

  // phone width
  await p.setViewportSize({ width: 390, height: 844 });
  for (const h of ['#/invoices/T6_scanned_picture_only/manual', '#/invoices/APINBOX_0001', '#/work', '#/batch']) {
    await go(p, h);
    const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    ok(!over, `no sideways scroll at phone width: ${h}`);
  }
  await go(p, '#/invoices/T6_scanned_picture_only/manual');
  await p.screenshot({ path: S + 'v15-manual-phone.png', fullPage: true });
  await ctx.close();

  // ---------------------------------------------------------------- viewer is read-only
  const v = await signIn(b, 'riley@penny.demo');
  await go(v.p, '#/invoices/APINBOX_0001');
  ok(!(await v.p.$('[data-act="blocker"]')) && !(await v.p.$('[data-act="recheck"]')), 'viewer has no blocker or recheck buttons');
  await v.ctx.close();

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
