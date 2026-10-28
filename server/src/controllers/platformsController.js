/**
 * Platforms controller — exposes the canonical platform-name list consumed by the UI dropdowns
 * (reservation form platform <Select> + property iCal-source form). Thin: delegates the union /
 * dedup / sort to platformsModel.listNames(). See specs/ical-platforms-in-dropdowns.md.
 */

const platformsModel = require('../models/platformsModel');
const { isDirectChannel } = require('../utils/platformNameFormat');
const { parsePayoutDueDaysInput } = require('../utils/platformPayout');
const { PLATFORM_LIMITS, parseBoundedNumber, limitMessage } = require('../utils/inputLimits');

function listNames(req, res) {
  res.json({ platforms: platformsModel.listNames() });
}

// Non-direct platforms + their commission % (specs/platform-price-from-commission.md).
function listWithCommission(req, res) {
  res.json({ platforms: platformsModel.listWithCommission() });
}

// Set a platform's global commission % (refused outside [0, 99.99], never clamped —
// specs/settings-input-guards.md rule 30).
function setCommission(req, res) {
  const parsed = parseBoundedNumber(req.body && req.body.commissionPercent, PLATFORM_LIMITS.commissionPercent);
  if (parsed.error) return res.status(400).json({ error: limitMessage(PLATFORM_LIMITS.commissionPercent) });
  const updated = platformsModel.setCommissionPercent(req.params.id, parsed.value);
  if (!updated) return res.status(404).json({ error: 'PLATFORM_NOT_FOUND_OR_DIRECT' });
  return res.json({ id: updated.id, name: updated.name, commissionPercent: Number(updated.commissionPercent) || 0 });
}

// Set a platform's GLOBAL calendar colour (specs/platforms-and-ical-rework.md §3 rules 5-6). The
// `:key` is the platform label/name; an empty colour or the built-in brand colour clears the
// override. Upserts the platform so a never-used built-in can still be recoloured.
function setColor(req, res) {
  const key = decodeURIComponent(req.params.key || '');
  const updated = platformsModel.setColor(key, req.body && req.body.color);
  if (!updated) return res.status(400).json({ error: 'PLATFORM_REQUIRED' });
  return res.json({ name: updated.name, color: updated.color });
}

// `:key` is the platform label/name. Sets the GLOBAL tourist-tax mode (applies to every property).
// Body `{ touristTaxCollection: 'platform' | 'platform_reversed' | 'owner' }`.
function setTouristTax(req, res) {
  const key = decodeURIComponent(req.params.key || '');
  const mode = req.body && req.body.touristTaxCollection;
  if (!['platform', 'platform_reversed', 'owner'].includes(mode)) {
    return res.status(400).json({ error: 'INVALID_TOURIST_TAX_MODE' });
  }
  const updated = platformsModel.setTouristTaxCollection(key, mode);
  if (!updated) return res.status(400).json({ error: 'PLATFORM_REQUIRED' });
  return res.json({ name: updated.name, touristTaxCollection: updated.touristTaxCollection });
}

// specs/platform-deposit-toggle.md — set a platform's GLOBAL acompte flag. `:key` is the platform
// label/name. Body `{ takesDeposit: boolean }`. Applies to every property.
function setDepositMode(req, res) {
  const key = decodeURIComponent(req.params.key || '');
  const takesDeposit = req.body && req.body.takesDeposit;
  const updated = platformsModel.setDepositMode(key, takesDeposit);
  if (!updated) return res.status(400).json({ error: 'PLATFORM_REQUIRED' });
  return res.json({ name: updated.name, platformTakesDeposit: updated.platformTakesDeposit });
}

// specs/platform-payout-due-date.md §4.3 — set a platform's GLOBAL payout delay (days after the
// guest leaves before the transfer is considered late). `:key` is the platform label/name.
// Body `{ days: 0..365 }`. Own channels (`direct`, `Lodgify`) have no payout to wait for.
function setPayoutDueDays(req, res) {
  const key = decodeURIComponent(req.params.key || '');
  if (!key.trim()) return res.status(400).json({ error: 'PLATFORM_REQUIRED' });
  if (isDirectChannel(key)) return res.status(400).json({ error: 'DIRECT_CHANNEL' });
  const days = parsePayoutDueDaysInput(req.body && req.body.days);
  if (days === null) return res.status(400).json({ error: 'INVALID_DAYS' });
  const updated = platformsModel.setPayoutDueDays(key, days);
  if (!updated) return res.status(400).json({ error: 'PLATFORM_REQUIRED' });
  return res.json({ name: updated.name, payoutDueDays: updated.payoutDueDays });
}

const TOURIST_TAX_MODES = ['platform', 'platform_reversed', 'owner'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_REVIEW_WHERE = 80;

// GET /api/platforms/settings — the « Plateformes » settings page (specs/settings-rationalization.md
// rule 17): every per-platform commercial setting, in one list.
// A platform that appeared since the boot (a reservation, an intake, an import) is registered first,
// so it is on the page the moment it exists — not after a restart (specs/platforms-and-ical-rework.md rule 16).
function listSettings(req, res) {
  platformsModel.rescan();
  res.json({ platforms: platformsModel.listSettings(), limits: PLATFORM_LIMITS });
}

/**
 * Validates one row of the bulk update. Returns `{ errors, apply }`: `apply` is the list of
 * setter calls to run once EVERY row is valid, so a refused save writes nothing.
 */
function planRow(row, current) {
  const errors = {};
  const apply = [];
  const has = (key) => Object.prototype.hasOwnProperty.call(row, key);
  if (has('color')) {
    const color = String(row.color || '').trim();
    if (color && !HEX_COLOR.test(color)) errors.color = 'Couleur invalide.';
    else apply.push(() => platformsModel.setColor(current.name, color));
  }
  if (has('commissionPercent')) {
    const parsed = parseBoundedNumber(row.commissionPercent, PLATFORM_LIMITS.commissionPercent);
    if (parsed.error) errors.commissionPercent = limitMessage(PLATFORM_LIMITS.commissionPercent);
    else apply.push(() => platformsModel.setCommissionPercent(current.id, parsed.value));
  }
  if (!current.isDirect && has('takesDeposit')) {
    apply.push(() => platformsModel.setDepositMode(current.name, row.takesDeposit === true));
  }
  if (!current.isDirect && has('touristTaxCollection')) {
    if (!TOURIST_TAX_MODES.includes(row.touristTaxCollection)) errors.touristTaxCollection = 'Mode inconnu.';
    else apply.push(() => platformsModel.setTouristTaxCollection(current.name, row.touristTaxCollection));
  }
  // specs/plugins-phase-p-productisation.md rule 19 — `direct` always counts; the others by choice.
  if (!current.isDirect && has('countsAsDirect')) {
    apply.push(() => platformsModel.setCountsAsDirect(current.id, row.countsAsDirect === true));
  }
  // The own-channel guards below read the state AFTER this save: a row ticked « Compté comme vente
  // directe » in the same batch takes no platform rule (specs/airbnb-no-checkout-chores.md rule 10).
  const ownChannel = current.isDirect
    || (has('countsAsDirect') ? row.countsAsDirect === true : isDirectChannel(current.name));
  // specs/airbnb-no-checkout-chores.md rule 8 — a platform rule, so never on an own channel.
  if (!ownChannel && has('forbidsGuestChores')) {
    apply.push(() => platformsModel.setForbidsGuestChores(current.id, row.forbidsGuestChores === true));
  }
  // specs/platform-settings-relay-and-review.md rules 1-4 — guest-contact settings, never on an own channel.
  if (!ownChannel && has('relaysGuestEmail')) {
    apply.push(() => platformsModel.setRelaysGuestEmail(current.id, row.relaysGuestEmail === true));
  }
  if (!ownChannel && (has('reviewWhereFr') || has('reviewWhereEn'))) {
    const fr = has('reviewWhereFr') ? String(row.reviewWhereFr ?? '').trim() : current.reviewWhereFr;
    const en = has('reviewWhereEn') ? String(row.reviewWhereEn ?? '').trim() : current.reviewWhereEn;
    if (fr.length > MAX_REVIEW_WHERE) errors.reviewWhereFr = `${MAX_REVIEW_WHERE} caractères au plus.`;
    if (en.length > MAX_REVIEW_WHERE) errors.reviewWhereEn = `${MAX_REVIEW_WHERE} caractères au plus.`;
    if (fr.length <= MAX_REVIEW_WHERE && en.length <= MAX_REVIEW_WHERE) apply.push(() => platformsModel.setReviewWhere(current.id, { fr, en }));
  }
  if (!ownChannel && has('payoutDueDays')) {
    const days = parsePayoutDueDaysInput(row.payoutDueDays);
    if (days === null) errors.payoutDueDays = 'Un nombre entier de jours (0 à 365).';
    else apply.push(() => platformsModel.setPayoutDueDays(current.name, days));
  }
  return { errors, apply };
}

// PUT /api/platforms/settings — body `{ platforms: [{ id, color?, commissionPercent?, takesDeposit?,
// touristTaxCollection?, payoutDueDays?, countsAsDirect?, forbidsGuestChores?, relaysGuestEmail?,
// reviewWhereFr?, reviewWhereEn? }] }`. All rows are validated first; one invalid field
// refuses the whole save with `{ code: 'PLATFORMS_INVALID', errors: { [id]: { field: message } } }`.
function saveSettings(req, res) {
  const rows = req.body && Array.isArray(req.body.platforms) ? req.body.platforms : null;
  if (!rows) return res.status(400).json({ code: 'PLATFORMS_INVALID', errors: {} });
  const byId = new Map(platformsModel.listSettings().map((p) => [Number(p.id), p]));
  const errors = {};
  const actions = [];
  for (const row of rows) {
    const current = byId.get(Number(row && row.id));
    if (!current) {
      errors[String(row && row.id)] = { id: 'Plateforme inconnue.' };
      continue;
    }
    const plan = planRow(row, current);
    if (Object.keys(plan.errors).length) errors[String(current.id)] = plan.errors;
    actions.push(...plan.apply);
  }
  if (Object.keys(errors).length) return res.status(400).json({ code: 'PLATFORMS_INVALID', errors });
  actions.forEach((run) => run());
  platformsModel.refreshDirectChannels();
  platformsModel.refreshChoreFreeChannels();
  platformsModel.refreshGuestContactChannels();
  return res.json({ platforms: platformsModel.listSettings() });
}

module.exports = {
  listNames, listWithCommission, setCommission, setColor, setTouristTax, setDepositMode,
  setPayoutDueDays, listSettings, saveSettings,
};
