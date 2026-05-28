/**
 * Resources controller — list / availability / baby-bed-availability / get / create / update /
 * delete(+force) / delete-impact. Validation here; all DB access + shaping in `resourcesModel`.
 *
 * Exports a default controller bound to the production model, and a `buildController(model)` factory for
 * tests. (The factory is NOT named `create` — that's a request handler here.)
 */

function validateResourcePayload(body) {
  if (!body || !String(body.name || '').trim()) return 'Le nom de la ressource est requis.';
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) return 'Quantité invalide.';
  if (body.price !== undefined && body.price !== null && body.price !== '') {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) return 'Prix invalide.';
  }
  return '';
}

function createController(model) {
  function list(req, res) {
    return res.json(model.list(req.query.propertyId));
  }

  function availability(req, res) {
    const { propertyId, startDate, endDate, excludeReservationId } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate et endDate requis' });
    return res.json(model.availability(propertyId, startDate, endDate, excludeReservationId));
  }

  function babyBedAvailability(req, res) {
    const { propertyId, startDate, endDate, excludeReservationId } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate et endDate requis' });
    return res.json(model.getBabyBedAvailability(propertyId, startDate, endDate, excludeReservationId));
  }

  function getOne(req, res) {
    const resource = model.findById(req.params.id);
    if (!resource) return res.status(404).json({ error: 'Ressource non trouvée' });
    return res.json(resource);
  }

  function getDeleteImpact(req, res) {
    const impact = model.getDeleteImpact(req.params.id);
    if (!impact) return res.status(404).json({ error: 'Ressource non trouvée' });
    return res.json(impact);
  }

  function create(req, res) {
    const error = validateResourcePayload(req.body);
    if (error) return res.status(400).json({ error });
    return res.json({ id: model.insert(req.body) });
  }

  function update(req, res) {
    if (!model.findById(req.params.id)) return res.status(404).json({ error: 'Ressource non trouvée' });
    const error = validateResourcePayload(req.body);
    if (error) return res.status(400).json({ error });
    model.update(req.params.id, req.body);
    return res.json({ ok: true });
  }

  function remove(req, res) {
    const id = Number(req.params.id);
    const force = String((req.query && req.query.force) || '').toLowerCase() === 'true';
    const impact = model.getDeleteImpact(id);
    if (!impact) return res.status(404).json({ error: 'Ressource non trouvée' });

    const inUse = impact.reservationsCount > 0 || impact.bookingsCount > 0;
    if (inUse && !force) {
      return res.status(409).json({
        error: 'Cette ressource est utilisée par des réservations ou des créneaux. Utilisez la suppression forcée.',
        code: 'RESOURCE_IN_USE',
        resource: impact.resource,
        reservationsCount: impact.reservationsCount,
        reservations: impact.reservations,
        bookingsCount: impact.bookingsCount,
        bookings: impact.bookings,
      });
    }

    model.remove(id);
    return res.json({ ok: true });
  }

  return { list, availability, babyBedAvailability, getOne, getDeleteImpact, create, update, remove };
}

const defaultController = createController(require('../models/resourcesModel'));
defaultController.buildController = createController;

module.exports = defaultController;
