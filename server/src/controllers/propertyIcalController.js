// Property iCal controller — thin handlers over propertyIcalModel (sources CRUD + sync) and the
// merged per-property platform list (platformsModel.listForProperty).

const model = require('../models/propertyIcalModel');
const platformsModel = require('../models/platformsModel');

function respond(res, result) {
  if (result && result.error) return res.status(result.status || 400).json({ error: result.error });
  return res.json(result.data);
}

// specs/platforms-and-ical-rework.md §4.3 — merged list: every platform (built-ins ∪ DB) + this
// property's iCal-source config + the global colour. Thin: the model owns the merge.
function listPlatforms(req, res) {
  res.json({ platforms: platformsModel.listForProperty(Number(req.params.id)) });
}

function listSources(req, res) {
  respond(res, model.listSources(Number(req.params.id)));
}

function createSource(req, res) {
  respond(res, model.createSource(Number(req.params.id), req.body));
}

function updateSource(req, res) {
  respond(res, model.updateSource(Number(req.params.id), Number(req.params.sourceId), req.body));
}

function removeSource(req, res) {
  respond(res, model.removeSource(Number(req.params.id), Number(req.params.sourceId)));
}

async function sync(req, res) {
  respond(res, await model.syncOne(Number(req.params.id), Number(req.params.sourceId)));
}

async function syncAll(req, res) {
  res.json(await model.syncAllForProperty(Number(req.params.id)));
}

module.exports = { listPlatforms, listSources, createSource, updateSource, removeSource, sync, syncAll };
