/**
 * One-shot validity of the links already open at the upgrade (specs/payment-link-lifecycle.md rule 34).
 *
 * Before this version a link never expired (Qonto answers its zero-time sentinel `0001-01-01…`). Each
 * open link gets `expiresAt = max(createdAt + 36 h, installedAt + 36 h)`, `installedAt` being this run:
 * the guest who holds it keeps 36 hours from the install, then the lifecycle pass lapses it (rule 7).
 * Every type is concerned, `complement` included (rule 6 covers every link). No network call.
 * Idempotent via `migrations`.
 */

const { PAYMENT_LINK_VALIDITY_HOURS } = require('../constants/paymentLinks');

// Not the model's parser: database.js runs this while it loads, and the model requires the database.
// SQLite's datetime('now') is UTC with no zone marker.
const parseTimestampMs = (value) => {
  const text = String(value == null ? '' : value).trim();
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text) ? `${text.replace(' ', 'T')}Z` : text);
  return Number.isNaN(ms) ? null : ms;
};

const MIGRATION_NAME = 'payment_link_validity_backfill_v1';
const VALIDITY_MS = PAYMENT_LINK_VALIDITY_HOURS * 60 * 60 * 1000;

function runPaymentLinkValidityBackfill(database, { now = new Date(), logger = console } = {}) {
  if (database.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION_NAME)) return { ran: false, backfilled: [] };
  const graceMs = now.getTime() + VALIDITY_MS;
  const backfilled = database.transaction(() => {
    const open = database.prepare("SELECT id, type, createdAt FROM payment_links WHERE status = 'open' ORDER BY id").all();
    const set = database.prepare("UPDATE payment_links SET expiresAt = ? WHERE id = ? AND status = 'open'");
    const done = [];
    for (const link of open) {
      const createdMs = parseTimestampMs(link.createdAt);
      const expiresAt = new Date(Math.max(graceMs, createdMs == null ? 0 : createdMs + VALIDITY_MS)).toISOString();
      if (Number(set.run(expiresAt, link.id).changes) > 0) done.push({ id: link.id, type: link.type, expiresAt });
    }
    database.prepare('INSERT INTO migrations (name) VALUES (?)').run(MIGRATION_NAME);
    return done;
  })();
  for (const link of backfilled) logger.log(`[migration:link-validity] link #${link.id} (${link.type}) expires ${link.expiresAt}`);
  return { ran: true, backfilled };
}

module.exports = { runPaymentLinkValidityBackfill, MIGRATION_NAME };
