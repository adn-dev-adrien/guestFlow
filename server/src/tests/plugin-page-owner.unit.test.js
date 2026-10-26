// specs/plugins-phase-p-productisation.md rule 40 — the address of a page whose plugin is not active
// is answered with that plugin's name, so the client says « module inactif » instead of « Page
// introuvable »; the server's list follows every plugin's `contributes.routes`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { PLUGIN_PAGES, pluginsOfPage, PLUGIN_IDS } = require('../constants/plugins');
const { ensurePluginsTable } = require('../utils/pluginsSchema');
const pluginsModel = require('../models/pluginsModel');
const { createController } = require('../controllers/pluginsController');

function controller() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE migrations (name TEXT PRIMARY KEY, ran_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE payment_links (id INTEGER PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE users (id INTEGER PRIMARY KEY, isActive INTEGER DEFAULT 1);
    CREATE TABLE user_roles (userId INTEGER, role TEXT, PRIMARY KEY (userId, role));
  `);
  ensurePluginsTable(db);
  return { db, ctrl: createController(pluginsModel.buildModel(db)) };
}

function ask(ctrl, pagePath) {
  let body;
  ctrl.pageOwner({ query: { path: pagePath } }, { json: (b) => { body = b; return this; } });
  return body;
}

test('rule 40: a plugin page, and the pages below it, name their plugin', () => {
  assert.deepEqual(pluginsOfPage('/comptabilite'), ['accounting-export']);
  assert.deepEqual(pluginsOfPage('/comptabilite/plateformes?x=1'), ['accounting-export']);
  assert.deepEqual(pluginsOfPage('/resource-planning/'), ['hourly-resources']);
  assert.deepEqual(pluginsOfPage('/comptabilites'), []);
  assert.deepEqual(pluginsOfPage('/nulle-part'), []);
  assert.deepEqual(pluginsOfPage(undefined), []);
});

test('rule 40: the answer carries the plugin name, its state and the sentence to show', () => {
  const { db, ctrl } = controller();
  const one = ask(ctrl, '/comptabilite');
  assert.deepEqual(one.plugins.map((p) => [p.id, p.state]), [['accounting-export', 'available']]);
  assert.equal(one.message, 'Cette page dépend du plugin «\u00a0Export comptable\u00a0», qui n’est pas activé.');
  const many = ask(ctrl, '/settings/integrations');
  assert.equal(many.plugins.length, 8);
  assert.equal(many.message, 'Cette page dépend de plugins qui ne sont pas activés.');
  assert.deepEqual(ask(ctrl, '/nulle-part'), { plugins: [], message: null });
  db.close();
});

test('rule 40: every page a plugin contributes is in the server list, under that plugin', () => {
  const root = path.join(__dirname, '..', '..', '..', 'client', 'src', 'plugins');
  let seen = 0;
  for (const id of PLUGIN_IDS) {
    const file = ['index.js', 'index.jsx'].map((f) => path.join(root, id, f)).find((f) => fs.existsSync(f));
    if (!file) continue;
    // A route is the `{ path, Component }` of `contributes.routes`; a menu entry has no Component.
    const pages = [...fs.readFileSync(file, 'utf8').matchAll(/path:\s*'([^']+)',\s*Component:/g)].map((m) => m[1]);
    pages.forEach((page) => { seen += 1; assert.ok(pluginsOfPage(page).includes(id), `${id} → ${page}`); });
  }
  assert.ok(seen >= 7, `routes read: ${seen}`);
  for (const ids of Object.values(PLUGIN_PAGES)) ids.forEach((id) => assert.ok(PLUGIN_IDS.includes(id), id));
});

// Rule 42 (review of 2026-10-18) — « n'est pas activé » is said only of a plugin that is not active.
test('rule 42: an active plugin answers like a core page; an installed, disabled one is named', () => {
  const { db, ctrl } = controller();
  const model = pluginsModel.buildModel(db);
  model.install('accounting-export');
  assert.deepEqual(ask(ctrl, '/comptabilite/zzz'), { plugins: [], message: null });
  assert.deepEqual(ask(ctrl, '/comptabilite'), { plugins: [], message: null });
  model.setEnabled('accounting-export', false);
  const off = ask(ctrl, '/comptabilite');
  assert.deepEqual(off.plugins.map((p) => [p.id, p.state]), [['accounting-export', 'inactive']]);
  assert.equal(off.message, 'Cette page dépend du plugin « Export comptable », qui n’est pas activé.');
  db.close();
});

test('rule 42: Intégrations is named while none of its eight plugins is active, and not after', () => {
  const { db, ctrl } = controller();
  assert.equal(ask(ctrl, '/settings/integrations').plugins.length, 8);
  pluginsModel.buildModel(db).install('google-calendar');
  assert.deepEqual(ask(ctrl, '/settings/integrations'), { plugins: [], message: null });
  db.close();
});
