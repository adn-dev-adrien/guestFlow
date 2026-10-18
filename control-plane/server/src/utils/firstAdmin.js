/**
 * Creates the customer's first administrator inside their instance (rule 7). The console never
 * writes an instance's schema itself: it runs the instance's own script,
 * `server/scripts/create-first-admin.js`, against that instance's database, and reads back the
 * temporary password it prints. The password is only passed on to the invitation email.
 */

const { execFile } = require('child_process');
const path = require('path');
const { GF_SERVER } = require('./gf');

function createFirstAdminRunner({ serverDir = GF_SERVER } = {}) {
  // `release` — the server directory of the instance's own version (specs/hosting-h1-fleet-runtime.md
  // H-D4): the script must be the one of the code that runs the database.
  // `company`, `establishment` and `reissue` (specs/hosting-h1-fleet-runtime.md rules 24–25): a
  // script of an older release ignores them.
  return function runFirstAdmin({ dbPath, email, name, company, establishment, reissue, serverDir: release }) {
    const dir = release || serverDir;
    const args = [path.join(dir, 'scripts', 'create-first-admin.js'), '--email', email, '--name', name || ''];
    if (company) args.push('--company', company);
    if (establishment) args.push('--establishment', JSON.stringify(establishment));
    if (reissue && reissue !== 'never') args.push('--reissue', reissue);
    return new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        args,
        { cwd: dir, env: { PATH: process.env.PATH, DB_PATH: dbPath }, timeout: 60000 },
        (err, stdout, stderr) => {
          if (err) return reject(new Error((stderr || err.message).trim().split('\n').pop()));
          try {
            const lines = String(stdout).trim().split('\n');
            resolve(JSON.parse(lines[lines.length - 1]));
          } catch {
            reject(new Error('Réponse illisible du script de l’instance.'));
          }
        },
      );
    });
  };
}

module.exports = { createFirstAdminRunner };
