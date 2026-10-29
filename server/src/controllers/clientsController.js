/**
 * Clients controller — orchestrates list/search, get, delete-impact, create, update, delete (force)
 * and orphan cleanup. Validation via `clientValidation`; all DB access + shaping in `clientsModel`.
 *
 * Exports a default controller bound to the production model, and a `buildController(model)` factory so
 * tests can inject a fake model. (The factory is NOT named `create` — that's a request handler here.)
 */

const { validateClientPayload } = require('../utils/clientValidation');
const { parseAddressBlock, extractEmail, extractPhone, MAX_RAW_LENGTH } = require('../utils/contactParsing');
const { clientExistsRefusal } = require('../utils/clientDuplicates');
const { deactivateOpenLinksBeforeDelete } = require('../utils/paymentLinkDeactivation');
const { isHistoryMessage } = require('../utils/deletionGuard');

const clientBlockerCode = (message) => (isHistoryMessage(message) ? 'CLIENT_KEEPS_HISTORY' : 'CLIENT_CARRIES_MONEY');

// When a drop holds nothing recognizable, the raw text is echoed back rather than swallowed: the user
// sees what they dropped and the field's format validation flags it (spec §3 rules 8 and 11).
const CONTACT_PARSERS = {
  address: parseAddressBlock,
  email: (raw) => extractEmail(raw) || String(raw || '').trim(),
  phone: (raw) => extractPhone(raw) || String(raw || '').trim(),
};

function createController(model) {
  function list(req, res) {
    return res.json(model.list(req.query.q));
  }

  // specs/clients-upcoming-past-directory.md §4.3 — the Clients page's read. Unknown values fall back
  // to the defaults rather than 400: a stale bookmark must still show a list.
  function directory(req, res) {
    const { q, view, bucket, sort, dir } = req.query || {};
    return res.json(model.directory({ q, view, bucket, sort, dir }));
  }

  function getOne(req, res) {
    const client = model.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client non trouvé' });
    return res.json(client);
  }

  // specs/clients.md rule 12 — the client a record being typed would duplicate, or null: the fiche
  // offers to use it before anything is written.
  function duplicate(req, res) {
    const { email, phone } = req.query || {};
    const existing = typeof model.findDuplicate === 'function' ? model.findDuplicate({ email, phone }) : null;
    if (!existing) return res.json({ client: null });
    const { client, error } = clientExistsRefusal(existing);
    return res.json({ client, message: error });
  }

  function getDeleteImpact(req, res) {
    const impact = model.getDeleteImpact(req.params.id);
    if (!impact) return res.status(404).json({ error: 'Client non trouvé' });
    return res.json(impact);
  }

  // specs/clients.md rule 12 — a record with the email or phone of an existing client is
  // refused with that client, unless the operator asked for a second one (`allowDuplicate`).
  function create(req, res) {
    const error = validateClientPayload(req.body);
    if (error) return res.status(400).json({ error });
    if (!req.body.allowDuplicate && typeof model.findDuplicate === 'function') {
      const existing = model.findDuplicate(req.body);
      if (existing) return res.status(409).json(clientExistsRefusal(existing));
    }
    return res.json(model.insert(req.body));
  }

  function update(req, res) {
    if (!model.findById(req.params.id)) return res.status(404).json({ error: 'Client non trouvé' });
    const error = validateClientPayload(req.body);
    if (error) return res.status(400).json({ error });
    return res.json(model.update(req.params.id, req.body));
  }

  async function remove(req, res) {
    const id = Number(req.params.id);
    const force = String((req.query && req.query.force) || '').toLowerCase() === 'true';
    const impact = model.getDeleteImpact(id);
    if (!impact) return res.status(404).json({ error: 'Client non trouvé' });

    if (impact.blocker) return res.status(409).json({ error: impact.blocker, code: clientBlockerCode(impact.blocker) });

    const hasLinks = impact.reservationsCount > 0 || impact.devisCount > 0;
    if (hasLinks && !force) {
      return res.status(409).json({
        error: 'Ce client est lié à des réservations ou des devis. Suppression forcée requise pour tout supprimer.',
        code: 'CLIENT_IN_USE',
        client: impact.client,
        reservationsCount: impact.reservationsCount,
        reservations: impact.reservations,
        devisCount: impact.devisCount,
        devis: impact.devis,
      });
    }

    try {
      await deactivateOpenLinksBeforeDelete(model.rowIdsToDelete(id), { paymentLinksModel: require('../models/paymentLinksModel') });
    } catch (err) {
      return res.status((err && err.httpStatus) || 500).json({ error: (err && err.message) || 'Suppression impossible.', code: (err && err.error) || 'DELETE_FAILED' });
    }
    const outcome = model.removeGuarded(id);
    if (outcome.blocker) return res.status(409).json({ error: outcome.blocker, code: clientBlockerCode(outcome.blocker) });
    return res.json({ ok: true });
  }

  // POST /clients/parse-contact — stateless: turns a dropped/typed raw string into clean field values
  // (specs/client-contact-smart-input.md). Only the requested keys come back.
  function parseContact(req, res) {
    const body = req.body || {};
    const requested = Object.keys(CONTACT_PARSERS).filter((key) => typeof body[key] === 'string');
    if (requested.length === 0) return res.status(400).json({ error: 'INVALID_PAYLOAD' });
    if (requested.some((key) => body[key].length > MAX_RAW_LENGTH)) return res.status(400).json({ error: 'PAYLOAD_TOO_LONG' });

    const parsed = {};
    for (const key of requested) parsed[key] = CONTACT_PARSERS[key](body[key]);
    return res.json(parsed);
  }

  function cleanupOrphans(req, res) {
    return res.json({ ok: true, ...model.cleanupOrphans() });
  }

  // GET /clients/cleanup-orphans/preview — list of clients the selective cleanup popup may delete.
  function cleanupOrphansPreview(req, res) {
    return res.json({ orphans: model.listOrphans() });
  }

  // POST /clients/cleanup-orphans/delete — delete by ids, re-validating each id is still orphan.
  function cleanupOrphansDelete(req, res) {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    const allNumeric = Array.isArray(ids) && ids.every((v) => Number.isInteger(Number(v)) && Number(v) > 0);
    if (!ids || ids.length === 0 || !allNumeric) {
      return res.status(400).json({ error: 'INVALID_IDS' });
    }
    return res.json({ ok: true, ...model.cleanupOrphansByIds(ids) });
  }

  return {
    list, directory, duplicate, getOne, getDeleteImpact, create, update, remove, parseContact,
    cleanupOrphans, cleanupOrphansPreview, cleanupOrphansDelete,
  };
}

const defaultController = createController(require('../models/clientsModel'));
defaultController.buildController = createController;

module.exports = defaultController;
