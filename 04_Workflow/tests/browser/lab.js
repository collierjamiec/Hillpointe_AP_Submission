// Where the lab servers started by lab.py listen, and where screenshots go. Shared by every suite.
const fs = require('fs');
const os = require('os');
const path = require('path');

const LAB = process.env.PENNY_LAB_DIR || path.join(os.tmpdir(), 'penny-lab');
const SHOTS = path.join(process.env.PENNY_SHOTS || path.join(LAB, 'shots'), '/');
fs.mkdirSync(SHOTS, { recursive: true });

module.exports = {
  DEMO: 'http://127.0.0.1:8781/',            // the public site, exactly as GitHub Pages serves it
  ACCOUNTS: 'http://127.0.0.1:8782/',        // Penny on a computer with real accounts (Admin: sam@hillpointe.com)
  UPDATES_SITE: 'http://127.0.0.1:8783/',    // a second copy of the site whose release list the updates suite rewrites
  UPDATES_LOCAL: 'http://127.0.0.1:8784/',   // Penny on a computer that has been told a required update is out
  FULL: 'http://127.0.0.1:8785/',            // Penny on a computer with the assessment package (only when it is present)
  UPDATES_RELEASES: path.join(LAB, 'updates-site', 'data', 'releases.json'),
  VERSION: fs.readFileSync(path.join(__dirname, '..', '..', 'VERSION'), 'utf8').trim(),
  SHOTS,
};
