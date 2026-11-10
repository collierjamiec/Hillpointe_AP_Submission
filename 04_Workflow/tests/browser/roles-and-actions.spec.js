// Roles and actions end to end: resolve, reassign, approve, rules with undo, reset, lockout, help search, viewer is read-only.
const { chromium } = require('playwright');
const { session, BASE } = require('./session.js');
const assert = (c, m) => { if (!c) { throw new Error('ASSERT: ' + m); } };
(async () => {
  const out = require('./lab.js').SHOTS; const b = await chromium.launch(); const log = [];
  const pages = ['#/', '#/work', '#/batch', '#/insights', '#/help/new-batch', '#/help/suggestions', '#/invoices', '#/exceptions', '#/exports', '#/runs', '#/runs/run1_batch01', '#/audit', '#/rules', '#/help', '#/help/codes', '#/help/glossary', '#/help/rules-ref', '#/invoices/APINBOX_0003?tab=coding', '#/invoices/T5_unfamiliar_layout'];
  // 1. every page, every role, desktop + phone, no errors, no sideways scroll
  for (const email of ['riley@penny.demo', 'avery@penny.demo', 'jordan@penny.demo', 'sam@penny.demo']) {
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const p = await session(b, email, { vp });
      for (const h of pages) {
        await p.goto(BASE + h); await p.waitForTimeout(150);
        const w = await p.evaluate(() => document.documentElement.scrollWidth);
        if (w > vp.width) log.push(`overflow ${w}px ${email} ${h}`);
      }
      if (p.errs.length) log.push(`${email} ${vp.width}: ${p.errs.join(' | ')}`);
      await p.context().close();
    }
  }
  log.push('pages checked: ' + pages.length * 8);
  // 2. clerk: resolve, reassign, note, reopen
  let p = await session(b, 'avery@penny.demo');
  await p.goto(BASE + '#/invoices/APINBOX_0001'); await p.waitForTimeout(300);
  await p.click('[data-act=resolve]'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(100);
  assert(!(await p.isHidden('#dlg-error')), 'short note rejected');
  await p.fill('#dlg-note', 'PM approved CO-14 for the overage.'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(300);
  assert((await p.textContent('.inv-title .badge')).includes('Cleared'), 'cleared badge');
  await p.goto(BASE + '#/invoices/APINBOX_0006'); await p.waitForTimeout(300);
  await p.click('[data-act=reassign]'); await p.selectOption('#dlg-team', 'AP Manager'); await p.fill('#dlg-note', 'Treasury asked AP Manager to confirm first.'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(300);
  assert((await p.textContent('.route strong')).includes('AP Manager'), 'reassigned route');
  await p.keyboard.press('n'); await p.waitForTimeout(150); await p.fill('#dlg-note', 'Called vendor, left a message.'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(200);
  await p.goto(BASE + '#/'); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/70-overview-after.png` });
  // keyboard: start reviewing then j
  await p.click('.att-head .btn'); await p.waitForTimeout(300); const first = location => location;
  const u1 = p.url(); await p.keyboard.press('j'); await p.waitForTimeout(300); assert(p.url() !== u1, 'j moves to next');
  await p.keyboard.press('?'); await p.waitForTimeout(150); assert(await p.isVisible('#dialog .keys'), 'shortcuts dialog'); await p.keyboard.press('Escape');
  // clerk cannot approve or edit rules
  await p.goto(BASE + '#/invoices/APINBOX_0003'); await p.waitForTimeout(300); assert(!(await p.$('[data-act=approve]')), 'clerk has no approve');
  await p.goto(BASE + '#/rules'); await p.waitForTimeout(200); assert(!(await p.$('input[data-path]')), 'clerk cannot edit rules');
  log.push('clerk errors: ' + (p.errs.join(' | ') || 'none')); await p.context().close();
  // 3. approver
  p = await session(b, 'jordan@penny.demo');
  await p.goto(BASE + '#/invoices/APINBOX_0003'); await p.waitForTimeout(300);
  await p.click('[data-act=approve]'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(300);
  await p.click('[data-act=approve]'); await p.click('#dialog input[value=sendback]'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(100);
  assert(!(await p.isHidden('#dlg-error')), 'send back needs note'); await p.fill('#dlg-note', 'Retainage line needs the signed waiver first.'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(300);
  assert((await p.textContent('.status-strip')).includes('Sent back'), 'sent back chip');
  await p.goto(BASE + '#/invoices/APINBOX_0003?tab=coding'); await p.waitForTimeout(400); await p.screenshot({ path: `${out}/71-approvals.png` });
  await p.context().close();
  // 4. admin: rules change with preview, save, undo
  p = await session(b, 'sam@penny.demo');
  await p.goto(BASE + '#/rules'); await p.waitForTimeout(300);
  await p.fill('#in-overpo_tolerance', '1500'); await p.waitForTimeout(200);
  const bar = await p.textContent('#edit-bar'); assert(bar.includes('would no longer be held') || bar.includes('lose its OVERPO'), 'preview shows release: ' + bar.slice(0, 200));
  await p.fill('#in-cfo_bill_over', '5000'); await p.waitForTimeout(200);
  await p.screenshot({ path: `${out}/72-rules-preview.png` });
  await p.click('#rules-save'); await p.fill('#dlg-note', 'Controller approved new limits for Q4.'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(300);
  assert((await p.inputValue('#in-overpo_tolerance')) === '1500', 'saved value');
  await p.click('[data-undo]'); await p.fill('#dlg-note', 'Rolled back pending review.'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(300);
  assert((await p.inputValue('#in-overpo_tolerance')) === '500', 'undo restored');
  await p.goto(BASE + '#/audit'); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/73-audit.png` });
  const rows = await p.$$eval('table.audit tbody tr', r => r.length); assert(rows === 8, 'audit rows ' + rows); log.push('admin audit rows (2 actions + 6 runs): ' + rows);
  // reset demo
  await p.click('#user-btn'); await p.click('#reset-demo'); await p.click('#dialog button[type=submit]'); await p.waitForTimeout(300);
  const left = await p.evaluate(() => JSON.parse(localStorage.getItem('penny.sandbox.v1') || '{"events":[]}').events.length); assert(left === 0, 'reset cleared');
  log.push('admin errors: ' + (p.errs.join(' | ') || 'none')); await p.context().close();
  // 5. lockout after 5 wrong passwords
  p = await session(b, null);
  for (let i = 0; i < 5; i++) { await p.fill('#login-email', 'sam@penny.demo'); await p.fill('#login-pw', 'wrong' + i); await p.click('#login-submit'); await p.waitForTimeout(450); }
  const lockMsg = await p.textContent('#login-error'); assert(lockMsg.includes('locked'), 'lockout: ' + lockMsg);
  await p.fill('#login-pw', 'penny-admin'); await p.click('#login-submit'); await p.waitForTimeout(450);
  assert((await p.textContent('#login-error')).includes('locked'), 'right password refused while locked');
  log.push('lockout ok: ' + lockMsg);
  // 6. help search
  await p.click('.role-card[data-email="riley@penny.demo"]'); await p.waitForFunction(() => !document.getElementById('shell').hidden);
  await p.goto(BASE + '#/help'); await p.waitForTimeout(200); await p.fill('#help-q', 'dry run'); await p.waitForTimeout(200);
  const hits = await p.$$eval('.help-card', c => c.length); assert(hits >= 1, 'help search hits'); log.push('help hits for "dry run": ' + hits);
  await p.screenshot({ path: `${out}/74-help-search.png` });
  await p.goto(BASE + '#/help/codes'); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/75-help-article.png` });
  // viewer cannot act
  await p.goto(BASE + '#/invoices/APINBOX_0001'); await p.waitForTimeout(200); assert(!(await p.$('[data-act]')), 'viewer has no actions');
  log.push('viewer errors: ' + (p.errs.join(' | ') || 'none'));
  console.log(log.join('\n')); await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
