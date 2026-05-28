/**
 * Devis controller — list / get / status / history / create / update / delete / convert flows / pdf.
 * Finance validation here; all DB access + shaping in `devisModel`; PDF rendering in `utils/devisPdf`.
 *
 * Exports a default controller bound to the production model, and a `buildController(model)` factory for
 * tests. (The factory is NOT named `create` — that's a request handler here.)
 */

const { validateFinanceInputs } = require('../utils/financeValidation');
const settingsModel = require('../models/settingsModel');
const { generateDevisPdf } = require('../utils/devisPdf');

function financeError(body) {
  return validateFinanceInputs({
    customPrice: { value: body.customPrice, kind: 'money' },
    depositAmount: { value: body.depositAmount, kind: 'money' },
    balanceAmount: { value: body.balanceAmount, kind: 'money' },
    discountPercent: { value: body.discountPercent, kind: 'percentage' },
  });
}

function createController(model) {
  // Maps a model result ({ ok, status?, data } | { error, status }) to an HTTP response.
  function respond(res, result) {
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    return res.status(result.status || 200).json(result.data);
  }

  function list(req, res) {
    return res.json(model.list(req.query));
  }

  function getOne(req, res) {
    const devis = model.findById(req.params.id);
    if (!devis) return res.status(404).json({ error: 'Devis non trouvé' });
    return res.json(devis);
  }

  function updateStatus(req, res) {
    return respond(res, model.updateStatus(req.params.id, req.body?.status));
  }

  function history(req, res) {
    const h = model.getHistory(req.params.id);
    if (h === null) return res.status(404).json({ error: 'Devis non trouvé' });
    return res.json(h);
  }

  function create(req, res) {
    const error = financeError(req.body);
    if (error) return res.status(400).json({ error });
    return respond(res, model.create(req.body));
  }

  function update(req, res) {
    const error = financeError(req.body);
    if (error) return res.status(400).json({ error });
    return respond(res, model.update(req.params.id, req.body));
  }

  function remove(req, res) {
    return respond(res, model.remove(req.params.id));
  }

  function convertToReservation(req, res) {
    return respond(res, model.convertToReservation(req.params.id));
  }

  function convertFromReservation(req, res) {
    return respond(res, model.convertFromReservation(req.params.reservationId));
  }

  async function pdf(req, res) {
    const full = model.findById(req.params.id);
    if (!full) return res.status(404).json({ error: 'Devis non trouvé' });
    try {
      const settings = settingsModel.read();
      const buf = await generateDevisPdf(full, settings);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="devis-${full.devisNumber}.pdf"`);
      res.setHeader('Content-Length', buf.length);
      return res.end(buf);
    } catch (err) {
      if (!res.headersSent) return res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
      return undefined;
    }
  }

  return {
    list, getOne, updateStatus, history, create, update, remove,
    convertToReservation, convertFromReservation, pdf,
  };
}

const defaultController = createController(require('../models/devisModel'));
defaultController.buildController = createController;

module.exports = defaultController;
