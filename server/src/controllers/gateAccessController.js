// The operator's side of the gate access (specs/guest-gate-access.md §3.6).
//
// Read-and-two-buttons. Everything here runs behind the admin session guard, so it may say what the
// guest surface must not: the clear code, the devices, the whole journal.

const gateAccessModel = require('../models/gateAccessModel');
const { buildGateAccessCard } = require('../utils/gateAccessCard');

function getCard(req, res) {
  const card = buildGateAccessCard(req.params.id);
  if (!card) return res.status(404).json({ error: 'NO_GATE_ACCESS' });
  return res.json(card);
}

function regenerate(req, res) {
  const access = gateAccessModel.ensureForReservation(req.params.id);
  if (!access) return res.status(404).json({ error: 'NO_GATE_ACCESS' });
  gateAccessModel.regenerate(access.id);
  return res.json(buildGateAccessCard(req.params.id));
}

function revoke(req, res) {
  const access = gateAccessModel.getByReservation(req.params.id);
  if (!access) return res.status(404).json({ error: 'NO_GATE_ACCESS' });
  gateAccessModel.revoke(access.id);
  return res.json(buildGateAccessCard(req.params.id));
}

/** « Ouvrir l'accès maintenant » — for the guest who turned up three hours early. */
function earlyOpen(req, res) {
  const access = gateAccessModel.ensureForReservation(req.params.id);
  if (!access) return res.status(404).json({ error: 'NO_GATE_ACCESS' });
  gateAccessModel.markEarlyOpen(access.id);
  return res.json(buildGateAccessCard(req.params.id));
}

module.exports = { getCard, regenerate, revoke, earlyOpen };
