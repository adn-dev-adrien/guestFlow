/**
 * The connector, guestFlow's side (specs/gate-access-sowel-connector.md §3).
 *
 * Three routes and not one more. guestFlow decides nothing about the gate: it publishes its stays
 * and files away what the house hands back. Anything that looks like a rule — a window, a code, a
 * suspension — belongs to the `sowel-plugin-guest-access` plugin.
 */

const stayFeed = require('../utils/gateStayFeed');
const invitations = require('../models/gateInvitationModel');

/** GET /public/v1/gate/stays?since=&limit= — the feed, from the house's cursor. */
function stays(req, res) {
  const page = stayFeed.feed().readSince(req.query.since, req.query.limit);
  return res.json(page);
}

/**
 * POST /public/v1/gate/invitations — what the house minted for each stay.
 *
 * The batch is taken whole or not at all: a partial answer would let the house believe everything
 * went through, and the next push would not carry it again.
 */
function receiveInvitations(req, res) {
  const list = Array.isArray(req.body && req.body.invitations) ? req.body.invitations : null;
  if (!list) {
    return res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'invitations[] attendu.' },
    });
  }
  if (list.length > 500) {
    return res.status(413).json({
      error: { code: 'TOO_MANY', message: 'Trop d’invitations en un seul envoi.' },
    });
  }

  const model = invitations.model();
  let stored = 0;
  for (const invitation of list) {
    if (invitation && model.upsert(invitation)) stored++;
  }
  return res.json({ stored, received: list.length });
}

/** GET /public/v1/gate/ping — enough to check the key, the signature and the clock in one call. */
function ping(_req, res) {
  return res.json({
    ok: true,
    now: new Date().toISOString(),
    invitations: invitations.model().count(),
  });
}

module.exports = { stays, receiveInvitations, ping };
