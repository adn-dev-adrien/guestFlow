/**
 * Settings controller — orchestrates GET / PUT / logo upload / logo delete
 * for `/api/settings`.
 *
 * Owns:
 *  - Response shaping (delegated to utils/settingsResponse).
 *  - Input validation (delegated to utils/settingsValidation).
 *  - 3-way private key semantics (absent → preserve, "" → clear, non-empty → store).
 *  - Per-group, per-field "absent → preserve" semantics for `company` and `quote`.
 *  - Logo file lifecycle (the file itself; multer writes/owns the bytes).
 */

const path = require('path');
const fs = require('fs');

const settingsModel = require('../models/settingsModel');
const { shapeResponse } = require('../utils/settingsResponse');
const validation = require('../utils/settingsValidation');
const { uploadsDir } = require('../middleware/multerLogoUpload');

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
];

const QUOTE_FIELDS = [
  { input: 'footerText', column: 'quoteFooterText' },
  { input: 'validityDays', column: 'quoteValidityDays', validator: validation.validateQuoteValidityDays },
];

const GOOGLE_FIELDS = [
  { input: 'calendarId', column: 'googleCalendarId', validator: validation.validateCalendarId },
  { input: 'serviceAccountEmail', column: 'googleServiceAccountEmail', validator: validation.validateEmail },
  // privateKey is handled separately (3-way semantics).
];

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
  const google = pickGroup(body, 'googleCalendar');

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
        payload[column] = value;
      }
    }
  }

  applyGroup(company, COMPANY_FIELDS);
  applyGroup(quote, QUOTE_FIELDS);
  applyGroup(google, GOOGLE_FIELDS);

  // Google Calendar private key — 3-way semantics.
  if (google && Object.prototype.hasOwnProperty.call(google, 'privateKey')) {
    const raw = google.privateKey;
    if (raw === '' || raw == null) {
      // Explicit clear.
      payload.googleServiceAccountPrivateKey = '';
    } else {
      const err = validation.validatePrivateKey(raw);
      if (err) errors.googleServiceAccountPrivateKey = err;
      payload.googleServiceAccountPrivateKey = String(raw);
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ code: 'SETTINGS_INVALID', errors });
  }

  settingsModel.upsert(payload);
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

module.exports = {
  getSettings,
  updateSettings,
  uploadLogo,
  deleteLogo,
};
