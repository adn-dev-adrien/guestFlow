/**
 * Clients model — sole DB access for `clients`.
 *
 * Stores a single `phone` per client. Encapsulates phone-aware search, normalized writes,
 * deletion-impact aggregation (the reservations + devis the FK cascade will remove, server-sorted with
 * computed `nights`), and orphan cleanup.
 *
 * Exports a default model bound to the production database, and a `create(db)` factory so tests can run
 * against an in-memory schema.
 */

const db = require('../database');
const { sentenceCase } = require('../utils/textFormatters');

const MS_PER_DAY = 86400000;

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

function computeNights(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  return Math.round((new Date(endDate) - new Date(startDate)) / MS_PER_DAY);
}

// Past stays last; upcoming/ongoing first, ordered by closeness to today (mirrors the former
// client-side sort, now authoritative on the server).
function compareByCurrentDate(a, b) {
  const today = todayKey();
  const aPast = a.endDate < today;
  const bPast = b.endDate < today;
  if (aPast !== bPast) return aPast ? 1 : -1;
  if (!aPast) {
    const aDist = Math.abs(new Date(a.startDate) - new Date(today));
    const bDist = Math.abs(new Date(b.startDate) - new Date(today));
    if (aDist !== bDist) return aDist - bDist;
    return String(a.startDate).localeCompare(String(b.startDate));
  }
  return String(b.endDate).localeCompare(String(a.endDate));
}

// Canonical, normalized client column values (single `phone`).
function buildClientFields(payload) {
  const streetNumber = String(payload.streetNumber || '').trim();
  const street = sentenceCase(payload.street);
  const address = sentenceCase(payload.address)
    || sentenceCase([streetNumber, street].filter(Boolean).join(' '));
  return {
    lastName: sentenceCase(payload.lastName),
    firstName: sentenceCase(payload.firstName),
    streetNumber,
    street,
    postalCode: String(payload.postalCode || '').trim(),
    city: sentenceCase(payload.city),
    address,
    phone: String(payload.phone || '').trim(),
    email: String(payload.email || '').trim(),
    notes: sentenceCase(payload.notes),
    // Per-client email language (specs/email-client-language-and-fiche-polish.md). Drives every email
    // for this client. 'en' or 'fr' (default).
    emailLanguage: String(payload.emailLanguage || '').toLowerCase() === 'en' ? 'en' : 'fr',
  };
}

function createModel(database) {
  // emailLanguage is optional in minimal/legacy schemas — include it in writes only when present.
  const HAS_EMAIL_LANGUAGE = (() => {
    try { return database.prepare('PRAGMA table_info(clients)').all().some((c) => c.name === 'emailLanguage'); }
    catch { return false; }
  })();
  function list(q) {
    if (q) {
      const s = `%${q}%`;
      return database.prepare(`
        SELECT * FROM clients
        WHERE lastName LIKE ? OR firstName LIKE ? OR email LIKE ? OR phone LIKE ?
          OR street LIKE ? OR city LIKE ? OR postalCode LIKE ?
        ORDER BY lastName, firstName
      `).all(s, s, s, s, s, s, s);
    }
    return database.prepare('SELECT * FROM clients ORDER BY lastName, firstName').all();
  }

  // specs/clients-upcoming-past-directory.md §3 — the Clients page's own read: each client with the
  // stay that qualifies it, the bucket it belongs to, the per-bucket counts of the current search, and
  // the ordering. All of it server-side; the page renders what it receives.
  //
  // Bucket rule: a client is « à venir » as soon as ONE stay has not ended yet (a guest currently in a
  // property is still in the operator's hands), and a client with no stay at all lands there too — the
  // list the operator works on never loses a row. Only `kind = 'reservation'` counts: a devis is not
  // a stay.
  const SORTABLE = new Set(['lastName', 'firstName', 'stayDate']);
  function directory({ q, bucket, sort, dir } = {}) {
    const today = todayKey();
    const search = String(q || '').trim();
    const like = `%${search}%`;
    const where = search
      ? `WHERE c.lastName LIKE ? OR c.firstName LIKE ? OR c.email LIKE ? OR c.phone LIKE ?
            OR c.street LIKE ? OR c.city LIKE ? OR c.postalCode LIKE ?`
      : '';
    const params = search ? [today, today, ...Array(7).fill(like)] : [today, today];
    const rows = database.prepare(`
      SELECT c.*,
        (SELECT MIN(r.startDate) FROM reservations r
          WHERE r.clientId = c.id AND r.kind = 'reservation' AND r.endDate >= ?) AS nextStayDate,
        (SELECT MAX(r.startDate) FROM reservations r
          WHERE r.clientId = c.id AND r.kind = 'reservation' AND r.endDate < ?) AS lastStayDate
      FROM clients c
      ${where}
    `).all(...params);

    const enriched = rows.map(({ nextStayDate, lastStayDate, ...client }) => ({
      ...client,
      bucket: (nextStayDate || !lastStayDate) ? 'upcoming' : 'past',
      stayDate: nextStayDate || lastStayDate || null,
    }));
    const counts = {
      upcoming: enriched.filter((c) => c.bucket === 'upcoming').length,
      past: enriched.filter((c) => c.bucket === 'past').length,
    };

    const activeBucket = bucket === 'past' ? 'past' : 'upcoming';
    // Default per bucket (§3.3 rule 6): the soonest arrival first, the most recent stay first.
    const sortCol = SORTABLE.has(sort) ? sort : 'stayDate';
    const direction = dir === 'asc' || dir === 'desc'
      ? dir
      : (activeBucket === 'past' ? 'desc' : 'asc');
    const factor = direction === 'desc' ? -1 : 1;
    const byName = (a, b) => String(a.lastName || '').localeCompare(String(b.lastName || ''), 'fr')
      || String(a.firstName || '').localeCompare(String(b.firstName || ''), 'fr')
      || a.id - b.id;
    const items = enriched
      .filter((c) => c.bucket === activeBucket)
      .sort((a, b) => {
        if (sortCol === 'stayDate') {
          // A client with no date is never « the smallest »: it sorts last in both directions.
          if (!a.stayDate || !b.stayDate) {
            if (a.stayDate === b.stayDate) return byName(a, b);
            return a.stayDate ? -1 : 1;
          }
          return factor * String(a.stayDate).localeCompare(String(b.stayDate)) || byName(a, b);
        }
        const primary = String(a[sortCol] || '').localeCompare(String(b[sortCol] || ''), 'fr');
        return factor * primary || byName(a, b);
      });

    return { items, counts };
  }

  function findById(id) {
    return database.prepare('SELECT * FROM clients WHERE id = ?').get(Number(id));
  }

  // Case-insensitive lookup by normalized email. Used by the public booking-request flow to
  // reuse an existing client instead of duplicating one (specs/public-api.md §3, Q3). Returns
  // the first match or undefined when the email is empty/unknown.
  function findByEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return undefined;
    return database.prepare('SELECT * FROM clients WHERE lower(trim(email)) = ? ORDER BY id LIMIT 1').get(normalized);
  }

  function insert(payload) {
    const fields = buildClientFields(payload);
    const cols = 'lastName, firstName, streetNumber, street, postalCode, city, address, phone, email, notes'
      + (HAS_EMAIL_LANGUAGE ? ', emailLanguage' : '');
    const vals = '@lastName, @firstName, @streetNumber, @street, @postalCode, @city, @address, @phone, @email, @notes'
      + (HAS_EMAIL_LANGUAGE ? ', @emailLanguage' : '');
    const result = database.prepare(`INSERT INTO clients (${cols}) VALUES (${vals})`).run(fields);
    return findById(result.lastInsertRowid);
  }

  function update(id, payload) {
    const fields = buildClientFields(payload);
    database.prepare(`
      UPDATE clients
      SET lastName=@lastName, firstName=@firstName, streetNumber=@streetNumber, street=@street,
          postalCode=@postalCode, city=@city, address=@address, phone=@phone, email=@email, notes=@notes,${HAS_EMAIL_LANGUAGE ? `
          emailLanguage=@emailLanguage,` : ''}
          updatedAt=datetime('now')
      WHERE id=@id
    `).run({ ...fields, id: Number(id) });
    return findById(id);
  }

  function remove(id) {
    // FK cascade removes the client's reservations + devis and all their child rows.
    database.prepare('DELETE FROM clients WHERE id = ?').run(Number(id));
  }

  function listReservationsForClient(clientId) {
    const rows = database.prepare(`
      SELECT r.id, r.clientId, r.propertyId, p.name AS propertyName, r.startDate, r.endDate,
        r.platform, r.finalPrice, r.adults, r.children, r.teens, r.babies
      FROM reservations r
      LEFT JOIN properties p ON p.id = r.propertyId
      WHERE r.kind = 'reservation' AND r.clientId = ?
    `).all(Number(clientId));
    return rows
      .map((r) => ({ ...r, nights: computeNights(r.startDate, r.endDate) }))
      .sort(compareByCurrentDate);
  }

  function listDevisForClient(clientId) {
    const rows = database.prepare(`
      SELECT d.id, d.clientId, d.propertyId, p.name AS propertyName, d.devisNumber, d.devisStatus AS status,
        d.startDate, d.endDate, d.finalPrice
      FROM reservations d
      LEFT JOIN properties p ON p.id = d.propertyId
      WHERE d.kind = 'devis' AND d.clientId = ?
    `).all(Number(clientId));
    return rows
      .map((d) => ({ ...d, nights: computeNights(d.startDate, d.endDate) }))
      .sort(compareByCurrentDate);
  }

  // What a deletion would cascade-remove: the client + its reservations and devis (server-shaped).
  function getDeleteImpact(id) {
    const client = database.prepare('SELECT id, firstName, lastName FROM clients WHERE id = ?').get(Number(id));
    if (!client) return null;
    const reservations = listReservationsForClient(id);
    const devis = listDevisForClient(id);
    return {
      client,
      reservationsCount: reservations.length,
      reservations,
      devisCount: devis.length,
      devis,
    };
  }

  // List clients with neither a reservation nor a devis — the candidates surfaced in the selective
  // cleanup popup. Same filter as the bulk `cleanupOrphans` (devis-linked clients are protected).
  function listOrphans() {
    return database.prepare(`
      SELECT c.id, c.firstName, c.lastName, c.email, c.phone
        FROM clients c
       WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.clientId = c.id)
       ORDER BY c.lastName, c.firstName
    `).all();
  }

  // Delete only the ids that are STILL orphan at this exact moment (re-checked per id to defuse the
  // race where a reservation is created between the popup's preview fetch and the user's Supprimer
  // click). Non-orphan / non-existent ids land in `skippedCount` — silent, no error.
  function cleanupOrphansByIds(rawIds) {
    const ids = Array.from(new Set(
      (Array.isArray(rawIds) ? rawIds : [])
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0),
    ));
    if (ids.length === 0) return { deletedCount: 0, skippedCount: 0 };

    const isOrphan = database.prepare(`
      SELECT 1 FROM clients c
       WHERE c.id = ?
         AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.clientId = c.id)
    `);
    const del = database.prepare('DELETE FROM clients WHERE id = ?');

    const tx = database.transaction((toDelete) => {
      let deletedCount = 0;
      let skippedCount = 0;
      for (const id of toDelete) {
        if (isOrphan.get(id)) {
          del.run(id);
          deletedCount += 1;
        } else {
          skippedCount += 1;
        }
      }
      return { deletedCount, skippedCount };
    });
    return tx(ids);
  }

  // Delete clients with neither a reservation nor a devis; report how many were kept for having a devis.
  function cleanupOrphans() {
    // devis are now reservations(kind='devis'); a client with any booking row (reservation or devis)
    // is kept. "Kept with devis" = no real reservation but at least one devis.
    const deletableRow = database.prepare(`
      SELECT COUNT(*) AS count FROM clients c
      WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.clientId = c.id)
    `).get();
    const keptRow = database.prepare(`
      SELECT COUNT(*) AS count FROM clients c
      WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.clientId = c.id AND r.kind = 'reservation')
        AND EXISTS (SELECT 1 FROM reservations r WHERE r.clientId = c.id AND r.kind = 'devis')
    `).get();
    const deletedCount = Number(deletableRow?.count || 0);
    const keptWithDevisCount = Number(keptRow?.count || 0);
    if (deletedCount > 0) {
      database.prepare(`
        DELETE FROM clients
        WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.clientId = clients.id)
      `).run();
    }
    return { deletedCount, keptWithDevisCount };
  }

  return {
    list,
    directory,
    findById,
    findByEmail,
    insert,
    update,
    remove,
    listReservationsForClient,
    listDevisForClient,
    getDeleteImpact,
    cleanupOrphans,
    listOrphans,
    cleanupOrphansByIds,
  };
}

const defaultModel = createModel(db);
defaultModel.create = createModel;

module.exports = defaultModel;
