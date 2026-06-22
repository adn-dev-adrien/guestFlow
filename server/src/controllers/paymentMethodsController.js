/**
 * Payment-methods controller — CRUD over the direct-reservation payment-method catalogue.
 * Thin: validates the request shape, delegates the invariants (single default, deactivate-not-delete)
 * to paymentMethodsModel, maps the model's domain errors to HTTP status codes.
 *
 * Spec: specs/direct-payment-method-commission.md §3.1 / §4.3.
 */

const paymentMethodsModel = require('../models/paymentMethodsModel');

const ERROR_STATUS = {
  NAME_REQUIRED: [400, 'NAME_REQUIRED'],
  NAME_TAKEN: [409, 'NAME_TAKEN'],
  DEFAULT_NOT_DELETABLE: [409, 'DEFAULT_NOT_DELETABLE'],
  DEFAULT_NOT_DEACTIVATABLE: [409, 'DEFAULT_NOT_DEACTIVATABLE'],
};

function handleError(res, err) {
  const mapped = ERROR_STATUS[err && err.message];
  if (mapped) return res.status(mapped[0]).json({ error: mapped[1] });
  throw err;
}

function list(req, res) {
  const all = String(req.query.all || '') === '1' || req.query.all === 'true';
  res.json({ paymentMethods: all ? paymentMethodsModel.listAll() : paymentMethodsModel.listActive() });
}

function create(req, res) {
  try {
    const created = paymentMethodsModel.create(req.body || {});
    return res.status(201).json({ paymentMethod: created });
  } catch (err) {
    return handleError(res, err);
  }
}

function update(req, res) {
  try {
    const updated = paymentMethodsModel.update(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'PAYMENT_METHOD_NOT_FOUND' });
    return res.json({ paymentMethod: updated });
  } catch (err) {
    return handleError(res, err);
  }
}

function setDefault(req, res) {
  const updated = paymentMethodsModel.setDefault(req.params.id);
  if (!updated) return res.status(404).json({ error: 'PAYMENT_METHOD_NOT_FOUND' });
  return res.json({ paymentMethod: updated });
}

function setActive(req, res) {
  try {
    const updated = paymentMethodsModel.setActive(req.params.id, req.body && req.body.isActive);
    if (!updated) return res.status(404).json({ error: 'PAYMENT_METHOD_NOT_FOUND' });
    return res.json({ paymentMethod: updated });
  } catch (err) {
    return handleError(res, err);
  }
}

function remove(req, res) {
  try {
    const result = paymentMethodsModel.remove(req.params.id);
    if (!result) return res.status(404).json({ error: 'PAYMENT_METHOD_NOT_FOUND' });
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

module.exports = { list, create, update, setDefault, setActive, remove };
