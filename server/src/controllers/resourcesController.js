/**
 * Resources controller — list / availability / baby-bed-availability / get / create / update /
 * delete(+force) / delete-impact. Validation here; all DB access + shaping in `resourcesModel`.
 *
 * Exports a default controller bound to the production model, and a `buildController(model)` factory for
 * tests. (The factory is NOT named `create` — that's a request handler here.)
 */

const { tokenError, lengthError } = require('../utils/templateTokens');
const propertiesModel = require('../models/propertiesModel');
const { RESOURCE_BOOKED } = require('../utils/stayTextCatalogue');

const { priceProblem, closedValueRefused, MESSAGES } = require('../utils/optionValidation');
const { isOptionalText, isClockTime, positiveId } = require('../utils/bodyText');
const { numberRefused, nonNegative, wholeFrom } = require('../utils/lineInputBounds');
const { buildResourceItems } = require('../utils/resourceCatalogueView');
const { resourceCatalogueContributors } = require('../utils/resourceCatalogueContributors');

const isBlank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
const HOURLY_RATES = ['hourlyEveningRate', 'hourlyExternalDayRate', 'hourlyExternalEveningRate'];
const RESOURCE_MINUTES = ['slotDuration', 'turnoverMinutes', 'minimumUsageMinutes', 'heatUpMinutes', 'heatRetentionMinutes'];
const PRICE_TYPES = ['per_stay', 'per_person', 'per_night', 'per_person_per_night', 'per_hour', 'free'];
const RESOURCE_TEXTS = ['note', 'emailBookedText', 'emailBookedTextEn'];
const RESOURCE_HOURS = ['openTime', 'closeTime', 'hourlyEveningStart'];

// A list of week days, or the JSON the editor sends it in.
function isOpenDays(value) {
  let days = value;
  if (typeof value === 'string') {
    try { days = JSON.parse(value); } catch { return false; }
  }
  return Array.isArray(days) && days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}

/**
 * specs/options-resources-ux.md rule 21 — `[{ field, message }]`, empty when the payload is acceptable.
 * `field` is `name`, `quantity`, `price`, `propertyPricing.<propertyId>`, `propertyPrices.<propertyId>`, a
 * hourly rate, a duration in minutes or `closeTime`. `stored` is the resource being edited: a number it
 * holds, sent back unchanged, is not re-judged (rule 31).
 */
function validateResourcePayload(body, stored = null, knownPropertyIds = null) {
  const payload = body || {};
  const details = [];
  const known = knownPropertyIds ? new Set(knownPropertyIds.map(Number)) : null;
  const unknownProperty = (pid) => positiveId(pid) === null || (known !== null && !known.has(positiveId(pid)));
  if (payload.propertyIds !== undefined && payload.propertyIds !== null
    && (!Array.isArray(payload.propertyIds) || payload.propertyIds.some(unknownProperty))) {
    details.push({ field: 'propertyIds', message: MESSAGES.unknownProperty });
  }
  for (const group of ['propertyPricing', 'propertyPrices']) {
    Object.keys(payload[group] || {}).filter(unknownProperty).forEach((pid) => details.push({ field: `${group}.${pid}`, message: MESSAGES.unknownProperty }));
  }
  if (typeof payload.name !== 'string' || !payload.name.trim()) details.push({ field: 'name', message: 'Nom requis' });
  RESOURCE_TEXTS.forEach((field) => {
    if (!isOptionalText(payload[field])) details.push({ field, message: MESSAGES.notText });
  });
  if (closedValueRefused(payload.priceType, (v) => PRICE_TYPES.includes(v), stored?.priceType)) details.push({ field: 'priceType', message: MESSAGES.choice });
  RESOURCE_HOURS.forEach((field) => {
    if (closedValueRefused(payload[field], isClockTime, stored?.[field])) details.push({ field, message: MESSAGES.time });
  });
  if (closedValueRefused(payload.openDays, isOpenDays, stored?.openDays)) details.push({ field: 'openDays', message: MESSAGES.choice });

  const quantity = Number(typeof payload.quantity === 'object' ? NaN : payload.quantity);
  const keptQuantity = stored != null && Number(stored.quantity) === quantity;
  if (isBlank(payload.quantity) || !(Number.isFinite(quantity) || keptQuantity)) details.push({ field: 'quantity', message: MESSAGES.notANumber });
  else if (quantity < 0) details.push({ field: 'quantity', message: MESSAGES.negative });
  else if (!keptQuantity && !wholeFrom(0)(quantity)) details.push({ field: 'quantity', message: 'Nombre entier attendu' });

  const priced = (field, raw, kept) => {
    if (isBlank(raw)) return;
    const message = priceProblem(raw, { stored: kept });
    if (message) details.push({ field, message });
  };
  priced('price', payload.price, stored?.price);
  HOURLY_RATES.forEach((field) => priced(field, payload[field], stored?.[field]));
  Object.entries(payload.propertyPricing || {}).forEach(([pid, line]) => {
    priced(`propertyPricing.${pid}`, line && line.price, stored?.propertyPricing?.[pid]?.price);
    if (numberRefused(line && line.freeMinutes, nonNegative, stored?.propertyPricing?.[pid]?.freeMinutes)) {
      details.push({ field: `propertyPricing.${pid}.freeMinutes`, message: MESSAGES.notANumber });
    }
  });
  Object.entries(payload.propertyPrices || {}).forEach(([pid, raw]) => priced(`propertyPrices.${pid}`, raw, stored?.propertyPrices?.[pid]));
  RESOURCE_MINUTES.forEach((field) => {
    if (numberRefused(payload[field], nonNegative, stored?.[field])) details.push({ field, message: MESSAGES.notANumber });
  });

  const slotted = payload.priceType === 'per_hour' && (payload.isComplex === 1 || payload.isComplex === true || payload.isComplex === '1');
  if (slotted && typeof payload.openTime === 'string' && typeof payload.closeTime === 'string' && payload.openTime && payload.closeTime && payload.closeTime <= payload.openTime) {
    details.push({ field: 'closeTime', message: 'Après l’ouverture' });
  }
  return details;
}

// specs/plugins-phase-p-productisation.md rules 4, 11 — the sentence once booked knows `{{slots}}` only.
function sentenceError(body) {
  return tokenError('emailBookedText', (body || {}).emailBookedText, RESOURCE_BOOKED)
    || tokenError('emailBookedTextEn', (body || {}).emailBookedTextEn, RESOURCE_BOOKED)
    || lengthError('emailBookedText', (body || {}).emailBookedText)
    || lengthError('emailBookedTextEn', (body || {}).emailBookedTextEn);
}


// specs/plugins-phase-3c-hourly-resources.md rule 18 — a resource sold by the hour is offered only
// while its plugin is live: hidden from the lists, 404 on its own URLs, its price type refused.
const resourceOffer = require('../utils/resourceOffer');

function createController(model, {
  isOffered = resourceOffer.isOffered,
  properties = () => propertiesModel.list(),
  contributors = resourceCatalogueContributors,
} = {}) {
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

  // Rules 18-19 — each resource ready to render, with the lines the live plugins add.
  function catalogueView(req, res) {
    const items = buildResourceItems(offeredOnly(model.list()), properties(), contributors());
    return res.json({ items });
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

  // Rule 21 — the editor's own checks, authoritative here.
  function validationRefused(body, res, stored = null) {
    const details = validateResourcePayload(body, stored, properties().map((p) => p.id));
    if (details.length === 0) return false;
    res.status(422).json({ error: 'VALIDATION_FAILED', details });
    return true;
  }

  function create(req, res) {
    if (validationRefused(req.body, res)) return undefined;
    const error = refusedPriceType(req.body);
    if (error) return res.status(400).json({ error });
    const sentence = sentenceError(req.body);
    if (sentence) return res.status(422).json(sentence);
    return res.json({ id: model.insert(req.body) });
  }

  function update(req, res) {
    const stored = findOffered(req.params.id);
    if (!stored) return res.status(404).json(NOT_FOUND);
    if (validationRefused(req.body, res, stored)) return undefined;
    const error = refusedPriceType(req.body);
    if (error) return res.status(400).json({ error });
    const sentence = sentenceError(req.body);
    if (sentence) return res.status(422).json(sentence);
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
        error: 'Cette ressource est utilisée par des réservations ou des créneaux. Suppression forcée requise.',
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

  return { list, catalogueView, availability, babyBedAvailability, getOne, getDeleteImpact, create, update, remove };
}

const defaultController = createController(require('../models/resourcesModel'));
defaultController.buildController = createController;

module.exports = defaultController;
