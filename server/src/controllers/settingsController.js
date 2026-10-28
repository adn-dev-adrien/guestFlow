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

const db = require('../database');
const settingsModel = require('../models/settingsModel');
const vatRegimeModel = require('../models/vatRegimeModel');
const vatRegime = require('../utils/vatRegime');
const { shapeResponse } = require('../utils/settingsResponse');
const validation = require('../utils/settingsValidation');
const { validateRevenueGoals, mergeRevenueGoals } = require('../utils/revenueGoals');
const { uploadsDir } = require('../middleware/multerLogoUpload');
const { createEmailService } = require('../utils/emailService');
const { resolveEmailIdentity } = require('../utils/emailIdentity');
const { createSmtpDetector, detectionMessage } = require('../utils/smtpPresets');

// specs/settings-rationalization.md rule 28 — DNS from the server; replaced by a stub in the suites.
let smtpDetector = createSmtpDetector();

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

// VAT (specs/single-vat-rate.md §4.1, specs/vat-optional-mode.md rules 3 and 9). The rate and the legal
// mention edit the period in force, never a settings column. The commission and cancellation-indemnity
// rates are edited on Plan comptable, next to the accounts that use them
// (specs/settings-rationalization.md rule 14).
function readVatGroup(vat, errors) {
  const change = {};
  if (!vat) return change;
  // The page sends its whole group back: a value that says nothing new (no mention, a rate of 0 under
  // « Sans TVA ») is not a change.
  if (Object.prototype.hasOwnProperty.call(vat, 'rate')) {
    const err = validation.validateVatRate(vat.rate);
    if (err) errors.vatRate = err;
    else change.rate = vat.rate === '' || vat.rate == null ? vatRegimeModel.DEFAULT_RATE : vatRegime.parseRate(vat.rate);
  }
  const mention = vat.legalMention;
  if (mention != null && mention !== '') {
    if (vatRegime.isMentionKey(mention)) change.legalMention = mention;
    else errors.legalMention = 'Mention inconnue.';
  }
  return change;
}

const VAT_REFUSALS = Object.freeze({
  rate: { field: 'vatRate', message: 'Sans TVA : pas de taux à modifier.' },
  legalMention: { field: 'legalMention', message: 'Assujetti à la TVA : pas de mention légale.' },
});

// SMTP group (specs/admin-account-management.md). `password` is handled separately (3-way mask
// semantics). `username`, `fromEmail` and `fromName` are overrides: '' means « derived from
// Établissement » (specs/settings-rationalization.md rule 12). `publicUrl` is shown on the Système
// page but stays in this group of the API.
const SMTP_FIELDS = [
  { input: 'host', column: 'smtpHost' },
  // No `port` entry on purpose: it follows `secure` (specs/settings-rationalization.md rule 11).
  { input: 'secure', column: 'smtpSecure' },
  { input: 'username', column: 'smtpUsername' },
  { input: 'fromEmail', column: 'smtpFromEmail', validator: validation.validateEmail },
  { input: 'fromName', column: 'smtpFromName', validator: validation.validateHeaderSafeText },
  { input: 'publicUrl', column: 'publicUrl', validator: validation.validatePublicUrl },
];

// Booking-notifications group (specs/site-booking-notifications.md §4.3). `enabled` is a Switch
// (BOOL int); `recipientEmail` is optional (validateEmail accepts empty → falls back to the SMTP
// sender at send time). The email link reuses the SMTP group's `publicUrl`.
const NOTIFICATIONS_FIELDS = [
  { input: 'enabled', column: 'notificationsEnabled' },
  { input: 'icalReservationEnabled', column: 'notifyIcalReservationEnabled' },
  { input: 'recipientEmail', column: 'notificationRecipientEmail', validator: validation.validateEmail },
];

// Guest email sequence copy (specs/guest-email-sequence.md §6.2). Whether an email leaves on its own
// is decided per template (specs/settings-rationalization.md rule 17b), not here.
const EMAILS_FIELDS = [
  { input: 'googleReviewUrl', column: 'googleReviewUrl', validator: validation.validatePublicUrl },
  { input: 'instagramUrl', column: 'instagramUrl', validator: validation.validatePublicUrl },
];
// The pool season moved to the property that has the pool (specs/guest-email-texts-made-simple.md rule 34).

// Accounting group — the closing month driving every annual window of the Suivi financier
// (specs/fiscal-year-and-nights-sold.md §4.1).
const ACCOUNTING_FIELDS = [
  { input: 'fiscalYearEndMonth', column: 'fiscalYearEndMonth', validator: validation.validateFiscalYearEndMonth },
];

// Boolean-shaped columns stored as INTEGER 0/1 in SQLite. Listed once so applyGroup can
// coerce them consistently — any new BOOL column should go in here.
const BOOLEAN_INT_COLUMNS = new Set(['smtpSecure', 'notificationsEnabled', 'notifyIcalReservationEnabled']);

// Columns whose value ends up VERBATIM inside an email header — `From: "<name>" <address>` and
// `To: <address>` (specs/admin-account-management.md §3.4 rule 16b). `validateHeaderSafeText`
// rejects an interior control character above; the trim here removes the surrounding whitespace it
// deliberately tolerates, so a value pasted with a trailing newline can never reach the header.
const TRIMMED_TEXT_COLUMNS = new Set([
  'smtpFromName', 'smtpFromEmail', 'notificationRecipientEmail',
  'googleReviewUrl', 'instagramUrl',
]);

function pickGroup(body, group) {
  const value = body && body[group];
  return value && typeof value === 'object' ? value : null;
}

function getSettings(req, res) {
  const row = settingsModel.read();
  return res.json(shapeResponse(row, process.env, vatRegimeModel.inForceBlock(db)));
}

/**
 * Rule 28 — the server, not the operator, fills an empty sending server, and only on the save that
 * brings a password (the operator's own server, never the platform's —
 * specs/hosting-h1-fleet-runtime.md rules 18–19): the provider found from the sending address gives
 * the host and the security. A host saved, typed or explicitly emptied (`host` in the payload) is
 * the operator's choice and always wins; a provider not found leaves the host empty, to be typed.
 */
function needsDetectedServer(stored, payload, smtp) {
  if (!smtp || Object.prototype.hasOwnProperty.call(smtp, 'host')) return '';
  if (String(stored.smtpHost || '').trim()) return '';
  if (!payload.smtpPasswordEncrypted) return '';
  return resolveEmailIdentity({ ...stored, ...payload }).fromEmail;
}

async function updateSettings(req, res) {
  const body = req.body || {};
  const company = pickGroup(body, 'company');
  const quote = pickGroup(body, 'quote');
  const vat = pickGroup(body, 'vat');
  const accounting = pickGroup(body, 'accounting');
  const smtp = pickGroup(body, 'smtp');
  const notifications = pickGroup(body, 'notifications');
  const emails = pickGroup(body, 'emails');

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
        // Boolean-shaped columns (smtpSecure, notificationsEnabled…) come from a
        // Switch on the client; normalize to 0/1 for SQLite.
        if (BOOLEAN_INT_COLUMNS.has(column)) {
          payload[column] = (value === true || value === 1 || value === '1') ? 1 : 0;
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
  const vatChange = readVatGroup(vat, errors);
  applyGroup(smtp, SMTP_FIELDS);
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

  // Revenue goals (specs/finance-dashboard-redesign.md rule 27): one error per exercise, keyed
  // `revenueGoals.<key>` so the form can put each message under its own field. The submitted
  // exercises are merged into the stored ones — an exercise left out keeps its goal.
  if (accounting && Object.prototype.hasOwnProperty.call(accounting, 'revenueGoals')) {
    const { goals, errors: goalErrors } = validateRevenueGoals(accounting.revenueGoals);
    for (const [key, message] of Object.entries(goalErrors)) errors[`revenueGoals.${key}`] = message;
    if (!Object.keys(goalErrors).length) {
      payload.revenueGoals = mergeRevenueGoals(settingsModel.read().revenueGoals, goals);
    }
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

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ code: 'SETTINGS_INVALID', errors });
  }

  const inForce = vatRegimeModel.inForce(db);
  const subject = !inForce || inForce.regime === vatRegime.REGIMES.SUBJECT;
  const refused = (subject && vatChange.legalMention !== undefined && 'legalMention')
    || (!subject && vatChange.rate !== undefined && vatChange.rate !== 0 && 'rate');
  if (!subject) delete vatChange.rate;
  if (subject) delete vatChange.legalMention;
  if (refused) {
    const { field, message } = VAT_REFUSALS[refused];
    return res.status(422).json({ code: 'SETTINGS_INVALID', errors: { [field]: message } });
  }

  const stored = settingsModel.read();
  // Rule 28 — host and password both emptied: back to no server of its own, security included.
  if (payload.smtpHost === '' && (payload.smtpPasswordEncrypted === '' || (!stored.smtpPasswordSet && payload.smtpPasswordEncrypted === undefined))) {
    payload.smtpSecure = 0;
  }
  const address = needsDetectedServer(stored, payload, smtp);
  if (address) {
    const found = await smtpDetector.detect(address);
    if (found.status === 'found') {
      payload.smtpHost = found.provider.host;
      payload.smtpSecure = found.provider.secure ? 1 : 0;
    }
  }

  let notRepriced = [];
  db.transaction(() => {
    // Rule 27 — the stored tourist tax of the period's stays follows the rate the same way a switch's does.
    if (vatChange.rate !== undefined) notRepriced = require('../models/vatRegimeSwitchModel').editRateInForce(db, vatChange.rate).notRepriced;
    if (vatChange.legalMention !== undefined) vatRegimeModel.setMentionInForce(db, vatChange.legalMention);
    settingsModel.upsert(payload);
  })();

  const row = settingsModel.read();
  // The push subject follows the company and sender addresses (specs/plugins-phase-p-productisation.md rule 18).
  if (company || smtp) require('../utils/vapid').ensureVapid(row);
  return res.json({ ...shapeResponse(row, process.env, vatRegimeModel.inForceBlock(db)), vatNotRepriced: notRepriced });
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

/**
 * POST /api/settings/smtp-detect { address? } — rule 28: what the Envoi card proposes for an address
 * (the typed one, else the sending address as saved). Never writes.
 *   → { address, found, provider: { id, name, host, secure, port, hint } | null, message }
 */
async function detectSmtp(req, res) {
  const typed = req.body && typeof req.body.address === 'string' ? req.body.address.trim() : '';
  const address = typed || resolveEmailIdentity(settingsModel.read()).fromEmail;
  const result = await smtpDetector.detect(address);
  return res.json({
    address,
    status: result.status,
    found: result.status === 'found',
    provider: result.status === 'found' ? result.provider : null,
    message: detectionMessage(result),
  });
}

module.exports = {
  detectSmtp,
  getSettings,
  updateSettings,
  uploadLogo,
  deleteLogo,
  sendSmtpTest,
  // exported for tests
  __test: {
    SMTP_FIELDS,
    setSmtpDetector(detector) { smtpDetector = detector; },
  },
};
