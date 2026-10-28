// Options controller — thin handlers over optionsModel.

const model = require('../models/optionsModel');
const propertiesModel = require('../models/propertiesModel');
const { insuranceOffered, dynamicInsurance } = require('../utils/quotePostProcessors');
const { validateOptionPayload } = require('../utils/optionValidation');
const { scopePayload } = require('../utils/optionPayloadScope');
const { buildCatalogueView, buildArchivedItems } = require('../utils/optionCatalogueView');
const { emitPricingChanged } = require('../utils/pricingChanged');

// The early-arrival / late-departure options are edited on each property (specs/settings-rationalization.md
// rule 15): the catalogue view (`?view=catalogue`) leaves them out; every other caller gets them all.
const PROPERTY_EDITED_AUTO_OPTIONS = ['early_check_in', 'late_check_out'];

const catalogueOptions = () => model.list().filter((o) => !PROPERTY_EDITED_AUTO_OPTIONS.includes(o.autoOptionType));

function list(req, res) {
  if (req.query && req.query.view === 'catalogue') return res.json(catalogueOptions());
  return res.json(model.list());
}

// specs/options-resources-ux.md rules 2-7, 26 — the catalogue grouped, priced and annotated for the screen.
function catalogueView(req, res) {
  const properties = propertiesModel.list();
  const raw = req.query && req.query.propertyId;
  let propertyId = null;
  if (raw !== undefined && raw !== '') {
    propertyId = Number(raw);
    if (!properties.some((p) => Number(p.id) === propertyId)) return res.status(404).json({ error: 'Logement non trouvé' });
  }
  const view = buildCatalogueView(catalogueOptions(), properties, { propertyId, insuranceDynamic: dynamicInsurance() });
  return res.json({ ...view, archived: buildArchivedItems(model.listArchived(), { propertyId }) });
}

function getOne(req, res) {
  const option = model.get(req.params.id);
  if (!option) return res.status(404).json({ error: 'Option non trouvée' });
  return res.json(option);
}

// specs/plugins-phase-3b-neat.md rule 21 — no option becomes the cancellation insurance while no plugin
// offers it.
function insuranceFlagRefused(req, res) {
  if (!req.body || !req.body.isCancellationInsurance || insuranceOffered()) return false;
  res.status(400).json({ error: 'L’assurance annulation demande un plugin d’assurance actif.' });
  return true;
}

// specs/options-resources-ux.md rule 16 — a write the editor's checks would have stopped.
// It judges the payload the model will store — what concerns a property outside the scope is dropped
// first (rule 15), so an invisible, switched-off line can never block a save.
function validationRefused(req, res) {
  const details = validateOptionPayload(scopePayload(req.body));
  if (details.length === 0) return false;
  res.status(422).json({ error: 'VALIDATION_FAILED', details });
  return true;
}

function create(req, res) {
  if (insuranceFlagRefused(req, res)) return undefined;
  if (validationRefused(req, res)) return undefined;
  return res.json(model.create(req.body));
}

function update(req, res) {
  // The hidden insurance answers as if it did not exist (rule 21).
  if (!model.get(req.params.id)) return res.status(404).json({ error: 'Option non trouvée' });
  if (insuranceFlagRefused(req, res)) return undefined;
  if (validationRefused(req, res)) return undefined;
  const result = model.update(req.params.id, req.body);
  // A default option of a property is part of its website quote (specs/google-vacation-rentals-feed.md
  // rule 12): the shared catalogue moves every property.
  emitPricingChanged(null, 'options');
  return res.json(result);
}

function remove(req, res) {
  const result = model.remove(req.params.id);
  if (result && result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  emitPricingChanged(null, 'options');
  return res.json(result);
}

function restore(req, res) {
  const result = model.restore(req.params.id);
  if (result && result.error) return res.status(result.status || 400).json({ error: result.error });
  emitPricingChanged(null, 'options');
  return res.json(result);
}

module.exports = { list, catalogueView, getOne, create, update, remove, restore };
