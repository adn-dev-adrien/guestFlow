/**
 * Extra sales controller — HTTP face of `utils/extraSale.js` (specs/pricing-components.md §4.3).
 *
 *   POST  /api/reservations/:id/extras/quote        { requests, payment }                      priced, nothing written
 *   POST  /api/reservations/:id/extras              { requests, payment, acceptedTotalCents }  409 PRICE_CHANGED when the price moved
 *   PATCH /api/reservations/:id/extras/:ref         { collectAt?, offered?, discount?: { percent | amount }, forceOverpayment? }
 *   GET   /api/reservations/:id/sale-detail         the saleDetail payload
 * `ref` is `option:<lineId>`, `resource:<lineId>` or `custom:<lineId>`. Thin: parse, call the service, answer.
 */
const extraSale = require('../utils/extraSale');

const answer = (res, result) => (result.status === 200 ? res.json(result.saleDetail ? { saleDetail: result.saleDetail } : (({ status, ...rest }) => rest)(result)) : res.status(result.status).json(result.body));

module.exports = {
  quote(req, res) {
    const body = req.body || {};
    return answer(res, extraSale.quote(Number(req.params.id), body.requests, { payment: body.payment }));
  },

  sell(req, res) {
    const body = req.body || {};
    return answer(res, extraSale.sell(Number(req.params.id), body.requests, {
      source: 'fiche', payment: body.payment, acceptedTotalCents: body.acceptedTotalCents,
    }));
  },

  patchLine(req, res) {
    const body = req.body || {};
    return answer(res, extraSale.changeLine(Number(req.params.id), req.params.ref, {
      collectAt: body.collectAt, offered: body.offered, discount: body.discount,
    }, { forceOverpayment: Boolean(body.forceOverpayment) }));
  },

  saleDetail(req, res) {
    const detail = extraSale.saleDetailOf(Number(req.params.id));
    return detail ? res.json(detail) : res.status(404).json({ error: 'Réservation non trouvée' });
  },
};
