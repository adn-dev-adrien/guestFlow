// iCal controller — thin handlers over icalModel (public export + token lifecycle).

const model = require('../models/icalModel');

function exportUrl(token) {
  return `${process.env.BASE_URL || 'http://localhost:4000'}/api/ical/export/${token}`;
}

function token(req, res) {
  const propertyId = Number(req.params.propertyId);
  if (!model.propertyExists(propertyId)) return res.status(404).json({ error: 'Propriété introuvable' });
  try {
    const value = model.getOrCreateToken(propertyId);
    res.json({ token: value, url: exportUrl(value) });
  } catch (error) {
    // Don't leak the raw error to the client (it may include file paths or library internals).
    // Server-side log is the source of truth. Spotted in the 2026-06-01 security audit (M3).
    console.error('[icalController]', error);
    res.status(500).json({ error: 'Erreur interne' });
  }
}

function exportIcal(req, res) {
  const propertyId = model.findPropertyIdByToken(req.params.token);
  if (!propertyId) return res.status(404).json({ error: 'Token introuvable' });
  try {
    const icalData = model.exportProperty(propertyId);
    if (!icalData) return res.status(404).json({ error: 'Propriété introuvable' });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="calendar.ics"');
    res.send(icalData);
  } catch (error) {
    // Don't leak the raw error to the client (it may include file paths or library internals).
    // Server-side log is the source of truth. Spotted in the 2026-06-01 security audit (M3).
    console.error('[icalController]', error);
    res.status(500).json({ error: 'Erreur interne' });
  }
}

function regenerate(req, res) {
  const propertyId = Number(req.params.propertyId);
  if (!model.propertyExists(propertyId)) return res.status(404).json({ error: 'Propriété introuvable' });
  try {
    const value = model.regenerateToken(propertyId);
    res.json({ token: value, url: exportUrl(value) });
  } catch (error) {
    // Don't leak the raw error to the client (it may include file paths or library internals).
    // Server-side log is the source of truth. Spotted in the 2026-06-01 security audit (M3).
    console.error('[icalController]', error);
    res.status(500).json({ error: 'Erreur interne' });
  }
}

module.exports = { token, exportIcal, regenerate };
