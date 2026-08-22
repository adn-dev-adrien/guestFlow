/**
 * Settings controller — orchestrates GET / PUT / logo upload / logo delete
 * for `/api/settings`.
 *
 * Owns:
 *  - Response shaping (delegated to utils/settingsResponse).
 *  - Input validation (delegated to utils/settingsValidation).
 *  - 3-way masked-secret semantics (absent → preserve, "" → clear, non-empty → store).
 *  - Per-group, per-field "absent → preserve" semantics for `company` and `quote`.
 *  - Logo file lifecycle (the file itself; multer writes/owns the bytes).
 *
 * Google Calendar moved to its own controller/endpoints with the OAuth rework
 * (specs/google-calendar-oauth-rework.md) — no `googleCalendar` group here anymore.
 */

const path = require('path');
const fs = require('fs');

const settingsModel = require('../models/settingsModel');
const linenItemsModel = require('../models/linenItemsModel');
const repairAmountsModel = require('../models/repairAmountsModel');
const { shapeResponse } = require('../utils/settingsResponse');
const validation = require('../utils/settingsValidation');
const { uploadsDir } = require('../middleware/multerLogoUpload');
const { createEmailService } = require('../utils/emailService');
const emailAutoSendScheduler = require('../utils/emailAutoSendScheduler');

// Maps wrapped payload paths to DB column names + validators.
const COMPANY_FIELDS = [
  { input: 'name', column: 'companyName' },
  { input: 'address', column: 'companyAddress' },
  { input: 'email', column: 'companyEmail', validator: validation.validateEmail },
  { input: 'phone', column: 'companyPhone' },
  { input: 'siret', column: 'companySiret', validator: validation.validateSiret },
  { input: 'tva', column: 'companyTva', validator: validation.validateTvaIntracom },
  { input: 'iban', column: 'companyIban', validator: validation.validateIban },
  { input: 'bic', column: 'companyBic', validator: validation.validateBic },
  { input: 'bankName', column: 'companyBankName' },
  // Domain gate/access code shown on the arrival SAS (specs/arrival-departure-sas.md §3.5).
  { input: 'portalCode', column: 'portalCode' },
];

const QUOTE_FIELDS = [
  { input: 'footerText', column: 'quoteFooterText' },
  // English-language footer for the bilingual devis PDF (specs/devis-english-language.md §3 rule 11).
  { input: 'footerTextEn', column: 'quoteFooterTextEn' },
  { input: 'validityDays', column: 'quoteValidityDays', validator: validation.validateQuoteValidityDays },
];

// Single VAT rate (specs/single-vat-rate.md §4.1). Applied uniformly to accommodation,
// options, resources, custom options. Previously a 2-rate model (10 % accommodation / 20 %
// standard) — collapsed because every revenue stream on GuestFlow is invoiced at 10 %.
const VAT_FIELDS = [
  { input: 'rate', column: 'vatRate', validator: validation.validateVatRate },
  // accounting-platform-commission-and-no-deposit.md §3.7 rule 17b — sits alongside the
  // existing single VAT rate in the same Settings card.
  { input: 'rateCommission', column: 'vatRateCommission', validator: validation.validateVatRate },
  // specs/cancellation-compensation.md §3.3 rule 16 — 0 % by default: an indemnity paid after a
  // désistement is outside the scope of VAT. Same card, same validator as the other two rates.
  { input: 'rateCancellationCompensation', column: 'vatRateCancellationCompensation', validator: validation.validateVatRate },
];

// SMTP group (specs/admin-account-management.md). `password` is handled separately (3-way mask
// semantics, like the Google privateKey). `publicUrl` is part of the SMTP group on the client UX
// even though it lives in its own DB column — it's "the URL we put in the welcome email".
const SMTP_FIELDS = [
  { input: 'host', column: 'smtpHost' },
  { input: 'port', column: 'smtpPort', validator: validation.validateSmtpPort },
  { input: 'secure', column: 'smtpSecure' },
  { input: 'username', column: 'smtpUsername' },
  { input: 'fromEmail', column: 'smtpFromEmail', validator: validation.validateEmail },
  { input: 'fromName', column: 'smtpFromName', validator: validation.validateHeaderSafeText },
  { input: 'publicUrl', column: 'publicUrl', validator: validation.validatePublicUrl },
];

// Reservations group — single admin escape-hatch toggle for past reservations.
// See specs/admin-unlock-past-reservations.md.
const RESERVATIONS_FIELDS = [
  { input: 'allowEditPastReservations', column: 'allowEditPastReservations' },
];

// Booking-notifications group (specs/site-booking-notifications.md §4.3). `enabled` is a Switch
// (BOOL int); `recipientEmail` is optional (validateEmail accepts empty → falls back to the SMTP
// sender at send time). The email link reuses the SMTP group's `publicUrl`.
const NOTIFICATIONS_FIELDS = [
  { input: 'enabled', column: 'notificationsEnabled' },
  { input: 'icalReservationEnabled', column: 'notifyIcalReservationEnabled' },
  { input: 'recipientEmail', column: 'notificationRecipientEmail', validator: validation.validateEmail },
];

// Automatic guest email (specs/no-automatic-email-without-approval.md §4.3). Single master switch
// (BOOL int). OFF means GuestFlow only ever PROPOSES a guest email — the 08:00 cron sends nothing and
// the payment confirmation is queued for review instead of being mailed.
const EMAILS_FIELDS = [
  { input: 'autoSendEnabled', column: 'emailAutoSendEnabled' },
];

// Laundry group (specs/weekly-bed-linen-tracking.md). Single field: weekday index.
const LAUNDRY_FIELDS = [
  { input: 'weekday', column: 'laundryWeekday', validator: validation.validateLaundryWeekday },
];

// Linen-stock group (specs/linen-inventory-shortage-tracking.md §3.1). 6 integer counts ≥ 0,
// each capped at 999 by the validator. Stock is global across all properties.
const LINEN_STOCK_FIELDS = [
  { input: 'bedSingle',   column: 'bedLinenStockSingle', validator: validation.validateLinenStockCount },
  { input: 'bedDouble',   column: 'bedLinenStockDouble', validator: validation.validateLinenStockCount },
  { input: 'bedBaby',     column: 'bedLinenStockBaby',   validator: validation.validateLinenStockCount },
  { input: 'towelLarge',  column: 'towelStockLarge',     validator: validation.validateLinenStockCount },
  { input: 'towelMedium', column: 'towelStockMedium',    validator: validation.validateLinenStockCount },
  { input: 'towelSmall',  column: 'towelStockSmall',     validator: validation.validateLinenStockCount },
  { input: 'towelBathMat', column: 'towelStockBathMat',  validator: validation.validateLinenStockCount },
];

// Accounting group — the closing month driving every annual window of the Suivi financier
// (specs/fiscal-year-and-nights-sold.md §4.1).
const ACCOUNTING_FIELDS = [
  { input: 'fiscalYearEndMonth', column: 'fiscalYearEndMonth', validator: validation.validateFiscalYearEndMonth },
];

// Boolean-shaped columns stored as INTEGER 0/1 in SQLite. Listed once so applyGroup can
// coerce them consistently — any new BOOL column should go in here.
const BOOLEAN_INT_COLUMNS = new Set(['smtpSecure', 'allowEditPastReservations', 'notificationsEnabled', 'notifyIcalReservationEnabled', 'emailAutoSendEnabled']);

// Columns that must be coerced to a non-negative integer floor at the boundary (defensive
// against the form sending strings or decimals). The validator already rejects out-of-range
// values; the coercion here protects against malformed-but-in-range inputs.
const INTEGER_COUNT_COLUMNS = new Set([
  'bedLinenStockSingle', 'bedLinenStockDouble', 'bedLinenStockBaby',
  'towelStockLarge', 'towelStockMedium', 'towelStockSmall', 'towelStockBathMat',
]);

// Columns whose value ends up VERBATIM inside an email header — `From: "<name>" <address>` and
// `To: <address>` (specs/admin-account-management.md §3.4 rule 16b). `validateHeaderSafeText`
// rejects an interior control character above; the trim here removes the surrounding whitespace it
// deliberately tolerates, so a value pasted with a trailing newline can never reach the header.
const TRIMMED_TEXT_COLUMNS = new Set([
  'smtpFromName', 'smtpFromEmail', 'notificationRecipientEmail',
]);

function pickGroup(body, group) {
  const value = body && body[group];
  return value && typeof value === 'object' ? value : null;
}

function getSettings(req, res) {
  const row = settingsModel.read();
  return res.json(shapeResponse(row));
}

function updateSettings(req, res) {
  const body = req.body || {};
  const company = pickGroup(body, 'company');
  const quote = pickGroup(body, 'quote');
  const vat = pickGroup(body, 'vat');
  const accounting = pickGroup(body, 'accounting');
  const smtp = pickGroup(body, 'smtp');
  const reservations = pickGroup(body, 'reservations');
  const laundry = pickGroup(body, 'laundry');
  const linenStock = pickGroup(body, 'linenStock');
  const notifications = pickGroup(body, 'notifications');
  const emails = pickGroup(body, 'emails');
  const weather = pickGroup(body, 'weather');

  const payload = {};
  const errors = {};

  // Helper: applies a group of fields to the payload + runs validators.
  function applyGroup(input, schema) {
    if (!input) return;
    for (const { input: key, column, validator } of schema) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        const value = input[key];
        if (validator) {
          const err = validator(value);
          if (err) errors[column] = err;
        }
        // Boolean-shaped columns (smtpSecure, allowEditPastReservations…) come from a
        // Switch on the client; normalize to 0/1 for SQLite.
        if (BOOLEAN_INT_COLUMNS.has(column)) {
          payload[column] = (value === true || value === 1 || value === '1') ? 1 : 0;
        } else if (INTEGER_COUNT_COLUMNS.has(column)) {
          // Defensive coercion for the linen-stock columns: floor to a non-negative int even
          // when the form sends a string-decimal or a negative (the validator already runs
          // above, but the coercion here keeps the DB row clean if the validator path is
          // bypassed in a future refactor).
          payload[column] = Math.max(0, Math.floor(Number(value) || 0));
        } else if (TRIMMED_TEXT_COLUMNS.has(column)) {
          payload[column] = String(value == null ? '' : value).trim();
        } else {
          payload[column] = value;
        }
      }
    }
  }

  applyGroup(company, COMPANY_FIELDS);
  applyGroup(quote, QUOTE_FIELDS);
  applyGroup(vat, VAT_FIELDS);
  applyGroup(smtp, SMTP_FIELDS);
  applyGroup(reservations, RESERVATIONS_FIELDS);
  applyGroup(laundry, LAUNDRY_FIELDS);
  applyGroup(linenStock, LINEN_STOCK_FIELDS);
  applyGroup(notifications, NOTIFICATIONS_FIELDS);
  applyGroup(emails, EMAILS_FIELDS);
  applyGroup(accounting, ACCOUNTING_FIELDS);

  // `fiscalYearEndMonth` is NOT NULL: an empty/null value (a Select cleared client-side) must
  // preserve the stored month rather than write 0. A valid one is coerced to a plain integer.
  if (Object.prototype.hasOwnProperty.call(payload, 'fiscalYearEndMonth')) {
    const month = payload.fiscalYearEndMonth;
    if (month === '' || month == null) delete payload.fiscalYearEndMonth;
    else payload.fiscalYearEndMonth = Math.trunc(Number(month));
  }

  // SMTP password — 3-way semantics. Absent → preserve; '' → clear; non-empty → store.
  // Strip ALL whitespace before storing. Google App Passwords are displayed as 4 groups of 4 chars
  // separated by spaces (`abcd efgh ijkl mnop`); copy-pasting that verbatim breaks SMTP auth
  // because the transport sends the literal string with spaces. Pre-cleaning saves the admin from
  // a confusing "5.7.8 Username and Password not accepted" loop.
  if (smtp && Object.prototype.hasOwnProperty.call(smtp, 'password')) {
    const raw = smtp.password;
    payload.smtpPasswordEncrypted = raw == null ? '' : String(raw).replace(/\s+/g, '');
  }

  // Météo-France Vigilance API key — masked-secret 3-way (absent → preserve; '' → clear; non-empty →
  // store). Trim surrounding whitespace so a pasted key with a trailing newline still authenticates
  // (specs/checkin-weather-alerts.md §3 rule 10).
  if (weather && Object.prototype.hasOwnProperty.call(weather, 'apiKey')) {
    const raw = weather.apiKey;
    payload.meteoFranceApiKeyEncrypted = raw == null ? '' : String(raw).trim();
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ code: 'SETTINGS_INVALID', errors });
  }

  settingsModel.upsert(payload);

  // The 08:00 auto-send pass is scheduled only while the switch is on, so flipping it here is what
  // starts or stops the timer — no restart (specs/no-automatic-email-without-approval.md §3 rule 2b).
  // Turning it on also runs the day's pass straight away: the operator authorised the automation to
  // have today's mail leave today, not tomorrow.
  if (Object.prototype.hasOwnProperty.call(payload, 'emailAutoSendEnabled')) {
    emailAutoSendScheduler.syncWithSettings();
  }

  const row = settingsModel.read();
  return res.json(shapeResponse(row));
}

function uploadLogo(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier fourni.' });
  }
  const logoPath = `/uploads/${req.file.filename}`;
  settingsModel.updateLogoPath(logoPath);
  return res.json({ company: { logoPath } });
}

function deleteLogo(req, res) {
  const row = settingsModel.read();
  if (row.companyLogoPath) {
    const absPath = path.join(uploadsDir, path.basename(row.companyLogoPath));
    if (fs.existsSync(absPath)) {
      try { fs.unlinkSync(absPath); } catch (_) { /* best-effort */ }
    }
  }
  settingsModel.updateLogoPath('');
  return res.json({ company: { logoPath: '' } });
}

// POST /api/settings/smtp-test — sends "Email de test GuestFlow" to the current admin's email.
// Returns 200 { ok: true } on transport success, 400 with a code on configuration / transport
// failure. Used by the "Envoyer un mail de test" button on the SMTP card in /parametres.
async function sendSmtpTest(req, res) {
  if (!settingsModel.smtpConfigured()) {
    return res.status(400).json({ error: 'SMTP_NOT_CONFIGURED' });
  }
  const recipient = req.user && req.user.email;
  if (!recipient) {
    return res.status(400).json({ error: 'NO_RECIPIENT', detail: 'Aucune adresse email rattachée à votre compte.' });
  }
  try {
    const svc = createEmailService(settingsModel.decryptedSmtpSettings());
    await svc.sendTest(recipient);
    return res.json({ ok: true, recipient });
  } catch (err) {
    if (err && err.code === 'EMAIL_NOT_CONFIGURED') {
      return res.status(400).json({ error: 'SMTP_NOT_CONFIGURED' });
    }
    // Don't echo the raw transport error back (it can include hostnames, library versions,
    // file paths). Log server-side for diagnosis, send a stable error code to the client.
    // Spotted in the 2026-06-01 security audit (finding M3).
    console.error('[settingsController.sendSmtpTest]', err);
    return res.status(400).json({ error: 'SMTP_TEST_FAILED' });
  }
}

// Priced linen items (Réglages → Blanchisserie) — specs/arrival-departure-sas.md §3.4.
function getLinenItems(req, res) {
  return res.json(linenItemsModel.list());
}
function updateLinenItems(req, res) {
  const items = Array.isArray(req.body) ? req.body : (req.body && Array.isArray(req.body.items) ? req.body.items : null);
  if (!items) return res.status(400).json({ error: 'INVALID_PAYLOAD' });
  return res.json(linenItemsModel.replaceAll(items));
}

// Repair amounts (« Tarifs facturables ») — specs/extinguisher-seal-and-repair-amounts.md.
function getRepairAmounts(req, res) {
  return res.json(repairAmountsModel.list());
}
function updateRepairAmounts(req, res) {
  const items = Array.isArray(req.body) ? req.body : (req.body && Array.isArray(req.body.items) ? req.body.items : null);
  if (!items) return res.status(400).json({ error: 'INVALID_PAYLOAD' });
  return res.json(repairAmountsModel.replaceAll(items));
}

module.exports = {
  getSettings,
  updateSettings,
  uploadLogo,
  deleteLogo,
  sendSmtpTest,
  getLinenItems,
  updateLinenItems,
  getRepairAmounts,
  updateRepairAmounts,
};
