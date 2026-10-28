// Properties controller — thin handlers over propertiesModel.

const model = require('../models/propertiesModel');
const { buildProgressivePreview } = require('../utils/pricing');
const { ADMIN, RECEPTION, userHasRole } = require('../constants/roles');
const { toReceptionPropertyList } = require('../utils/receptionView');
const { validatePropertyInput } = require('../utils/propertyValidation');
const { quotaRefusal } = require('../utils/planQuota');
const propertyArticle = require('../utils/propertyArticle');
const { emitPricingChanged, priceBearingRow, priceBearingChanged } = require('../utils/pricingChanged');

// Map a model result ({ data } | { error, status, conflictingRule?, code? }) to an HTTP response.
function respond(res, result) {
  if (result && result.error) {
    const body = { error: result.error };
    if (result.conflictingRule) body.conflictingRule = result.conflictingRule;
    if (result.code) body.code = result.code;
    return res.status(result.status || 400).json(body);
  }
  return res.json(result.data);
}

function list(req, res) {
  // specs/reception-role-checkin-only.md §3.2 — a reception-only user gets the pricing-stripped
  // property view (id + name + photo) for the Planning columns; everyone else the full list.
  const properties = model.list();
  const receptionOnly = userHasRole(req.user, RECEPTION) && !userHasRole(req.user, ADMIN);
  res.json(receptionOnly ? toReceptionPropertyList(properties) : properties);
}

function getOne(req, res) {
  const property = model.getByIdWithDetails(req.params.id);
  if (!property) return res.status(404).json({ error: 'Logement non trouvé' });
  // `?view=stay` — what a reservation fiche reads: the property without its pricing seasons, which only
  // the tariff pages render (the bulk of the payload; specs/inte-performance.md rule 14).
  if (req.query && req.query.view === 'stay') {
    const { pricingRules, ...stay } = property; // eslint-disable-line no-unused-vars
    return res.json(stay);
  }
  return res.json(property);
}

// GET /api/properties/article-labels?name= — the five articles as the guest emails write them
// (« au Fournil »: the server contracts), so the property page shows what is sent
// (specs/guest-email-texts-made-simple.md rule 30, 2026-10-18).
function articleLabels(req, res) {
  res.json({ labels: propertyArticle.choices(String((req.query && req.query.name) || '').slice(0, 200)) });
}

function platformColors(req, res) {
  res.json(model.getPlatformColors());
}

// GET/PUT /api/properties/email-hooks — the J-7 hooks, edited from the J-7 template
// (specs/settings-rationalization.md rule 17c).
function emailHooks(req, res) {
  res.json(model.listEmailHooks());
}

function saveEmailHooks(req, res) {
  return respond(res, model.saveEmailHooks(req.body && req.body.hooks));
}

function progressivePreview(req, res) {
  const { pricePerNight, progressiveTiers, maxNights } = req.body;
  res.json(buildProgressivePreview(Number(pricePerNight || 0), progressiveTiers, Number(maxNights || 14)));
}

// specs/settings-rationalization.md rule 23a — refused before anything is written, one message per field.
function refuseInvalid(res, body, existing) {
  const errors = validatePropertyInput(body || {}, existing);
  if (Object.keys(errors).length === 0) return false;
  res.status(400).json({ error: 'PROPERTY_INVALID', errors });
  return true;
}

async function create(req, res) {
  if (refuseInvalid(res, req.body, null)) return;
  const refusal = quotaRefusal('units', () => model.count());
  if (refusal) return void res.status(402).json(refusal);
  try {
    res.json(await model.create(req.body, req.file));
  } catch (err) {
    // Don't echo the raw error message back — it may include file paths, library internals
    // or sharp/multer details that aren't useful to the user but help an attacker fingerprint
    // the stack. Spotted in the 2026-06-01 security audit (finding M3).
    console.error('[propertiesController.create]', err);
    res.status(500).json({ error: 'Erreur lors de la création du logement' });
  }
}

async function update(req, res) {
  if (refuseInvalid(res, req.body, model.getByIdWithDetails(req.params.id))) return;
  try {
    const before = priceBearingRow(req.params.id);
    const result = await model.update(req.params.id, req.body, req.file);
    if (priceBearingChanged(before, priceBearingRow(req.params.id))) emitPricingChanged(req.params.id, 'property');
    res.json(result);
  } catch (err) {
    console.error('[propertiesController.update]', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du logement' });
  }
}

function remove(req, res) {
  res.json(model.remove(req.params.id));
}

// specs/google-vacation-rentals-feed.md rule 12 — a write that succeeded announces itself; a refusal
// announces nothing.
function respondAndAnnounce(res, result, propertyId, source) {
  if (result && !result.error) emitPricingChanged(propertyId, source);
  return respond(res, result);
}

function addPricing(req, res) {
  respondAndAnnounce(res, model.addPricingRule(req.params.id, req.body), req.params.id, 'pricing');
}

function updatePricing(req, res) {
  respondAndAnnounce(res, model.updatePricingRule(req.params.id, req.params.ruleId, req.body), req.params.id, 'pricing');
}

function deletePricing(req, res) {
  respondAndAnnounce(res, model.deletePricingRule(req.params.id, req.params.ruleId), req.params.id, 'pricing');
}

// « Prix plateformes » grid for the tarif page (specs/platform-price-from-commission.md).
// Read endpoint → res.json directly (like list/getOne); the model returns clean data, not { data }.
function platformPrices(req, res) {
  res.json(model.platformPrices(req.params.id));
}

function applyPricing(req, res) {
  const target = req.body && req.body.targetPropertyId;
  respondAndAnnounce(res, model.applyPricingTo(Number(req.params.id), req.body), target, 'pricing');
}

// Calendar season painting (specs/pricing-min-nights-per-range.md): (re)assign a selected period to a
// season with a minimum-nights, carving/splitting the covering season(s) server-side.
function assignPricingDateRange(req, res) {
  respondAndAnnounce(res, model.assignDateRangeToSeason(req.params.id, req.body), req.params.id, 'pricing');
}

function addDocument(req, res) {
  respond(res, model.addDocument(req.params.id, req.file, req.body));
}

function deleteDocument(req, res) {
  respond(res, model.deleteDocument(req.params.id, req.params.docId));
}

function setOptions(req, res) {
  const result = model.setOptions(req.params.id, req.body.optionIds);
  emitPricingChanged(req.params.id, 'options');
  res.json(result);
}

module.exports = {
  list, getOne, articleLabels, platformColors, emailHooks, saveEmailHooks, progressivePreview,
  create, update, remove,
  addPricing, updatePricing, deletePricing, applyPricing, assignPricingDateRange, platformPrices,
  addDocument, deleteDocument, setOptions,
};
