/**
 * VAT regime controller — GET state, POST preview, POST switch, DELETE an unused period
 * (specs/vat-optional-mode.md §4.3). Thin: validation and effects live in `vatRegimeSwitchModel`.
 * Admin only through the standard role guard, the accountant may read the state.
 */

const db = require('../database');
const switchModel = require('../models/vatRegimeSwitchModel');
const rules = require('../utils/vatRegime');

const accountingExportActive = () => {
  try { return Boolean(require('../plugins/sdk/registry').isLive('accounting-export')); } catch { return false; }
};

const REGIME_INPUT = ['regime', 'rate', 'legalMention', 'basis', 'effectiveFrom'];
const inputOf = (body) => Object.fromEntries(REGIME_INPUT.filter((k) => body && body[k] !== undefined).map((k) => [k, body[k]]));

function getState(req, res) {
  return res.json(switchModel.readState(db, { accountingExportActive: accountingExportActive() }));
}

function preview(req, res) {
  const result = switchModel.previewSwitch(db, inputOf(req.body));
  if (result.errors) return res.status(422).json({ errors: result.errors });
  const { ids, changedIds, ...figures } = result.preview;
  const active = accountingExportActive();
  return res.json({ ...figures, lines: rules.previewLines(inputOf(req.body), figures, { accountingExportActive: active, fromRegime: figures.fromRegime }), accountingExportActive: active });
}

function makeSwitch(req, res) {
  const body = req.body || {};
  const result = switchModel.applySwitch(db, inputOf(body), {
    userId: req.user ? req.user.id : null,
    fingerprint: body.fingerprint,
    acknowledged: body.acknowledged === true,
  });
  if (result.errors) return res.status(422).json({ errors: result.errors });
  if (result.stale) return res.status(409).json({ error: 'preview_stale' });
  return res.status(201).json({ period: result.period, reassigned: result.reassigned, notRepriced: result.notRepriced });
}

function remove(req, res) {
  const result = switchModel.deletePeriod(db, req.params.id);
  if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' });
  if (result.error === 'stay_settled') {
    return res.status(409).json({
      error: 'stay_settled',
      message: `Annulation impossible : ${result.stays.length > 1 ? 'des séjours recalculés par ce changement ont été payés ou déclarés' : 'un séjour recalculé par ce changement a été payé ou déclaré'} depuis (${result.stays.join(', ')}). Le retour en arrière passe par un nouveau changement.`,
      stays: result.stays,
    });
  }
  if (result.error) return res.status(409).json({ error: result.error });
  return res.status(204).end();
}

module.exports = { getState, preview, makeSwitch, remove };
