/**
 * Plugins controller (specs/plugins-phase-0-foundation.md §3.B, §4.3). Owns the states, the refusal
 * rules and the payload the Plugins page renders; the page never derives a state itself.
 */

const defaultModel = require('../models/pluginsModel');
const { PLUGIN_CATALOG, findPlugin, ONLINE_PAYMENT, SAS, ACCOUNTING_EXPORT } = require('../constants/plugins');
const { RECEPTION, ACCOUNTANT } = require('../constants/roles');

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Rule 8 — turning these off would leave something live without its tool.
function blockerFor(id, model) {
  if (id === ONLINE_PAYMENT) {
    const n = model.countOpenPaymentLinks();
    if (n > 0) {
      return {
        code: 'OPEN_PAYMENT_LINKS',
        message: `${plural(n, 'lien de paiement est en attente', 'liens de paiement sont en attente')}. Attends leur paiement ou annule-les avant de désactiver.`,
      };
    }
  }
  if (id === SAS) {
    const n = model.countOnlyRoleUsers(RECEPTION);
    if (n > 0) {
      return {
        code: 'RECEPTION_USERS',
        message: `${plural(n, 'compte Accueil est actif', 'comptes Accueil sont actifs')}. Change leur rôle dans Utilisateurs d’abord.`,
      };
    }
  }
  if (id === ACCOUNTING_EXPORT) {
    const n = model.countOnlyRoleUsers(ACCOUNTANT);
    if (n > 0) {
      return {
        code: 'ACCOUNTANT_USERS',
        message: `${plural(n, 'compte Comptable est actif', 'comptes Comptable sont actifs')}. Change leur rôle dans Utilisateurs d’abord.`,
      };
    }
  }
  return null;
}

function createController(model = defaultModel) {
  function view(entry) {
    const row = model.get(entry.id);
    const state = !row ? 'available' : row.enabled ? 'active' : 'inactive';
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      icon: entry.icon,
      surfaces: entry.surfaces,
      requires: entry.requires,
      state,
      blocker: state === 'available' ? null : blockerFor(entry.id, model),
    };
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

    // POST /api/plugins/:id/install — rule 4: installed and active in one step.
    install(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      if (model.get(entry.id)) return res.status(409).json({ error: 'ALREADY_INSTALLED' });
      model.install(entry.id);
      return res.json(view(entry));
    },

    // POST /api/plugins/:id/activate
    activate(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      if (!model.get(entry.id)) return res.status(409).json({ error: 'NOT_INSTALLED' });
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

    // DELETE /api/plugins/:id — rule 6: back to « Disponibles », data kept in phase 0.
    uninstall(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      if (!model.get(entry.id)) return res.status(409).json({ error: 'NOT_INSTALLED' });
      if (refuseIfBlocked(entry, res)) return undefined;
      model.uninstall(entry.id);
      return res.json(view(entry));
    },
  };
}

const defaultController = createController();

module.exports = defaultController;
module.exports.createController = createController;
