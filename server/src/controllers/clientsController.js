/**
 * Clients controller — orchestrates list/search, get, delete-impact, create, update, delete (force)
 * and orphan cleanup. Validation via `clientValidation`; all DB access + shaping in `clientsModel`.
 *
 * Exports a default controller bound to the production model, and a `buildController(model)` factory so
 * tests can inject a fake model. (The factory is NOT named `create` — that's a request handler here.)
 */

const { validateClientPayload } = require('../utils/clientValidation');

function createController(model) {
  function list(req, res) {
    return res.json(model.list(req.query.q));
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

  function cleanupOrphans(req, res) {
    return res.json({ ok: true, ...model.cleanupOrphans() });
  }

  return { list, getOne, getDeleteImpact, create, update, remove, cleanupOrphans };
}

const defaultController = createController(require('../models/clientsModel'));
defaultController.buildController = createController;

module.exports = defaultController;
