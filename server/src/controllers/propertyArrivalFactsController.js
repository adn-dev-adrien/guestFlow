/**
 * Arrival facts of a property (specs/guest-email-texts-made-simple.md rules 1–2).
 *
 *   GET /api/properties/:id/arrival-facts   { address, mapUrl, accessFr, accessEn, hasAccessCode, wifiName, hasWifiPassword }
 *   PUT /api/properties/:id/arrival-facts   same fields; `accessCode` / `wifiPassword` absent = kept, '' = cleared
 *
 * The two secrets are never sent back: the form shows them masked (MaskedTextField).
 */

const arrivalFactsModel = require('../models/propertyArrivalFactsModel');

const FIELDS = ['address', 'mapUrl', 'accessFr', 'accessEn', 'accessCode', 'wifiName', 'wifiPassword'];

function buildController({ database }) {
  const model = () => arrivalFactsModel.buildModel(database);
  const exists = (id) => Boolean(database.prepare('SELECT 1 FROM properties WHERE id = ?').get(Number(id)));

  function get(req, res) {
    if (!exists(req.params.id)) return res.status(404).json({ error: 'PROPERTY_NOT_FOUND' });
    return res.json(model().forForm(req.params.id));
  }

  function save(req, res) {
    if (!exists(req.params.id)) return res.status(404).json({ error: 'PROPERTY_NOT_FOUND' });
    const body = req.body || {};
    const patch = {};
    for (const key of FIELDS) {
      if (body[key] === undefined) continue;
      if (String(body[key]).length > arrivalFactsModel.MAX_LENGTH) {
        return res.status(422).json({ errors: { [key]: `${arrivalFactsModel.MAX_LENGTH} caractères au plus` } });
      }
      patch[key] = body[key];
    }
    model().save(req.params.id, patch);
    return res.json(model().forForm(req.params.id));
  }

  return { get, save };
}

module.exports = { buildController };
