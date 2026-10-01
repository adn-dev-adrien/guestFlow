/**
 * The two settings of the website booking, in plugin_settings (specs/plugins-phase-2-hosts.md rules
 * 25, 27-28): the CGV enforcement switch and the WordPress plugin version last seen on a booking
 * request. `bindStore(ctx.settings)` runs at register; the controllers read through this module.
 */

const DECLARED = [
  { key: 'requireTermsAcceptance', default: '1' },
  { key: 'lastSeenPluginVersion' },
];

// The app_settings columns the values lived in until v3.8; they stay in place, unread.
const LEGACY_COLUMNS = ['requireTermsAcceptance', 'lastSeenPluginVersion'];
const PLUGIN_ID = 'website-booking';

let store = null;

function bindStore(settingsStore) {
  store = settingsStore;
}

// Only an explicit '0' lifts the enforcement (specs/terms-acceptance-record.md rule 17): a missing
// value keeps the safe default, on.
function termsSettings() {
  return {
    requireTermsAcceptance: String(store.get('requireTermsAcceptance')) !== '0',
    lastSeenPluginVersion: String(store.get('lastSeenPluginVersion') || ''),
  };
}

function setRequireTermsAcceptance(on) {
  store.set('requireTermsAcceptance', on ? '1' : '0');
}

function recordPluginVersion(version) {
  store.set('lastSeenPluginVersion', String(version || ''));
}

const legacyColumns = (db) => new Set(db.prepare('PRAGMA table_info(app_settings)').all().map((c) => c.name));

/**
 * The plugin's own copy of its two app_settings columns (rule 28). Runs once per install: a value
 * already in plugin_settings wins, an empty one is not copied.
 */
function copyFromAppSettings(db) {
  const cols = legacyColumns(db);
  const row = db.prepare('SELECT * FROM app_settings WHERE id = 1').get() || {};
  const insert = db.prepare('INSERT OR IGNORE INTO plugin_settings (plugin_id, key, value) VALUES (?, ?, ?)');
  LEGACY_COLUMNS.forEach((col) => {
    if (!cols.has(col)) return;
    const value = row[col];
    if (value === null || value === undefined || value === '') return;
    insert.run(PLUGIN_ID, col, String(value));
  });
}

/**
 * The erasure also resets the legacy columns: the purge forgets the plugin's migrations, so a
 * reinstall runs the copy again and would otherwise bring the erased values back.
 */
function resetLegacyColumns(db) {
  const cols = legacyColumns(db);
  if (cols.has('requireTermsAcceptance')) db.prepare('UPDATE app_settings SET requireTermsAcceptance = 1 WHERE id = 1').run();
  if (cols.has('lastSeenPluginVersion')) db.prepare("UPDATE app_settings SET lastSeenPluginVersion = '' WHERE id = 1").run();
}

module.exports = {
  DECLARED,
  bindStore,
  termsSettings,
  setRequireTermsAcceptance,
  recordPluginVersion,
  copyFromAppSettings,
  resetLegacyColumns,
};
