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

const {
  carriesMoney, removesProtectedHistory, idsOfOwner, withConvertedDevis, CLIENT_MONEY_MESSAGE, CLIENT_HISTORY_MESSAGE,
} = require('../utils/deletionGuard');
const { todayIso: localTodayIso } = require('../utils/localDate');
const db = require('../database');
const { sentenceCase, capitalizeFirst, personNameCase } = require('../utils/textFormatters');
const { clientWhenLabel, stayDatesLabel } = require('../utils/clientWhenLabel');

const MS_PER_DAY = 86400000;

function todayKey() {
  return localTodayIso();
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
    lastName: personNameCase(payload.lastName),
    firstName: personNameCase(payload.firstName),
    streetNumber,
    street,
    postalCode: String(payload.postalCode || '').trim(),
    city: sentenceCase(payload.city),
    address,
    phone: String(payload.phone || '').trim(),
    email: String(payload.email || '').trim(),
    notes: capitalizeFirst(payload.notes),
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
  // specs/guest-email-sequence.md rule 10 — optional in minimal schemas, like emailLanguage.
  const HAS_POST_STAY_FLAG = (() => {
    try { return database.prepare('PRAGMA table_info(clients)').all().some((c) => c.name === 'postStayEmailsDisabled'); }
    catch { return false; }
  })();
  // Written only when the payload carries the field: an older form that doesn't send it keeps the
  // stored value.
  function writePostStayFlag(id, payload) {
    if (!HAS_POST_STAY_FLAG || !payload || !Object.prototype.hasOwnProperty.call(payload, 'postStayEmailsDisabled')) return;
    const value = payload.postStayEmailsDisabled === true || payload.postStayEmailsDisabled === 1 || payload.postStayEmailsDisabled === '1' ? 1 : 0;
    database.prepare('UPDATE clients SET postStayEmailsDisabled = ? WHERE id = ?').run(value, Number(id));
  }

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

  // specs/clients-upcoming-past-directory.md §3 — the Clients page's own read (rules 11-22): each client
  // resolved into ONE view (upcoming / past / none), the stay that qualifies it, the groups the page
  // renders, the counts and the order of the current search. All of it server-side.
  //
  // Only `kind = 'reservation'` is a stay (a devis is not, and a cancelled stay walks `kind` to
  // 'cancelled'). Two reads — every stay, every devis — regardless of the number of clients.
  const VIEWS = ['upcoming', 'past', 'none'];
  const UPCOMING_GROUPS = [
    ['inStay', 'En séjour'], ['next7', '7 prochains jours'], ['next30', '30 prochains jours'], ['later', 'Plus tard'],
  ];
  const NONE_GROUPS = [['devis', 'Devis en cours'], ['nothing', 'Aucune réservation']];
  const collator = new Intl.Collator('fr');
  const compareNames = (a, b) => collator.compare(a.lastName || '', b.lastName || '')
    || collator.compare(a.firstName || '', b.firstName || '')
    || a.id - b.id;

  function addDays(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function upcomingGroupKey(stay, today) {
    if (stay.startDate <= today) return 'inStay';
    if (stay.startDate <= addDays(today, 7)) return 'next7';
    if (stay.startDate <= addDays(today, 30)) return 'next30';
    return 'later';
  }

  function directory({ q, view, bucket, sort, dir, today = todayKey() } = {}) {
    const search = String(q || '').trim();
    const like = `%${search}%`;
    const where = search
      ? `WHERE lastName LIKE ? OR firstName LIKE ? OR email LIKE ? OR phone LIKE ?
            OR street LIKE ? OR city LIKE ? OR postalCode LIKE ?`
      : '';
    const clients = database.prepare(`SELECT * FROM clients ${where}`).all(...(search ? Array(7).fill(like) : []));

    const staysByClient = new Map();
    for (const r of database.prepare(`
      SELECT r.id, r.clientId, r.startDate, r.endDate, r.platform, p.name AS propertyName
      FROM reservations r LEFT JOIN properties p ON p.id = r.propertyId
      WHERE r.kind = 'reservation' AND r.clientId IS NOT NULL
    `).all()) {
      if (!staysByClient.has(r.clientId)) staysByClient.set(r.clientId, []);
      staysByClient.get(r.clientId).push(r);
    }
    const devisByClient = new Map();
    for (const d of database.prepare(`
      SELECT id, clientId, devisNumber AS number, devisStatus AS status FROM reservations
      WHERE kind = 'devis' AND clientId IS NOT NULL AND COALESCE(devisStatus, 'draft') IN ('draft', 'sent', 'accepted') ORDER BY id
    `).all()) devisByClient.set(d.clientId, d);

    const enriched = clients.map((client) => {
      const stays = staysByClient.get(client.id) || [];
      const upcoming = stays.filter((s) => s.endDate >= today)
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id - b.id);
      const past = stays.filter((s) => s.endDate < today)
        .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id - a.id);
      const qualifying = upcoming[0] || past[0] || null;
      const clientBucket = upcoming.length ? 'upcoming' : (past.length ? 'past' : 'none');
      const latestDevis = devisByClient.get(client.id) || null;
      return {
        ...client,
        bucket: clientBucket,
        stayDate: qualifying ? qualifying.startDate : null,
        stay: qualifying && {
          reservationId: qualifying.id,
          propertyName: qualifying.propertyName || '',
          startDate: qualifying.startDate,
          endDate: qualifying.endDate,
          nights: computeNights(qualifying.startDate, qualifying.endDate),
          platform: qualifying.platform || '',
          datesLabel: stayDatesLabel(qualifying),
        },
        inStay: clientBucket === 'upcoming' && qualifying.startDate < today,
        stayCount: stays.length,
        hasDevis: Boolean(latestDevis),
        whenLabel: clientWhenLabel(clientBucket, qualifying, latestDevis, client.createdAt, today),
      };
    });

    const counts = Object.fromEntries(VIEWS.map((v) => [v, enriched.filter((c) => c.bucket === v).length]));
    const activeView = VIEWS.includes(view) ? view : (VIEWS.includes(bucket) ? bucket : 'upcoming');
    const byName = sort === 'name' || sort === 'lastName' || sort === 'firstName';
    const defaultDir = activeView === 'upcoming' ? 'asc' : 'desc';
    const direction = dir === 'asc' || dir === 'desc' ? dir : (byName ? 'asc' : defaultDir);
    const reverse = byName ? direction === 'desc' : direction !== defaultDir;

    const inView = enriched.filter((c) => c.bucket === activeView);
    const compareDefault = activeView === 'none'
      ? (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || compareNames(a, b)
      : (a, b) => (activeView === 'upcoming' ? 1 : -1) * a.stayDate.localeCompare(b.stayDate) || compareNames(a, b);
    const ordered = inView.sort(byName ? compareNames : compareDefault);

    let groups;
    if (byName) {
      groups = [{ key: 'all', label: '', items: ordered }];
    } else {
      const bucketOf = {
        upcoming: (c) => upcomingGroupKey(c.stay, today),
        past: (c) => `y${c.stay.startDate.slice(0, 4)}`,
        none: (c) => (c.hasDevis ? 'devis' : 'nothing'),
      }[activeView];
      const labels = activeView === 'upcoming' ? UPCOMING_GROUPS : NONE_GROUPS;
      const byKey = new Map();
      for (const c of ordered) {
        const key = bucketOf(c);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(c);
      }
      const keys = activeView === 'past'
        ? [...byKey.keys()]
        : labels.map(([key]) => key).filter((key) => byKey.has(key));
      groups = keys.map((key) => ({
        key,
        label: activeView === 'past' ? key.slice(1) : labels.find(([k]) => k === key)[1],
        items: byKey.get(key),
      }));
    }
    if (reverse) groups = groups.reverse().map((g) => ({ ...g, items: [...g.items].reverse() }));
    groups = groups.map((g) => ({ ...g, count: g.items.length }));

    let elsewhere = null;
    if (counts[activeView] === 0) {
      const [best] = VIEWS.filter((v) => v !== activeView && counts[v] > 0).sort((a, b) => counts[b] - counts[a]);
      if (best) elsewhere = { view: best, count: counts[best] };
    }

    return {
      view: activeView,
      sort: byName ? 'name' : 'stayDate',
      dir: direction,
      counts,
      orphanCount: listOrphans().length,
      elsewhere,
      groups: groups.map((g) => ({
        ...g,
        items: g.items.map(({ hasDevis, ...item }) => item),
      })),
      items: groups.flatMap((g) => g.items.map(({ hasDevis, ...item }) => item)),
    };
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

  // specs/clients.md rule 12 — the client a new record would duplicate: same email
  // (case-insensitive), else same phone (its last 9 digits, so « 06 12… » and « +33 6 12… » match).
  function findDuplicate({ email, phone } = {}) {
    const byEmail = findByEmail(email);
    if (byEmail) return byEmail;
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 9) return undefined;
    const tail = digits.slice(-9);
    return database.prepare("SELECT * FROM clients WHERE phone IS NOT NULL AND phone <> '' ORDER BY id").all()
      .find((c) => String(c.phone).replace(/\D/g, '').slice(-9) === tail);
  }

  function insert(payload) {
    const fields = buildClientFields(payload);
    const cols = 'lastName, firstName, streetNumber, street, postalCode, city, address, phone, email, notes'
      + (HAS_EMAIL_LANGUAGE ? ', emailLanguage' : '');
    const vals = '@lastName, @firstName, @streetNumber, @street, @postalCode, @city, @address, @phone, @email, @notes'
      + (HAS_EMAIL_LANGUAGE ? ', @emailLanguage' : '');
    const result = database.prepare(`INSERT INTO clients (${cols}) VALUES (${vals})`).run(fields);
    writePostStayFlag(result.lastInsertRowid, payload);
    return findById(result.lastInsertRowid);
  }

  /**
   * An update that does not mention `emailLanguage` must not decide it.
   *
   * `buildClientFields` normalises an absent value to `'fr'`, which is right on an insert and wrong
   * on an update: a form that simply does not carry the field — the client dialog opened from the
   * reservation page was one — would reset an English guest to French without anyone touching
   * anything. Same shape as `writePostStayFlag` above, and the same reason.
   */
  function writesEmailLanguage(payload) {
    return Boolean(payload) && Object.prototype.hasOwnProperty.call(payload, 'emailLanguage');
  }

  function update(id, payload) {
    const fields = buildClientFields(payload);
    const setsLanguage = HAS_EMAIL_LANGUAGE && writesEmailLanguage(payload);
    database.prepare(`
      UPDATE clients
      SET lastName=@lastName, firstName=@firstName, streetNumber=@streetNumber, street=@street,
          postalCode=@postalCode, city=@city, address=@address, phone=@phone, email=@email, notes=@notes,${setsLanguage ? `
          emailLanguage=@emailLanguage,` : ''}
          updatedAt=datetime('now')
      WHERE id=@id
    `).run({ ...fields, id: Number(id) });
    writePostStayFlag(id, payload);
    return findById(id);
  }

  // THE delete guard for a client (utils/deletionGuard): a forced delete would cascade every stay and
  // devis, including those that carry money.
  function deletionBlocker(id) {
    const ids = idsOfOwner(database, 'clientId', id);
    if (carriesMoney(database, ids)) return CLIENT_MONEY_MESSAGE;
    return removesProtectedHistory(database, ids) ? CLIENT_HISTORY_MESSAGE : null;
  }

  function rowIdsToDelete(id) {
    return withConvertedDevis(database, idsOfOwner(database, 'clientId', id));
  }

  // The delete the controller runs after its provider awaits: judged again, in the same transaction.
  function removeGuarded(id) {
    return database.transaction(() => {
      const blocker = deletionBlocker(id);
      if (blocker) return { blocker };
      database.prepare('DELETE FROM clients WHERE id = ?').run(Number(id));
      return { ok: true };
    })();
  }

  function remove(id) {
    // FK cascade removes the client's reservations + devis and all their child rows.
    database.prepare('DELETE FROM clients WHERE id = ?').run(Number(id));
  }

  function listReservationsForClient(clientId) {
    const rows = database.prepare(`
      SELECT r.id, r.clientId, r.propertyId, p.name AS propertyName, r.startDate, r.endDate,
        r.kind, r.platform, r.finalPrice, r.adults, r.children, r.teens, r.babies
      FROM reservations r
      LEFT JOIN properties p ON p.id = r.propertyId
      WHERE r.kind IN ('reservation', 'cancelled', 'superseded') AND r.clientId = ?
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
    findDuplicate,
    insert,
    update,
    remove,
    deletionBlocker,
    removeGuarded,
    rowIdsToDelete,
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
