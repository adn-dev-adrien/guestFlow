/**
 * One placeholder client per iCal stay (specs/ical-import-hardening.md rule 1, data side).
 *
 * Until 2026-10-18 the iCal import reused one client per placeholder name: every Booking stay pointed at
 * the same « Closed Not available », every Airbnb stay at the same « Reserved Ical ». Anything written on
 * that client — by the Booking intake, or by hand on one fiche — landed on all of them. New imports get a
 * client of their own; this pass gives one to each stay imported before.
 *
 * It only touches a client that is plainly a placeholder: a name made of platform words only (rule 8),
 * no e-mail, no phone, no address, no note, and used by iCal stays only. A client carrying a guest's
 * coordinates is never split: which stay it belongs to is the operator's call
 * (`server/scripts/diagnose-shared-clients.js`). The first stay keeps the client; each other stay gets a
 * copy, and its history says so. Every such client is also renamed « Ical <platform> » (rule 8).
 *
 * Idempotent: once split and renamed, nothing matches any more. Runs at boot from database.js.
 */

const { parseGuestName, resolveIcalClientIdentity } = require('./icalParser');

const CONTACT_COLUMNS = ['email', 'phone', 'notes', 'address', 'street', 'streetNumber', 'postalCode', 'city'];

const isPlaceholderName = (client) => parseGuestName(`${client.firstName || ''} ${client.lastName || ''}`, '').isFallback;

const placeholderIdentity = (platform) => resolveIcalClientIdentity({ isFallback: true }, String(platform || '').trim() || 'Plateforme');

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {{ splitClients: number, movedReservations: number, renamedClients: number }}
 */
function splitSharedIcalPlaceholderClients(db) {
  const clientCols = new Set(db.prepare('PRAGMA table_info(clients)').all().map((c) => c.name));
  const resCols = new Set(db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name));
  const out = { splitClients: 0, movedReservations: 0, renamedClients: 0 };
  if (!clientCols.size || !resCols.has('sourceType')) return out;

  const empty = CONTACT_COLUMNS.filter((c) => clientCols.has(c)).map((c) => `trim(ifnull(c.${c}, '')) = ''`).join(' AND ');
  const candidates = db.prepare(`
    SELECT c.id, c.firstName, c.lastName
    FROM clients c
    WHERE ${empty}
      AND EXISTS (SELECT 1 FROM reservations r WHERE r.clientId = c.id)
      AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.clientId = c.id AND ifnull(r.sourceType, '') != 'ical')
    ORDER BY c.id
  `).all().filter(isPlaceholderName);
  if (candidates.length === 0) return out;

  const listStays = db.prepare('SELECT id, platform FROM reservations WHERE clientId = ? ORDER BY id');
  const rename = db.prepare("UPDATE clients SET firstName = ?, lastName = ?, updatedAt = datetime('now') WHERE id = ?");
  const insertClient = db.prepare("INSERT INTO clients (lastName, firstName, notes) VALUES (?, ?, '')");
  const relink = db.prepare("UPDATE reservations SET clientId = ?, updatedAt = datetime('now') WHERE id = ?");
  const hasHistory = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reservation_history'").get());
  const history = hasHistory
    ? db.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, 'update', ?)")
    : null;
  const label = (c) => `${c.firstName || ''} ${c.lastName || ''}`.trim();

  db.transaction(() => {
    candidates.forEach((client) => {
      const [first, ...others] = listStays.all(client.id);
      const kept = placeholderIdentity(first.platform);
      if (kept.firstName !== client.firstName || kept.lastName !== client.lastName) {
        rename.run(kept.firstName, kept.lastName, client.id);
        out.renamedClients += 1;
      }
      if (others.length > 0) out.splitClients += 1;
      others.forEach((stay) => {
        const identity = placeholderIdentity(stay.platform);
        const newId = Number(insertClient.run(identity.lastName, identity.firstName).lastInsertRowid);
        relink.run(newId, stay.id);
        if (history) {
          history.run(stay.id, JSON.stringify([{
            field: 'clientId', label: 'Client', from: label(client), to: `${identity.firstName} ${identity.lastName}`,
          }]));
        }
        out.movedReservations += 1;
      });
    });
  })();
  return out;
}

module.exports = { splitSharedIcalPlaceholderClients };
