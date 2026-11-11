#!/usr/bin/env node
/**
 * Lists the reservations whose client was overwritten through a client shared with other stays
 * (specs/booking-extranet-intake.md rule 28). Read-only: the database is opened `readonly`, nothing
 * is migrated, nothing is written.
 *
 *   node server/scripts/diagnose-shared-clients.js <path/to/guestflow.db> [--json]
 *
 * Safe on the live file as on a copy (`sqlite3 guestflow.db "VACUUM INTO '/tmp/copy.db'"`).
 *
 * Before rule 27, the Booking intake wrote the guest onto the fiche's client. When that client was the
 * placeholder every stay of the feed shared (« Closed Not available », « Reserved Ical »), every other
 * stay took the guest's name and e-mail. Filling such a client by hand in the fiche had the same effect.
 *
 * A suspect is a client that (a) at least two reservations use, (b) at least one of them came from an
 * iCal import, and (c) carries an e-mail or a phone, i.e. someone wrote a real guest onto it. For each
 * one the report lists the reservations, and which of them an applied Booking intake names as that
 * guest's, so the operator can give each other stay its own client again.
 *
 * Lives outside `src/` on purpose: it reads the plugin's own table, which no core file may name.
 */

const Database = require('better-sqlite3');

const tableExists = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const columnsOf = (db, table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
const parseJson = (raw) => { try { return JSON.parse(raw); } catch { return null; } };
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function appliedIntakesByReservation(db) {
  const out = new Map();
  if (!tableExists(db, 'booking_intakes')) return out;
  db.prepare("SELECT reservationId, resId, parsed, createdAt FROM booking_intakes WHERE status = 'applied' AND reservationId IS NOT NULL ORDER BY id")
    .all()
    .forEach((row) => {
      const guest = (parseJson(row.parsed) || {}).booking?.guest || {};
      out.set(Number(row.reservationId), {
        resId: row.resId,
        at: row.createdAt,
        guest: { firstName: guest.firstName || '', lastName: guest.lastName || '', email: guest.email || '' },
      });
    });
  return out;
}

/**
 * @returns {{ suspects: Array<{ client, reservations, owner }>, reservationCount: number }}
 *   `owner` is the reservation id an applied intake names as the client's guest (same e-mail), or null.
 */
function findOverwrittenClients(db) {
  const resCols = columnsOf(db, 'reservations');
  const kindFilter = resCols.has('kind') ? "AND r.kind = 'reservation'" : '';
  const number = resCols.has('reservationNumber') ? 'r.reservationNumber' : 'NULL';
  const gross = resCols.has('platformGrossAmount') ? 'r.platformGrossAmount' : 'NULL';
  const clients = db.prepare(`
    SELECT c.id, c.firstName, c.lastName, c.email, c.phone
    FROM clients c
    WHERE (trim(ifnull(c.email, '')) != '' OR trim(ifnull(c.phone, '')) != '')
      AND (SELECT COUNT(*) FROM reservations r WHERE r.clientId = c.id ${kindFilter}) >= 2
      AND EXISTS (SELECT 1 FROM reservations r WHERE r.clientId = c.id AND r.sourceType = 'ical' ${kindFilter})
    ORDER BY c.id
  `).all();
  const listReservations = db.prepare(`
    SELECT r.id, ${number} AS reservationNumber, r.startDate, r.endDate, r.platform, r.sourceType,
           ${gross} AS platformGrossAmount, p.name AS propertyName
    FROM reservations r LEFT JOIN properties p ON p.id = r.propertyId
    WHERE r.clientId = ? ${kindFilter}
    ORDER BY r.startDate, r.id
  `);
  const intakes = appliedIntakesByReservation(db);

  let reservationCount = 0;
  const suspects = clients.map((client) => {
    const reservations = listReservations.all(client.id).map((r) => ({ ...r, intake: intakes.get(Number(r.id)) || null }));
    reservationCount += reservations.length;
    const named = reservations.filter((r) => r.intake && same(r.intake.guest.email, client.email));
    return { client, reservations, owner: named.length ? Number(named[named.length - 1].id) : null };
  });
  return { suspects, reservationCount };
}

const fullName = (p) => [p.firstName, p.lastName].filter(Boolean).join(' ') || '—';

// The report the operator reads (French, the operator's language).
function formatReport({ suspects }) {
  if (suspects.length === 0) return 'Aucun client partagé portant les coordonnées d’un voyageur : rien à réparer.';
  const lines = [`${suspects.length} client(s) partagé(s) portant les coordonnées d’un voyageur :`, ''];
  suspects.forEach(({ client, reservations, owner }) => {
    lines.push(`Client ${client.id} — ${fullName(client)} — ${client.email || 'sans e-mail'}${client.phone ? ` — ${client.phone}` : ''}`);
    reservations.forEach((r) => {
      const tag = r.id === owner ? 'à garder (la saisie Booking nomme ce voyageur)'
        : r.intake ? `saisie Booking ${r.intake.resId} : ${fullName(r.intake.guest)} <${r.intake.guest.email}>`
          : 'à vérifier : fiche probablement d’un autre voyageur';
      lines.push(`  · fiche ${r.id}${r.reservationNumber ? ` (n° ${r.reservationNumber})` : ''} — ${r.propertyName || '?'} ${r.startDate} → ${r.endDate} — ${r.platform || '?'}${r.sourceType === 'ical' ? ', iCal' : ''} — ${tag}`);
    });
    lines.push('');
  });
  lines.push('Réparation : sur chaque fiche « à vérifier », choisir le bon client (ou en créer un) ; ne jamais modifier le client partagé lui-même.');
  return lines.join('\n');
}

module.exports = { findOverwrittenClients, formatReport };

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: node server/scripts/diagnose-shared-clients.js <guestflow.db> [--json]');
    process.exit(2);
  }
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const result = findOverwrittenClients(db);
    console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : formatReport(result));
  } finally {
    db.close();
  }
}
