/**
 * Daily purge of the website requests nobody acted on (specs/public-request-abuse-and-grouping.md
 * rule 10): 30 days after its creation, a site devis never opened, sent, edited, paid or converted by
 * the operator is deleted with its lines, history and CGV acceptance (devisModel.purgePublicRequest,
 * which re-checks « untouched » in its own transaction). The client created for it goes too, when it
 * holds no other reservation, devis or payment. Its number is retired, never handed out again.
 */

const sdk = require('../sdk');
const requestStore = require('./requestStore');

const KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Any row outside `clients` that names the client — a reservation, a devis, a guest e-mail sent to
// them — keeps it (cleanupOrphansByIds re-checks the reservations in its own transaction).
function namedElsewhere(db, clientId) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'clients' AND name NOT LIKE 'sqlite_%'").all()
    .map((t) => t.name)
    .filter((name) => db.prepare(`PRAGMA table_info("${name}")`).all().some((c) => c.name === 'clientId'));
  return tables.some((name) => db.prepare(`SELECT 1 FROM "${name}" WHERE clientId = ? LIMIT 1`).get(Number(clientId)));
}

/** → { deleted, clientsDeleted } */
function runRequestPurge({ now = Date.now(), db = sdk.coreModule('database'), devisModel = sdk.coreModule('devisModel'), clientsModel = sdk.coreModule('clientsModel') } = {}) {
  requestStore.ensureTables(db);
  const cutoff = new Date(now - KEEP_DAYS * DAY_MS).toISOString().slice(0, 19).replace('T', ' ');
  // 30 days from the guest's last request for the stay, not from the first one: a request updated
  // yesterday is not an old one (review of PR #805).
  const candidates = db.prepare(`
    SELECT r.id FROM reservations r
      LEFT JOIN public_request_stays s ON s.reservationId = r.id
     WHERE r.kind = 'devis' AND r.requestOrigin = 'public'
       AND COALESCE(r.devisStatus, 'draft') = 'draft'
       AND r.convertedReservationId IS NULL
       AND r.operatorSeenAt IS NULL
       AND COALESCE(s.lastRequestAt, r.createdAt) < ?
  `).all(cutoff).map((r) => r.id);

  let deleted = 0;
  let clientsDeleted = 0;
  candidates.forEach((id) => {
    const stay = requestStore.getStay(id, { db });
    const result = devisModel.purgePublicRequest(id);
    if (!result.deleted) return;
    deleted += 1;
    // Only the client this request created, and only while nothing else names it.
    if (stay && stay.createdClientId && Number(stay.createdClientId) === Number(result.clientId)
      && !namedElsewhere(db, result.clientId)) {
      clientsDeleted += clientsModel.cleanupOrphansByIds([result.clientId]).deletedCount;
    }
  });
  return { deleted, clientsDeleted };
}

module.exports = { runRequestPurge, KEEP_DAYS };
