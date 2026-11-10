// Security groundwork: nothing is loaded from another site, the content security policy is in force, and it blocks
// an injected inline script.
const { chromium } = require('playwright');
const { DEMO, ACCOUNTS } = require('./lab.js');
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  const p = await ctx.newPage();
  const outside = [], errors = [];
  p.on('request', (r) => { if (!r.url().startsWith(DEMO) && !/^(data|blob|about):/.test(r.url())) outside.push(r.url()); });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(DEMO); await p.waitForSelector('.role-card');
  await p.click('.role-card[data-email="sam@penny.demo"]'); await p.waitForSelector('#shell', { state: 'visible' });
  for (const h of ['#/', '#/invoices/APINBOX_0001', '#/rules', '#/appearance', '#/help/security']) { await p.goto(DEMO + h); await p.waitForTimeout(500); }
  ok(outside.length === 0, `no requests to other sites${outside.length ? ': ' + outside.slice(0, 3).join(', ') : ''}`);
  ok(await p.evaluate(() => document.fonts.check('16px Inter')), 'the bundled Inter font is in use');
  await p.goto(DEMO + '#/invoices/APINBOX_0001');
  const drew = await p.waitForSelector('.pdf-pages canvas', { timeout: 15000 }).then(() => true, () => false);
  ok(drew && errors.length === 0, 'pages work under the policy, and the PDF viewer draws the invoice');
  const blocked = await p.evaluate(() => new Promise((res) => {
    document.addEventListener('securitypolicyviolation', () => res(true), { once: true });
    const s = document.createElement('script'); s.textContent = 'window.__injected = 1'; document.body.appendChild(s);
    setTimeout(() => res(false), 500);
  }));
  ok(blocked && !(await p.evaluate(() => window.__injected)), 'an injected inline script is blocked');
  const res = await p.request.get(ACCOUNTS + 'api/status');
  const h = res.headers();
  ok(/script-src 'self'/.test(h['content-security-policy'] || '') && h['x-content-type-options'] === 'nosniff', 'the local server sends the security headers');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exitCode = fails || errors.length ? 1 : 0;
  await b.close();
})();
