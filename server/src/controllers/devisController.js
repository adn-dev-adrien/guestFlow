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

const { saveWithDraftClient } = require('../utils/draftClient');

function createController(model, {
  emitPluginEvent = require('../plugins/sdk/eventBus').emit,
  termsFicheBlock = (devis) => require('./termsController').buildFicheBlock(devis),
  onlinePayment = () => require('../utils/paymentProviders').summary(),
  frozenOptions = (devisId) => require('../utils/insuranceOffer').frozenOptions(require('../database'), devisId),
  frozenResources = (devisId) => require('../utils/resourceOffer').frozenResources(require('../database'), devisId),
} = {}) {
  // A refusal's body: its code, and the stays it names (specs/payment-link-lifecycle.md rule 46, DATES_HELD).
  const errorBody = (result) => ({ error: result.error, ...(result.code ? { code: result.code } : {}), ...(result.stays ? { stays: result.stays } : {}) });

  // Maps a model result ({ ok, status?, data } | { error, status }) to an HTTP response.
  function respond(res, result) {
    if (result.error) return res.status(result.status || 400).json(errorBody(result));
    return res.status(result.status || 200).json(result.data);
  }

  function list(req, res) {
    return res.json(model.list(req.query));
  }

  // Every admin read of one devis — the fiche, its PDF, its history, the extension preview — is the
  // operator handling it: the purge of untouched website requests skips it from then on
  // (specs/public-request-abuse-and-grouping.md rules 10, 17).
  const seen = (id) => { if (typeof model.markOperatorSeen === 'function') model.markOperatorSeen(id); };

  function getOne(req, res) {
    const devis = model.findById(req.params.id);
    if (!devis) return res.status(404).json({ error: 'Devis non trouvé' });
    seen(devis.id);
    // specs/terms-acceptance-record.md rules 21-22 — the CGV acceptance of a website request.
    // specs/plugins-phase-3a-online-payment.md rule 18 — the payment request button follows the provider.
    // specs/plugins-phase-3b-neat.md rule 22 — the options it carries that the catalogue hides, read-only;
    // specs/plugins-phase-3c-hourly-resources.md rule 18 — the same for the resources.
    return res.json({
      ...devis,
      cgv: termsFicheBlock(devis),
      onlinePayment: onlinePayment(),
      frozenOptions: frozenOptions(devis.id),
      frozenResources: frozenResources(devis.id),
    });
  }

  // specs/ui-review-2026-10-19-operations.md rule 20 — what « prolonger » would change, then the
  // extension itself. Both refuse a quote that is not an expired open one (409).
  function extensionPreview(req, res) {
    seen(req.params.id);
    return respond(res, model.previewExtension(req.params.id));
  }

  function extend(req, res) {
    return respond(res, model.extend(req.params.id));
  }

  function updateStatus(req, res) {
    return respond(res, model.updateStatus(req.params.id, req.body?.status));
  }

  function history(req, res) {
    const h = model.getHistory(req.params.id);
    if (h === null) return res.status(404).json({ error: 'Devis non trouvé' });
    seen(req.params.id);
    return res.json(h);
  }

  // A client typed on the devis is written with it (specs/clients.md rule 13).
  function create(req, res) {
    const error = financeError(req.body);
    if (error) return res.status(400).json({ error });
    if (!req.body || req.body.clientId || !req.body.newClient) return respond(res, model.create(req.body));
    const result = saveWithDraftClient({
      db: require('../database'),
      clientsModel: require('../models/clientsModel'),
      body: req.body,
      run: (body) => {
        const created = model.create(body);
        return created.error
          ? { status: created.status || 400, body: errorBody(created) }
          : { status: created.status || 200, body: created.data };
      },
    });
    return res.status(result.status).json(result.body);
  }

  // specs/reservation-fiche-concurrency.md rule 11 — the editor sends the `updatedAt` it loaded; a save
  // built on an older version would rewrite every column and erase what a guest's new request wrote.
  function update(req, res) {
    const error = financeError(req.body);
    if (error) return res.status(400).json({ error });
    const loaded = req.body && req.body.loadedUpdatedAt;
    if (loaded != null && loaded !== '') {
      const stored = model.storedVersion(req.params.id);
      if (stored != null && String(stored) !== String(loaded)) {
        return res.status(409).json({ error: 'Fiche modifiée entre-temps.', code: 'STALE_FICHE' });
      }
    }
    return respond(res, model.update(req.params.id, req.body));
  }

  async function remove(req, res) {
    const refusal = model.removeRefusal(req.params.id);
    if (refusal) return respond(res, refusal);
    try {
      await model.deactivateLinksBeforeRemove(req.params.id);
    } catch (err) {
      return res.status((err && err.httpStatus) || 500).json({ error: (err && err.message) || 'Suppression impossible.', code: (err && err.error) || 'DELETE_FAILED' });
    }
    return respond(res, model.remove(req.params.id));
  }

  function convertToReservation(req, res) {
    const result = model.convertToReservation(req.params.id);
    // The quote became a stay: plugins react after the response (specs/plugins-phase-1-sdk.md rule 9).
    if (result && result.ok && result.data && result.data.reservationId) {
      emitPluginEvent('reservation.created', { reservationId: result.data.reservationId });
    }
    return respond(res, result);
  }

  function convertFromReservation(req, res) {
    return respond(res, model.convertFromReservation(req.params.reservationId));
  }

  async function pdf(req, res) {
    const full = model.findById(req.params.id);
    if (!full) return res.status(404).json({ error: 'Devis non trouvé' });
    seen(full.id);
    try {
      const settings = settingsModel.read();
      // specs/devis-pdf-total-parity.md §3.1 rule 5 — the engine quote comes from the model's single
      // replay of the sold state (offered lines, price lock, auto-options, Complément routing), so
      // the PDF reads exactly what the fiche shows. Building the engine input here is what let the
      // printed total drift from the printed lines (§1). `null` on any failure → row fallback.
      const quote = model.recomputeQuote(req.params.id);
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
    list, getOne, updateStatus, history, create, update, remove, extensionPreview, extend,
    convertToReservation, convertFromReservation, pdf,
  };
}

const defaultController = createController(require('../models/devisModel'));
defaultController.buildController = createController;

module.exports = defaultController;
