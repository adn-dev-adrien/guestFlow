/**
 * « Facturables au SAS » — the prices the SAS bills: missing linen elements and repairs
 * (specs/arrival-departure-sas.md §3.4, specs/extinguisher-seal-and-repair-amounts.md). Owned by the
 * `sas` plugin since specs/plugins-phase-2-hosts.md rule 8 (gap 3); the two tables stay core, the
 * departure commit prices its repairs from them.
 */

const sdk = require('../sdk');

const linenItemsModel = sdk.coreModule('linenItemsModel');
const repairAmountsModel = sdk.coreModule('repairAmountsModel');
const { extinguisherCheckOn } = require('./settings');

const itemsOf = (body) => (Array.isArray(body) ? body : (body && Array.isArray(body.items) ? body.items : null));

function getLinenItems(req, res) {
  return res.json(linenItemsModel.list());
}

function updateLinenItems(req, res) {
  const items = itemsOf(req.body);
  if (!items) return res.status(400).json({ error: 'INVALID_PAYLOAD' });
  return res.json(linenItemsModel.replaceAll(items));
}

function getRepairAmounts(req, res) {
  return res.json(repairAmountsModel.list());
}

function updateRepairAmounts(req, res) {
  const items = itemsOf(req.body);
  if (!items) return res.status(400).json({ error: 'INVALID_PAYLOAD' });
  return res.json(repairAmountsModel.replaceAll(items, { keepProtected: extinguisherCheckOn() }));
}

module.exports = { getLinenItems, updateLinenItems, getRepairAmounts, updateRepairAmounts };
