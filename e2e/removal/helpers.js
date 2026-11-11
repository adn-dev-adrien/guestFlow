// Shared by the removal suites (specs/plugin-removal-resilience.md rules 8-17).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.E2E_REMOVAL_PORT || 4400);
const WORK = process.env.REMOVAL_WORK;
const CONTROL = `http://127.0.0.1:${PORT + 1}`;
const Database = require(path.join(ROOT, 'server', 'node_modules', 'better-sqlite3'));

const seed = () => JSON.parse(fs.readFileSync(path.join(WORK, 'seed.json'), 'utf8'));
const reference = () => JSON.parse(fs.readFileSync(path.join(WORK, 'reference.json'), 'utf8'));
const removed = () => (process.env.REMOVED_PLUGINS || '').split(',').filter(Boolean);

// The pages the core owns (specs/plugins-phase-0-foundation.md rule 28's list).
const CORE_PAGES = ['/', '/calendar', '/planning', '/clients', '/devis', '/emails', '/emails/historique',
  '/finance', '/finance/tourist-tax', '/options', '/parametres/options-ressources', '/parametres/vacances-fermetures',
  '/parametres/conditions-generales', '/properties', '/reservations/new', '/reservations/upcoming', '/settings',
  '/settings/emails', '/settings/emails/textes', '/settings/etablissement', '/settings/plateformes',
  '/settings/systeme', '/settings/tva-exercice', '/settings/utilisateurs', '/mon-compte'];

/** Counts the rows of `tables` straight from the database file, read only. */
function countRows(tables) {
  const db = new Database(path.join(WORK, 'removal.db'), { readonly: true });
  try {
    return Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
  } finally {
    db.close();
  }
}

const control = {
  restart: async (request) => { await request.post(`${CONTROL}/__control/restart`); },
  passes: async (request) => (await request.post(`${CONTROL}/__control/passes`)).json(),
  log: async (request) => (await (await request.get(`${CONTROL}/__control/log`)).json()).output,
};

async function waitForRestart(request, before) {
  for (let i = 0; i < 240; i += 1) {
    try {
      const v = await (await request.get('/api/version', { timeout: 2000 })).json();
      if (v.startedAt && v.startedAt !== before) return;
    } catch { /* restarting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('the server did not come back');
}

async function restart(request) {
  const before = (await (await request.get('/api/version')).json()).startedAt;
  await control.restart(request);
  await waitForRestart(request, before);
}

module.exports = { ROOT, PORT, WORK, seed, reference, removed, CORE_PAGES, countRows, control, restart };
