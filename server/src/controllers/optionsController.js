// Options controller — thin handlers over optionsModel.

const model = require('../models/optionsModel');

// The early-arrival / late-departure options are edited on each property (specs/settings-rationalization.md
// rule 15): the catalogue view (`?view=catalogue`) leaves them out; every other caller gets them all.
const PROPERTY_EDITED_AUTO_OPTIONS = ['early_check_in', 'late_check_out'];

function list(req, res) {
  const options = model.list();
  if (req.query && req.query.view === 'catalogue') {
    return res.json(options.filter((o) => !PROPERTY_EDITED_AUTO_OPTIONS.includes(o.autoOptionType)));
  }
  return res.json(options);
}

function getOne(req, res) {
  const option = model.get(req.params.id);
  if (!option) return res.status(404).json({ error: 'Option non trouvée' });
  return res.json(option);
}

/**
 * A `percent_of_stay` option stores a PERCENTAGE in `options.price`
 * (specs/cancellation-insurance.md §3.1 rule 2). Authoritative bound check: the client's number
 * input is a UX hint, this is what actually rejects a 400 % insurance.
 */
function validatePercentPrice(payload) {
  if ((payload || {}).priceType !== 'percent_of_stay') return null;
  const percent = Number(payload.price);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return { field: 'price', issue: 'percent_of_stay expects a percentage between 0 and 100' };
  }
  return null;
}

function create(req, res) {
  const invalid = validatePercentPrice(req.body);
  if (invalid) return res.status(422).json({ error: 'VALIDATION_FAILED', details: [invalid] });
  return res.json(model.create(req.body));
}

function update(req, res) {
  const invalid = validatePercentPrice(req.body);
  if (invalid) return res.status(422).json({ error: 'VALIDATION_FAILED', details: [invalid] });
  return res.json(model.update(req.params.id, req.body));
}

function remove(req, res) {
  const result = model.remove(req.params.id);
  if (result && result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result);
}

module.exports = { list, getOne, create, update, remove };
