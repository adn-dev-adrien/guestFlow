/**
 * Export comptable (specs/accountant-accounting-export.md; module per specs/plugins-phase-2-hosts.md
 * §3.E). The monthly sales journal and its CSV, the platform account plan, and the accountant's way
 * in. Nothing is stored as accounting: the journal is recomputed from core money data at every read.
 *
 * The cancellation compensations stay core (rule 21): their CRUD keeps its routes in
 * routes/accounting.js; the journal only reads them. The platform columns `commissionAccountNumber`
 * and `hasVatOnCommission` stay declared by the core (rule 20); only this plugin reads and writes them.
 */

const { create: createAccountingModel } = require('./accountingModel');
const { create: createAccountingController } = require('./controller');
const { create: createPlatformAccountsModel } = require('./platformAccountsModel');
const { create: createPlatformAccountsController } = require('./platformAccountsController');
const { PLUGIN_ID, KEYS, DEFAULTS, DECLARED, createAccountSettings } = require('./settings');

const id = PLUGIN_ID;

const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const tableColumns = (db, name) => new Set(db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name));

// Rules 19, 28 — the four settings used to be `app_settings` columns. Copied once, when the plugin
// key is still empty; empty values are skipped. The old columns stay in place, unread.
function copySettingsFromAppSettings(db) {
  if (!hasTable(db, 'app_settings') || !hasTable(db, 'plugin_settings')) return;
  const cols = tableColumns(db, 'app_settings');
  const keys = KEYS.filter((key) => cols.has(key));
  if (keys.length === 0) return;
  const row = db.prepare(`SELECT ${keys.join(', ')} FROM app_settings WHERE id = 1`).get();
  if (!row) return;
  const insert = db.prepare('INSERT OR IGNORE INTO plugin_settings (plugin_id, key, value) VALUES (?, ?, ?)');
  keys.forEach((key) => {
    const value = row[key];
    if (value === null || value === undefined || String(value) === '') return;
    insert.run(id, key, String(value));
  });
}

// Rule 22 — the platform rows that carry a commission account or a « TVA déductible » box.
function configuredPlatformCount(db) {
  if (!hasTable(db, 'platforms')) return 0;
  return db.prepare(`
    SELECT COUNT(*) AS n FROM platforms
    WHERE LOWER(name) != 'direct'
      AND ((commissionAccountNumber IS NOT NULL AND commissionAccountNumber != '') OR hasVatOnCommission = 1)
  `).get().n;
}

function register(ctx) {
  ctx.settings.declare(DECLARED);
  ctx.migrations([{ name: 'settings_from_app_settings_v1', up: copySettingsFromAppSettings }]);

  // Built on first use: the plugins register while the core is still booting.
  let controller = null;
  let platformAccounts = null;
  const getController = () => {
    if (!controller) controller = createAccountingController(createAccountingModel(ctx.db), { plan: () => createAccountSettings(ctx.db).read() });
    return controller;
  };
  const getPlatformAccounts = () => {
    if (!platformAccounts) platformAccounts = createPlatformAccountsController(createPlatformAccountsModel(ctx.db));
    return platformAccounts;
  };

  ctx.route('get', '/api/accounting/sales.csv', (req, res) => getController().salesCsv(req, res));
  ctx.route('get', '/api/accounting/sales', (req, res) => getController().salesJson(req, res));
  ctx.route('get', '/api/accounting/platforms', (req, res) => getController().platformsPreview(req, res));
  // accounting-platform-commission-and-no-deposit.md §3.7 + §4.3 — the Plan comptable page. The
  // refresh re-runs the platform rescan so a brand-new platform name surfaces without a restart.
  ctx.route('get', '/api/accounting/platform-accounts', (req, res) => getPlatformAccounts().getAll(req, res));
  ctx.route('put', '/api/accounting/platform-accounts', (req, res) => getPlatformAccounts().saveAll(req, res));
  ctx.route('post', '/api/accounting/platform-accounts/refresh', (req, res) => getPlatformAccounts().refresh(req, res));

  // Rule 3 — the accountant reads the journal and edits the account plan, nothing else here. The
  // read of the compensations is core (middleware/enforceRoleAccess).
  ctx.roleAccess('accountant', [
    { method: 'GET', re: /^\/accounting\/sales(\.csv)?$/ },
    { method: 'GET', re: /^\/accounting\/platforms$/ },
    { method: 'GET', re: /^\/accounting\/platform-accounts$/ },
    { method: 'PUT', re: /^\/accounting\/platform-accounts$/ },
    { method: 'POST', re: /^\/accounting\/platform-accounts\/refresh$/ },
  ]);

  // Rule 22 — only configuration is erased; every payment, refund, compensation and stay is core
  // data the journal reads, so a reinstall shows the same journal for the same months.
  ctx.data({
    tables: [],
    describe: (db) => {
      const lines = [];
      const platforms = configuredPlatformCount(db);
      if (platforms > 0) {
        lines.push({ label: platforms > 1 ? `les comptes de ${platforms} plateformes` : 'les comptes d’une plateforme', count: platforms });
      }
      // Settings still at their defaults have nothing to erase, so they are not listed.
      const customised = createAccountSettings(db).customisedCount();
      if (customised > 0) lines.push({ label: 'les comptes et taux par défaut', count: customised });
      return lines;
    },
    // The plugin settings themselves are deleted by the Plugins controller. The old app_settings
    // columns go back to their defaults too: the copy migration is forgotten with the erasure and
    // reruns at the next install, so it must not find the erased values there.
    purge: (db) => {
      db.prepare('UPDATE platforms SET commissionAccountNumber = NULL, hasVatOnCommission = 0').run();
      if (hasTable(db, 'app_settings')) {
        const cols = tableColumns(db, 'app_settings');
        const keys = KEYS.filter((key) => cols.has(key));
        if (keys.length > 0) {
          db.prepare(`UPDATE app_settings SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = 1`)
            .run(...keys.map((key) => DEFAULTS[key]));
        }
      }
    },
  });
}

module.exports = { id, register };
