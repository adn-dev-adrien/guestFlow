/**
 * The Sowel gate-keys connector, guestFlow's side (specs/gate-access-sowel-connector.md §3).
 *
 * The house pulls the list of keys and posts the outcomes back; guestFlow never opens a connection
 * towards it. Routes stay thin: the selection lives in utils/gateKeys.js, the outcomes and the
 * alerts in utils/gateResults.js.
 */

const gateKeysModel = require('../models/gateKeysModel');
const { buildKeyList, isStale } = require('../utils/gateKeys');
const gateResults = require('../utils/gateResults');

function buildController({
  model = () => gateKeysModel.model(),
  // Resolved lazily: the push service reaches the real database, which a test must never open.
  pushService = null,
  clock = () => new Date(),
  publicUrl = () => require('../models/settingsModel').publicUrl(),
} = {}) {
  return {
    /** GET /public/v1/gate/keys — rules 2-8. A successful read is stamped. */
    keys(_req, res) {
      const now = clock();
      const list = buildKeyList(model(), now);
      model().recordRead(now.toISOString());
      return res.json(list);
    },

    /** POST /public/v1/gate/results — rules 9-15. */
    async results(req, res) {
      const { status, body } = await gateResults.receiveResults(
        { model: model(), pushService: pushService || require('../utils/pushService'), now: clock() },
        req.body,
      );
      return res.status(status).json(body);
    },

    /** GET /public/v1/gate/ping — checks the key, the signature and the clock in one call. */
    ping(_req, res) {
      return res.json({ ok: true, now: clock().toISOString() });
    },

    /** GET /api/dashboard/gate-keys — the dashboard alert (admin-only by the role guard). */
    dashboard(_req, res) {
      return res.json(gateResults.dashboardAlerts({ model: model(), now: clock() }));
    },

    /** GET /api/settings/gate-connector — the settings card, without any secret value (rule 29). */
    settings(_req, res) {
      const configured = Boolean(
        String(process.env.GATE_API_KEY || '').trim() && String(process.env.GATE_SIGNING_SECRET || '').trim(),
      );
      const { lastReadAt } = model().readState();
      return res.json({
        configured,
        lastReadAt,
        stale: isStale(lastReadAt, clock()),
        keysCreated: model().countCreated(),
        secretsFile: 'server/.env.local',
        secretNames: ['GATE_API_KEY', 'GATE_SIGNING_SECRET'],
      });
    },

    /**
     * GET /api/settings/gate-connector/secrets — what the Sowel plugin's settings need, for an admin
     * to copy (rules 29b-29c). Admin-only by the role guard (/settings/* is on no other role's
     * allowlist), never cached, never logged.
     */
    secrets(req, res) {
      res.set('Cache-Control', 'no-store');
      return res.json({
        address: guestflowAddress({ publicUrl: publicUrl(), req }),
        apiKey: String(process.env.GATE_API_KEY || '').trim(),
        signingSecret: String(process.env.GATE_SIGNING_SECRET || '').trim(),
      });
    },
  };
}

/**
 * guestFlow's address as Sowel must call it (rule 29c): the configured public URL (Réglages →
 * Système → Adresse de l'application), else — when it was never typed — the origin the admin is
 * browsing from, flagged so the card can say it is a guess.
 */
function guestflowAddress({ publicUrl: configured, req }) {
  const url = String(configured || '').trim().replace(/\/+$/, '');
  if (url) return { value: url, source: 'setting' };
  const host = req && req.get ? req.get('host') : '';
  if (!host) return { value: '', source: 'none' };
  return { value: `${req.protocol}://${host}`, source: 'request' };
}

module.exports = buildController();
module.exports.buildController = buildController;
module.exports.guestflowAddress = guestflowAddress;
