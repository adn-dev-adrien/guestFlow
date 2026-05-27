/**
 * School holidays controller — orchestrates list/create/update/delete, sync trigger,
 * and sync settings management. Wraps validation + locking semantics.
 */

const model = require('../models/schoolHolidaysModel');
const { sentenceCase } = require('../utils/textFormatters');
const { validatePeriod, validateSyncSettings } = require('../utils/schoolHolidaysValidation');
const { runSync } = require('../utils/schoolHolidaysSync');

function readPeriodBody(body = {}) {
  return {
    label: sentenceCase(body.label || ''),
    zoneA_start: body.zoneA_start || null,
    zoneA_end: body.zoneA_end || null,
    zoneB_start: body.zoneB_start || null,
    zoneB_end: body.zoneB_end || null,
    zoneC_start: body.zoneC_start || null,
    zoneC_end: body.zoneC_end || null,
  };
}

function readSyncSettingsBody(body = {}) {
  const toInt = (v) => {
    if (v === null || v === undefined || v === '') return NaN;
    const n = Number(v);
    return Number.isInteger(n) ? n : NaN;
  };
  return {
    syncIntervalDays: toInt(body.syncIntervalDays),
    syncHorizonMonths: toInt(body.syncHorizonMonths),
  };
}

function list(req, res) {
  const periods = model.list();
  const syncState = model.getSyncState();
  res.json({ periods, syncState });
}

function create(req, res) {
  const payload = readPeriodBody(req.body);
  const error = validatePeriod(payload);
  if (error) {
    return res.status(400).json({ error, code: 'INVALID_PERIOD' });
  }
  const { id } = model.insert(payload);
  res.json({ id });
}

function update(req, res) {
  const id = Number(req.params.id);
  const existing = model.findById(id);
  if (!existing) {
    return res.status(404).json({ error: 'Période introuvable.' });
  }
  const payload = readPeriodBody(req.body);
  const error = validatePeriod(payload);
  if (error) {
    return res.status(400).json({ error, code: 'INVALID_PERIOD' });
  }
  model.update(id, payload);
  // Lock the row from future auto-syncs if it was officially imported.
  if (existing.externalRef) {
    model.lock(id);
  }
  res.json({ ok: true });
}

function unlock(req, res) {
  const id = Number(req.params.id);
  const ok = model.unlock(id);
  if (!ok) {
    return res.status(404).json({ error: 'Période introuvable.' });
  }
  res.json({ ok: true });
}

function remove(req, res) {
  const id = Number(req.params.id);
  const ok = model.remove(id);
  if (!ok) {
    return res.status(404).json({ error: 'Période introuvable.' });
  }
  res.json({ ok: true });
}

async function sync(req, res) {
  try {
    const state = model.getSyncState();
    const result = await runSync({
      model,
      fetchFn: fetch,
      horizonMonths: state.syncHorizonMonths,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || 'Erreur de synchronisation.') });
  }
}

function getSyncSettings(req, res) {
  const state = model.getSyncState();
  res.json({
    syncIntervalDays: state.syncIntervalDays,
    syncHorizonMonths: state.syncHorizonMonths,
  });
}

function updateSyncSettings(req, res) {
  const settings = readSyncSettingsBody(req.body);
  const error = validateSyncSettings(settings);
  if (error) {
    return res.status(400).json({ error, code: 'INVALID_SYNC_SETTINGS' });
  }
  model.updateSyncSettings(settings);
  res.json({ ok: true, ...settings });
}

module.exports = {
  list,
  create,
  update,
  unlock,
  remove,
  sync,
  getSyncSettings,
  updateSyncSettings,
};
