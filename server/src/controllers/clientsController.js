/**
 * Clients controller — orchestrates list/search, get, delete-impact, create, update, delete (force)
 * and orphan cleanup. Validation via `clientValidation`; all DB access + shaping in `clientsModel`.
 *
 * Exports a default controller bound to the production model, and a `buildController(model)` factory so
 * tests can inject a fake model. (The factory is NOT named `create` — that's a request handler here.)
 */

const { validateClientPayload } = require('../utils/clientValidation');
const { parseAddressBlock, extractEmail, extractPhone } = require('../utils/contactParsing');

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
    const { q, bucket, sort, dir } = req.query || {};
    return res.json(model.directory({ q, bucket, sort, dir }));
  }

  function getOne(req, res) {
    const client = model.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client non trouvé' });
    return res.json(client);
  }

  function getDeleteImpact(req, res) {
    const impact = model.getDeleteImpact(req.params.id);
    if (!impact) return res.status(404).json({ error: 'Client non trouvé' });
    return res.json(impact);
  }

  function create(req, res) {
    const error = validateClientPayload(req.body);
    if (error) return res.status(400).json({ error });
    return res.json(model.insert(req.body));
  }

  function update(req, res) {
    if (!model.findById(req.params.id)) return res.status(404).json({ error: 'Client non trouvé' });
    const error = validateClientPayload(req.body);
    if (error) return res.status(400).json({ error });
    return res.json(model.update(req.params.id, req.body));
  }

  function remove(req, res) {
    const id = Number(req.params.id);
    const force = String((req.query && req.query.force) || '').toLowerCase() === 'true';
    const impact = model.getDeleteImpact(id);
    if (!impact) return res.status(404).json({ error: 'Client non trouvé' });

    const hasLinks = impact.reservationsCount > 0 || impact.devisCount > 0;
    if (hasLinks && !force) {
      return res.status(409).json({
        error: 'Ce client est lié à des réservations ou des devis. Utilisez la suppression forcée pour tout supprimer.',
        code: 'CLIENT_IN_USE',
        client: impact.client,
        reservationsCount: impact.reservationsCount,
        reservations: impact.reservations,
        devisCount: impact.devisCount,
        devis: impact.devis,
      });
    }

    model.remove(id);
    return res.json({ ok: true });
  }

  // POST /clients/parse-contact — stateless: turns a dropped/typed raw string into clean field values
  // (specs/client-contact-smart-input.md). Only the requested keys come back.
  function parseContact(req, res) {
    const body = req.body || {};
    const requested = Object.keys(CONTACT_PARSERS).filter((key) => typeof body[key] === 'string');
    if (requested.length === 0) return res.status(400).json({ error: 'INVALID_PAYLOAD' });

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
    list, directory, getOne, getDeleteImpact, create, update, remove, parseContact,
    cleanupOrphans, cleanupOrphansPreview, cleanupOrphansDelete,
  };
}

const defaultController = createController(require('../models/clientsModel'));
defaultController.buildController = createController;

module.exports = defaultController;
