// Suggested fixes that learn, the bank-change guardrail, and the Insights page.
const { chromium } = require('playwright');
const { session, BASE } = require('./session.js');
const ok = (c, m) => { if (!c) throw new Error('ASSERT ' + m); };
(async () => {
  const out = require('./lab.js').SHOTS; const b = await chromium.launch(); const log = [];
  const p = await session(b, 'avery@penny.demo');
  // 1. playbook suggestion on an over-PO hold, apply, then undo from the toast
  await p.goto(BASE + '#/invoices/APINBOX_0001'); await p.waitForTimeout(500);
  ok(await p.isVisible('.suggest'), 'suggestion card'); log.push('0001 suggestion: ' + (await p.textContent('.suggest-list li')).replace(/\s+/g, ' ').trim().slice(0, 140));
  await p.screenshot({ path: `${out}/94-suggest.png` });
  await p.click('[data-apply="APINBOX_0001"][data-n="0"]'); await p.waitForTimeout(300);
  ok((await p.textContent('.inv-title .badge')).includes('Cleared'), 'applied');
  await p.click('.toast-btn'); await p.waitForTimeout(300);
  ok((await p.textContent('.inv-title .badge')).includes('Needs review'), 'undone');
  // 2. resolve T2 (over PO, another vendor) by hand with a custom note
  await p.goto(BASE + '#/invoices/T2_over_po_inside_tolerance'); await p.waitForTimeout(400);
  await p.click('[data-act=resolve]'); await p.fill('#dlg-note', 'Supply Chain extended the PO by $3,000 per CO-77.'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(300);
  // 3. back on 0001, Penny now suggests the learned note first
  await p.goto(BASE + '#/invoices/APINBOX_0001'); await p.waitForTimeout(400);
  const first = (await p.textContent('.suggest-list li')).replace(/\s+/g, ' ');
  ok(first.includes('CO-77') && first.includes('Learned from 1 past resolution'), 'learned ranks first: ' + first); log.push('after learning: ' + first.trim().slice(0, 160));
  // 4. bank change guardrail
  await p.goto(BASE + '#/invoices/APINBOX_0006'); await p.waitForTimeout(400);
  ok((await p.textContent('[data-apply="APINBOX_0006"]')).includes('Review'), 'guarded label');
  await p.click('[data-apply="APINBOX_0006"]'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(150);
  ok((await p.textContent('#dlg-error')).includes('Treasury'), 'confirmation required');
  await p.check('#dialog input[name=confirm]'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(300);
  ok((await p.textContent('.inv-title .badge')).includes('Cleared'), 'guarded cleared after confirm');
  // 5. one-click apply from My work
  await p.goto(BASE + '#/work'); await p.waitForTimeout(400);
  const before = await p.$$eval('[data-apply]', x => x.length);
  await p.click('.suggest-inline [data-apply]'); await p.waitForTimeout(400);
  const after = await p.$$eval('[data-apply]', x => x.length); ok(after === before - 1, `queue shrank ${before}->${after}`);
  await p.screenshot({ path: `${out}/95-work-inline.png` });
  log.push('avery errors: ' + (p.errs.join(' | ') || 'none'));
  // 6. insights for the admin in the same browser
  const ctx = p.context();
  await p.click('#user-btn'); await p.click('#sign-out'); await p.waitForTimeout(300);
  await p.click('.role-card[data-email="sam@penny.demo"]'); await p.waitForFunction(() => !document.getElementById('shell').hidden); await p.waitForTimeout(300);
  await p.fill('#search', 'zzznothing'); await p.waitForTimeout(1500);
  await p.goto(BASE + '#/insights'); await p.waitForTimeout(500);
  const kpis = (await p.textContent('.kpis')).replace(/\s+/g, ' '); log.push('insights: ' + kpis.trim().slice(0, 220));
  const sig = (await p.textContent('.notes')).replace(/\s+/g, ' '); log.push('signals: ' + sig.trim().slice(0, 300));
  await p.screenshot({ path: `${out}/96-insights.png`, fullPage: true });
  log.push('sam errors: ' + (p.errs.join(' | ') || 'none'));
  console.log(log.join('\n')); await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
