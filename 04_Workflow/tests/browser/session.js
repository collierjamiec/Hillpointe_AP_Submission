// Sign in to the public demo as one of the four demo accounts.
const { chromium } = require('playwright');
const { DEMO: BASE } = require('./lab.js');
async function session(b, email, opts = {}) {
  const ctx = await b.newContext({ viewport: opts.vp || { width: 1440, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light' });
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', e => p.errs.push('pageerror ' + e.message));
  p.on('console', m => m.type() === 'error' && p.errs.push('console ' + m.text()));
  await ctx.addInitScript(() => sessionStorage.setItem('penny.introSeen', '1'));
  await p.goto(BASE); await p.waitForSelector('.role-card');
  if (email) { await p.click(`.role-card[data-email="${email}"]`); await p.waitForFunction(() => document.getElementById('user-name').textContent && !document.getElementById('shell').hidden); await p.waitForTimeout(400); }
  return p;
}
module.exports = { session, BASE };
