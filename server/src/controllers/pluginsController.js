/**
 * Plugins controller, trimmed for the minimal engine (specs/plugin-engine-backport.md §4.1): list,
 * activate, deactivate and settings. No install/uninstall/purge, no blockers, no plan or licence — the
 * plugins branch's version of this file replaces it when that branch merges.
 */

const defaultModel = require('../models/pluginsModel');
const registry = require('../plugins/sdk/registry');
const { PLUGIN_CATALOG, findPlugin } = require('../constants/plugins');

// deps: the module registry and the plugin settings model, injectable for tests.
function createController(model = defaultModel, deps = {}) {
  const reg = deps.registry || registry;
  const settingsModel = deps.settingsModel || (() => require('../models/pluginSettingsModel'));

  function view(entry) {
    const row = model.get(entry.id);
    const record = reg.get(entry.id);
    let state = !row ? 'available' : row.enabled ? 'active' : 'inactive';
    if (row && record && record.failed) state = 'failed';
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      state,
      enabled: state === 'active',
    };
  }

  // Resolves `:id` or answers 404; returns the catalogue entry.
  function resolve(req, res) {
    const entry = findPlugin(req.params.id);
    if (!entry) res.status(404).json({ error: 'UNKNOWN_PLUGIN' });
    return entry;
  }

  return {
    // GET /api/plugins
    list(req, res) {
      return res.json(PLUGIN_CATALOG.map(view));
    },

    // POST /api/plugins/:id/activate
    activate(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      if (!model.get(entry.id)) return res.status(409).json({ error: 'NOT_INSTALLED' });
      model.setEnabled(entry.id, true);
      return res.json(view(entry));
    },

    // POST /api/plugins/:id/deactivate — data and settings kept.
    deactivate(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      if (!model.get(entry.id)) return res.status(409).json({ error: 'NOT_INSTALLED' });
      model.setEnabled(entry.id, false);
      return res.json(view(entry));
    },

    // GET /api/plugins/:id/settings — the declared keys; a secret reads `<key>Set` (rule 7).
    getSettings(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      const record = reg.get(entry.id);
      if (!record || !record.settings.length) return res.status(404).json({ error: 'NO_SETTINGS' });
      return res.json(settingsModel().httpView(entry.id, record.settings));
    },

    // PUT /api/plugins/:id/settings — '' on a secret keeps it, null clears it, a value replaces it.
    saveSettings(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      const record = reg.get(entry.id);
      if (!record || !record.settings.length) return res.status(404).json({ error: 'NO_SETTINGS' });
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const unknown = Object.keys(body).filter((key) => !record.settings.some((k) => k.key === key));
      if (unknown.length) return res.status(400).json({ error: 'UNKNOWN_SETTING', keys: unknown });
      // A declared `validate(value) → message | null` refuses the whole write (specs/plugins-phase-2-hosts.md
      // rule 15: the linen stock and laundry day keep the checks the core settings form had).
      const errors = {};
      record.settings.forEach(({ key, validate }) => {
        if (!validate || !Object.prototype.hasOwnProperty.call(body, key)) return;
        const message = validate(body[key]);
        if (message) errors[key] = message;
      });
      if (Object.keys(errors).length) return res.status(400).json({ error: 'INVALID_SETTING', errors });
      record.settings.forEach(({ key, secret, afterSave }) => {
        if (!Object.prototype.hasOwnProperty.call(body, key)) return;
        const value = body[key];
        if (secret && value === '') return;
        const stored = value == null ? '' : String(value).trim();
        settingsModel().set(entry.id, key, stored, { secret: Boolean(secret) });
        if (afterSave) afterSave(stored);
      });
      return res.json(settingsModel().httpView(entry.id, record.settings));
    },
  };
}

const defaultController = createController();

module.exports = defaultController;
module.exports.createController = createController;
