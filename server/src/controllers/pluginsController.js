/**
 * Plugins controller (specs/plugins-phase-0-foundation.md §3.B, §4.3). Owns the states, the refusal
 * rules and the payload the Plugins page renders; the page never derives a state itself.
 */

const defaultModel = require('../models/pluginsModel');
const registry = require('../plugins/sdk/registry');
const { forgetPluginMigrations } = require('../plugins/sdk/pluginMigrations');
const { PLUGIN_CATALOG, findPlugin, ONLINE_PAYMENT, SAS, ACCOUNTING_EXPORT } = require('../constants/plugins');
const { RECEPTION, ACCOUNTANT } = require('../constants/roles');

// Rule 8 — turning these off would leave something live without its tool.
function blockerFor(id, model) {
  if (id === ONLINE_PAYMENT) {
    const n = model.countOpenPaymentLinks();
    if (n > 0) {
      return {
        code: 'OPEN_PAYMENT_LINKS',
        message: n > 1
          ? `${n} liens de paiement en attente : à payer ou annuler d’abord.`
          : '1 lien de paiement en attente : à payer ou annuler d’abord.',
      };
    }
    const pending = model.countPendingDeactivations ? model.countPendingDeactivations() : 0;
    if (pending > 0) {
      return {
        code: 'LINKS_PENDING_DEACTIVATION',
        message: pending > 1
          ? `${pending} liens annulés encore payables chez le prestataire : à désactiver d’abord.`
          : '1 lien annulé encore payable chez le prestataire : à désactiver d’abord.',
      };
    }
  }
  if (id === SAS) {
    const n = model.countOnlyRoleUsers(RECEPTION);
    if (n > 0) {
      return {
        code: 'RECEPTION_USERS',
        message: n > 1
          ? `${n} comptes Accueil actifs : changer leur rôle dans Utilisateurs d’abord.`
          : '1 compte Accueil actif : changer son rôle dans Utilisateurs d’abord.',
      };
    }
  }
  if (id === ACCOUNTING_EXPORT) {
    const n = model.countOnlyRoleUsers(ACCOUNTANT);
    if (n > 0) {
      return {
        code: 'ACCOUNTANT_USERS',
        message: n > 1
          ? `${n} comptes Comptable actifs : changer leur rôle dans Utilisateurs d’abord.`
          : '1 compte Comptable actif : changer son rôle dans Utilisateurs d’abord.',
      };
    }
  }
  return null;
}

// deps (specs/plugins-phase-1-sdk.md): the module registry, the database the erasure runs on, the
// plugin settings model, the loader's migrate + install hooks. All injectable for tests.
function createController(model = defaultModel, deps = {}) {
  const reg = deps.registry || registry;
  const getDb = deps.db || (() => require('../database'));
  const settingsModel = deps.settingsModel || (() => require('../models/pluginSettingsModel'));
  const loader = deps.loader || (() => require('../plugins/loader'));
  const licence = deps.licence || (() => require('../utils/licence').default);

  const erasable = (id) => Boolean(reg.get(id) && reg.get(id).data);

  // Rule 12 — what « Effacer aussi ses données » would erase, as the server counts it.
  function dataLines(id) {
    const record = reg.get(id);
    if (!record || !record.data || !record.data.describe) return [];
    try {
      return record.data.describe(getDb()) || [];
    } catch {
      return [];
    }
  }

  // specs/control-plane-plans-and-access.md rules 11–12 — a plugin outside the licence keeps its
  // stored state (so an upgrade brings it back untouched) and carries the plan that includes it.
  const planHint = (plan) => (plan ? `Inclus dans le forfait ${plan}, sur demande.` : 'En option, sur demande.');

  function planView(id) {
    if (licence().allowsPlugin(id)) return { outOfPlan: false, planChip: null, planHint: null };
    const plan = licence().planFor(id);
    return { outOfPlan: true, planChip: plan ? `Forfait ${plan}` : 'Option à la carte', planHint: planHint(plan) };
  }

  function refuseIfOutOfPlan(entry, res) {
    if (licence().allowsPlugin(entry.id)) return false;
    const plan = licence().planFor(entry.id);
    res.status(402).json({ error: 'PLAN_REQUIRED', plan, message: planHint(plan) });
    return true;
  }

  function view(entry) {
    const row = model.get(entry.id);
    const record = reg.get(entry.id);
    let state = !row ? 'available' : row.enabled ? 'active' : 'inactive';
    if (row && record && record.failed) state = 'failed';
    return {
      ...planView(entry.id),
      id: entry.id,
      name: entry.name,
      description: entry.description,
      icon: entry.icon,
      surfaces: entry.surfaces,
      requires: entry.requires,
      state,
      blocker: state === 'available' ? null : blockerFor(entry.id, model),
      hasModule: Boolean(record),
      erasable: erasable(entry.id),
      data: row && erasable(entry.id) ? dataLines(entry.id) : [],
    };
  }

  // Rule 12 — one transaction: the plugin's own clean-up, its tables, its settings, its ledger rows.
  function purge(id) {
    const db = getDb();
    const { tables = [], purge: extra } = reg.get(id).data;
    db.transaction(() => {
      if (extra) extra(db);
      tables.forEach((table) => db.exec(`DROP TABLE IF EXISTS "${table.replace(/"/g, '')}"`));
      settingsModel().deleteAll(id);
      forgetPluginMigrations(db, id);
    })();
  }

  // Resolves `:id` or answers 404; returns the catalogue entry.
  function resolve(req, res) {
    const entry = findPlugin(req.params.id);
    if (!entry) res.status(404).json({ error: 'UNKNOWN_PLUGIN' });
    return entry;
  }

  function refuseIfBlocked(entry, res) {
    const blocker = blockerFor(entry.id, model);
    if (!blocker) return false;
    res.status(409).json({ error: 'PLUGIN_BLOCKED', code: blocker.code, message: blocker.message });
    return true;
  }

  return {
    // GET /api/plugins
    list(req, res) {
      return res.json(PLUGIN_CATALOG.map(view));
    },

    // POST /api/plugins/:id/install — rule 4: installed and active in one step. A module's tables are
    // created first (phase 1 rule 6); a failed migration leaves the plugin available.
    async install(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      if (model.get(entry.id)) return res.status(409).json({ error: 'ALREADY_INSTALLED' });
      if (refuseIfOutOfPlan(entry, res)) return undefined;
      if (reg.get(entry.id)) {
        try {
          loader().migrate(getDb(), entry.id);
        } catch (err) {
          console.error(`[plugin:${entry.id}] install migration failed:`, err && err.message ? err.message : err);
          return res.status(500).json({ error: 'PLUGIN_MIGRATION_FAILED', plugin: entry.id });
        }
      }
      model.install(entry.id);
      if (reg.get(entry.id)) await loader().runInstallHooks(entry.id);
      return res.json(view(entry));
    },

    // POST /api/plugins/:id/activate
    activate(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      if (!model.get(entry.id)) return res.status(409).json({ error: 'NOT_INSTALLED' });
      if (refuseIfOutOfPlan(entry, res)) return undefined;
      model.setEnabled(entry.id, true);
      return res.json(view(entry));
    },

    // POST /api/plugins/:id/deactivate — rule 5: data and settings kept.
    deactivate(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      if (!model.get(entry.id)) return res.status(409).json({ error: 'NOT_INSTALLED' });
      if (refuseIfBlocked(entry, res)) return undefined;
      model.setEnabled(entry.id, false);
      return res.json(view(entry));
    },

    // DELETE /api/plugins/:id — rule 6: back to « Disponibles », data kept. `?purge=1` also erases
    // the data of a plugin module (phase 1 rules 12, 21–24).
    uninstall(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      if (!model.get(entry.id)) return res.status(409).json({ error: 'NOT_INSTALLED' });
      const wantsPurge = req.query && (req.query.purge === '1' || req.query.purge === 'true');
      if (wantsPurge && !erasable(entry.id)) return res.status(409).json({ error: 'NOT_ERASABLE' });
      if (refuseIfBlocked(entry, res)) return undefined;
      if (wantsPurge) {
        try {
          purge(entry.id);
        } catch (err) {
          console.error(`[plugin:${entry.id}] erasure failed:`, err && err.message ? err.message : err);
          // Rule 12: a failed erasure leaves the plugin installed and inactive.
          model.setEnabled(entry.id, false);
          return res.status(500).json({ error: 'PLUGIN_PURGE_FAILED', message: 'Échec de l’effacement : rien n’a été effacé.' });
        }
      }
      model.uninstall(entry.id);
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
      record.settings.forEach(({ key, secret }) => {
        if (!Object.prototype.hasOwnProperty.call(body, key)) return;
        const value = body[key];
        if (secret && value === '') return;
        settingsModel().set(entry.id, key, value == null ? '' : String(value).trim(), { secret: Boolean(secret) });
      });
      return res.json(settingsModel().httpView(entry.id, record.settings));
    },
  };
}

const defaultController = createController();

module.exports = defaultController;
module.exports.createController = createController;
