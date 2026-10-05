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


// specs/plugins-phase-3c-hourly-resources.md rule 18 — a resource sold by the hour is offered only
// while its plugin is live: hidden from the lists, 404 on its own URLs, its price type refused.
const resourceOffer = require('../utils/resourceOffer');

function createController(model, { isOffered = resourceOffer.isOffered } = {}) {
  const offeredOnly = (resources) => (Array.isArray(resources) ? resources.filter(isOffered) : resources);
  const NOT_FOUND = { error: 'Ressource non trouvée' };
  const findOffered = (id) => {
    const resource = model.findById(id);
    return resource && isOffered(resource) ? resource : null;
  };
  // A resource that exists but is not offered answers like a missing one.
  const hidden = (id) => {
    const resource = model.findById(id);
    return Boolean(resource) && !isOffered(resource);
  };
  const refusedPriceType = (body) => (body && body.priceType && !isOffered({ priceType: body.priceType })
    ? resourceOffer.PRICE_TYPE_REFUSED
    : '');

  function list(req, res) {
    return res.json(offeredOnly(model.list(req.query.propertyId)));
  }

  function availability(req, res) {
    const { propertyId, startDate, endDate, excludeReservationId } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate et endDate requis' });
    return res.json(offeredOnly(model.availability(propertyId, startDate, endDate, excludeReservationId)));
  }

  function babyBedAvailability(req, res) {
    const { propertyId, startDate, endDate, excludeReservationId } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate et endDate requis' });
    return res.json(model.getBabyBedAvailability(propertyId, startDate, endDate, excludeReservationId));
  }

  function getOne(req, res) {
    const resource = findOffered(req.params.id);
    if (!resource) return res.status(404).json(NOT_FOUND);
    return res.json(resource);
  }

  function getDeleteImpact(req, res) {
    if (hidden(req.params.id)) return res.status(404).json(NOT_FOUND);
    const impact = model.getDeleteImpact(req.params.id);
    if (!impact) return res.status(404).json({ error: 'Ressource non trouvée' });
    return res.json(impact);
  }

  function create(req, res) {
    const error = validateResourcePayload(req.body) || refusedPriceType(req.body);
    if (error) return res.status(400).json({ error });
    return res.json({ id: model.insert(req.body) });
  }

  function update(req, res) {
    if (!findOffered(req.params.id)) return res.status(404).json(NOT_FOUND);
    const error = validateResourcePayload(req.body) || refusedPriceType(req.body);
    if (error) return res.status(400).json({ error });
    model.update(req.params.id, req.body);
    return res.json({ ok: true });
  }

  function remove(req, res) {
    const id = Number(req.params.id);
    const force = String((req.query && req.query.force) || '').toLowerCase() === 'true';
    if (hidden(id)) return res.status(404).json(NOT_FOUND);
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
