// iCal controller — thin handlers over icalModel (public export + token lifecycle).

const model = require('../models/icalModel');

// L'URL affichee a l'operateur est derivee de la REQUETE, pas d'un BASE_URL fige.
// BASE_URL n'a jamais ete defini en production (ni sur le Pi, ni sur la VM) : l'interface
// affichait donc `http://localhost:4000/...`, inutilisable tel quel. Bug de longue date,
// revele lors de la migration du 2026-08-19.
// Deriver de la requete est aussi ce qui convient pendant la transition
// guestflow.domainesolio.com -> guestflow.adn-dev.fr : le lien affiche correspond toujours
// au nom que l'operateur est en train de consulter.
// `req.protocol` respecte X-Forwarded-Proto parce que `trust proxy` est desormais arme
// derriere Caddy (TRUST_PROXY_HOPS) — sans quoi on afficherait `http://` au lieu de `https://`.
// BASE_URL reste prioritaire, comme echappatoire explicite si l'URL publique differe.
function exportUrl(req, token) {
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/api/ical/export/${token}`;
}

function token(req, res) {
  const propertyId = Number(req.params.propertyId);
  if (!model.propertyExists(propertyId)) return res.status(404).json({ error: 'Propriété introuvable' });
  try {
    const value = model.getOrCreateToken(propertyId);
    res.json({ token: value, url: exportUrl(req, value) });
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
    res.json({ token: value, url: exportUrl(req, value) });
  } catch (error) {
    // Don't leak the raw error to the client (it may include file paths or library internals).
    // Server-side log is the source of truth. Spotted in the 2026-06-01 security audit (M3).
    console.error('[icalController]', error);
    res.status(500).json({ error: 'Erreur interne' });
  }
}

module.exports = { token, exportIcal, regenerate };
