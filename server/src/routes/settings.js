const router = require('express').Router();
const db = require('../database');

function toSettingsPayload(row) {
  return {
    googleCalendarId: String(row.googleCalendarId || '').trim(),
    googleServiceAccountEmail: String(row.googleServiceAccountEmail || '').trim(),
    googleServiceAccountPrivateKey: String(row.googleServiceAccountPrivateKey || ''),
    companyName: String(row.companyName || '').trim(),
    companyAddress: String(row.companyAddress || '').trim(),
    companySiret: String(row.companySiret || '').trim(),
    companyTva: String(row.companyTva || '').trim(),
    companyIban: String(row.companyIban || '').trim(),
    companyBic: String(row.companyBic || '').trim(),
    companyBankName: String(row.companyBankName || '').trim(),
    quoteFooterText: String(row.quoteFooterText || ''),
    updatedAt: row.updatedAt || null,
  };
}

router.get('/', (req, res) => {
  const settings = db.getAppSettings();
  return res.json(toSettingsPayload(settings));
});

router.put('/', (req, res) => {
  const payload = {
    googleCalendarId: String(req.body.googleCalendarId || '').trim(),
    googleServiceAccountEmail: String(req.body.googleServiceAccountEmail || '').trim(),
    googleServiceAccountPrivateKey: String(req.body.googleServiceAccountPrivateKey || ''),
    companyName: String(req.body.companyName || '').trim(),
    companyAddress: String(req.body.companyAddress || '').trim(),
    companySiret: String(req.body.companySiret || '').trim(),
    companyTva: String(req.body.companyTva || '').trim(),
    companyIban: String(req.body.companyIban || '').trim(),
    companyBic: String(req.body.companyBic || '').trim(),
    companyBankName: String(req.body.companyBankName || '').trim(),
    quoteFooterText: String(req.body.quoteFooterText || ''),
  };

  db.upsertAppSettings(payload);
  const settings = db.getAppSettings();
  return res.json(toSettingsPayload(settings));
});

module.exports = router;
