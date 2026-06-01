// Properties controller — thin handlers over propertiesModel.

const model = require('../models/propertiesModel');
const { buildProgressivePreview } = require('../utils/pricing');

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
  res.json(model.list());
}

function getOne(req, res) {
  const property = model.getByIdWithDetails(req.params.id);
  if (!property) return res.status(404).json({ error: 'Logement non trouvé' });
  return res.json(property);
}

function platformColors(req, res) {
  res.json(model.getPlatformColors());
}

function progressivePreview(req, res) {
  const { pricePerNight, progressiveTiers, maxNights } = req.body;
  res.json(buildProgressivePreview(Number(pricePerNight || 0), progressiveTiers, Number(maxNights || 14)));
}

async function create(req, res) {
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
  try {
    res.json(await model.update(req.params.id, req.body, req.file));
  } catch (err) {
    console.error('[propertiesController.update]', err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du logement' });
  }
}

function remove(req, res) {
  res.json(model.remove(req.params.id));
}

function addPricing(req, res) {
  respond(res, model.addPricingRule(req.params.id, req.body));
}

function updatePricing(req, res) {
  respond(res, model.updatePricingRule(req.params.id, req.params.ruleId, req.body));
}

function deletePricing(req, res) {
  respond(res, model.deletePricingRule(req.params.id, req.params.ruleId));
}

function applyPricing(req, res) {
  respond(res, model.applyPricingTo(Number(req.params.id), req.body));
}

function addDocument(req, res) {
  respond(res, model.addDocument(req.params.id, req.file, req.body));
}

function deleteDocument(req, res) {
  respond(res, model.deleteDocument(req.params.id, req.params.docId));
}

function setOptions(req, res) {
  res.json(model.setOptions(req.params.id, req.body.optionIds));
}

module.exports = {
  list, getOne, platformColors, progressivePreview,
  create, update, remove,
  addPricing, updatePricing, deletePricing, applyPricing,
  addDocument, deleteDocument, setOptions,
};
