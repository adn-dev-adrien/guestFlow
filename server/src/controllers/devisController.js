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
const { calculateReservationQuote } = require('../utils/pricing');
const db = require('../database');

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
      // §3.4 rules 15–17 — re-run the pricing engine against the persisted devis state so
      // the PDF can read the same breakdown PricingSummary shows on the live UI
      // (touristTaxUnitAmount × touristTaxAdultsCount × touristTaxNights). Without this the
      // PDF builds an incorrect detail string from `full.touristTaxRate`, which is the BASE
      // rate (percentage or fixed) — meaningless when the tax is percentage-based.
      const quote = (() => {
        try {
          return calculateReservationQuote({
            db,
            propertyId: Number(full.propertyId),
            startDate: full.startDate,
            endDate: full.endDate,
            checkInTime: full.checkInTime,
            checkOutTime: full.checkOutTime,
            adults: Number(full.adults || 0),
            children: Number(full.children || 0),
            teens: Number(full.teens || 0),
            babies: Number(full.babies || 0),
            discountPercent: Number(full.discountPercent || 0),
            customPrice: full.customPrice != null ? Number(full.customPrice) : undefined,
            selectedOptions: (full.options || []).filter((o) => !o.isCustom).map((o) => ({
              optionId: Number(o.optionId), quantity: Number(o.quantity || 1),
              unitPrice: o.unitPrice != null ? Number(o.unitPrice) : undefined,
            })),
            customOptions: (full.options || []).filter((o) => o.isCustom).map((o) => ({
              customKey: String(o.customOptionId || o.title || ''),
              description: o.title || o.description || '',
              amount: Number(o.amount ?? o.originalTotalPrice ?? o.totalPrice ?? 0),
              offered: Boolean(o.offered),
            })),
            selectedResources: (full.resources || []).map((r) => ({
              resourceId: Number(r.resourceId), quantity: Number(r.quantity || 1),
              unitPrice: r.unitPrice != null ? Number(r.unitPrice) : undefined, offered: Boolean(r.offered),
            })),
            platform: full.platform,
          });
        } catch { return null; /* engine failure is non-fatal — the PDF falls back to row values */ }
      })();
      const buf = await generateDevisPdf(full, settings, quote);
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
