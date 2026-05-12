const router = require('express').Router();
const db = require('../database');

function toSettingsPayload(row) {
  return {
    googleCalendarId: String(row.googleCalendarId || '').trim(),
    googleServiceAccountEmail: String(row.googleServiceAccountEmail || '').trim(),
    googleServiceAccountPrivateKey: String(row.googleServiceAccountPrivateKey || ''),
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
  };

  db.upsertAppSettings(payload);
  const settings = db.getAppSettings();
  return res.json(toSettingsPayload(settings));
});

module.exports = router;
