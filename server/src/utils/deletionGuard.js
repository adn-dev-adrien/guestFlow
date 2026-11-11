/**
 * THE delete guard of GuestFlow for stays, devis, clients and properties
 * (specs/payment-schedule-and-cancellation.md rules 49-52).
 *
 * Deleting a row cascades its refunds, installments, penalties and CGV proof, and the accounting reads
 * them: a row that carries money is cancelled, never deleted. Money can sit on the stay or on a devis
 * converted into it — website and devis payment links keep the DEVIS id after the conversion — so every
 * check reads the stay AND the devis converted into it.
 */

const MONEY_MESSAGE = 'Un paiement est enregistré sur ce séjour : l’annuler plutôt que le supprimer.';
const CLIENT_MONEY_MESSAGE = 'Un paiement est enregistré sur une réservation de ce client : l’annuler plutôt que la supprimer.';
const PROPERTY_MONEY_MESSAGE = 'Un paiement est enregistré sur une réservation de ce logement : l’annuler plutôt que la supprimer.';

// specs/resource-booking-pricing-and-invoicing.md rule 34 — a resource booking sold outside a stay (plugin
// `hourly-resources`) whose payment is recorded is a sale of the journal; once invoiced, Qonto states it. A delete of
// what it points at would drop it (resource: cascade) or blank its buyer (client, property: SET NULL).
// R36-DB-L1 — a caution received and not returned is the only record of what the guest is owed back.
const CAUTION_MESSAGES = {
  reservation: 'Une caution est détenue sur ce séjour : la rendre ou annuler le séjour plutôt que le supprimer.',
  client: 'Une caution est détenue sur une réservation de ce client : la rendre d’abord.',
  property: 'Une caution est détenue sur une réservation de ce logement : la rendre d’abord.',
};

const BOOKING_MONEY_MESSAGES = {
  clientId: 'Une séance payée ou facturée est enregistrée pour ce client : retirer d’abord son paiement.',
  propertyId: 'Une séance payée ou facturée est enregistrée sur ce logement : retirer d’abord son paiement.',
  resourceId: 'Une séance payée ou facturée utilise cette ressource : retirer d’abord son paiement.',
};

const HISTORY_MESSAGES = {
  client: { cancelled: 'Ce client a une réservation annulée.', superseded: 'Ce client a une réservation écartée.', cgv: 'Ce client a accepté des CGV.' },
  property: { cancelled: 'Ce logement a une réservation annulée.', superseded: 'Ce logement a une réservation écartée.', cgv: 'Ce logement a des CGV acceptées.' },
};
const isHistoryMessage = (message) => Object.values(HISTORY_MESSAGES).some((m) => Object.values(m).includes(message));

const placeholders = (ids) => ids.map(() => '?').join(',');

/** The ids a delete of `ids` touches: the rows themselves and every devis converted into them. */
function withConvertedDevis(database, ids) {
  const base = [...new Set(ids.map(Number).filter(Number.isFinite))];
  if (base.length === 0) return [];
  let devis = [];
  try {
    devis = database.prepare(`SELECT id FROM reservations WHERE kind = 'devis' AND convertedReservationId IN (${placeholders(base)})`)
      .all(...base).map((r) => r.id);
  } catch { devis = []; }
  return [...new Set([...base, ...devis])];
}

/** Whether any of the rows `ids` (expanded to their converted devis) carries money. */
function carriesMoney(database, ids) {
  const all = withConvertedDevis(database, ids);
  if (all.length === 0) return false;
  const marks = placeholders(all);
  const exists = (sql) => {
    try { return Boolean(database.prepare(sql).get(...all)); } catch { return false; }
  };
  return exists(`SELECT 1 FROM reservations WHERE id IN (${marks})
                  AND (depositPaid = 1 OR balancePaid = 1 OR complementPaid = 1 OR endOfStayComplementPaid = 1)`)
    || exists(`SELECT 1 FROM payment_links WHERE reservationId IN (${marks}) AND (status = 'paid' OR paidAt IS NOT NULL)`)
    || exists(`SELECT 1 FROM reservation_installments WHERE reservationId IN (${marks}) AND paid = 1`)
    || exists(`SELECT 1 FROM reservation_refunds WHERE reservationId IN (${marks})`)
    || exists(`SELECT 1 FROM reservation_platform_penalties WHERE reservationId IN (${marks})`)
    || exists(`SELECT 1 FROM cancellation_compensations WHERE reservationId IN (${marks})`)
    // R36-DB-M2 — a settled mid-stay note is money of the journal even when no paid flag is ticked (a platform stay
    // whose payout comes later): the note's sale would leave an exported month.
    || exists(`SELECT 1 FROM reservations WHERE id IN (${marks})
                  AND midStaySettledNotes IS NOT NULL AND trim(midStaySettledNotes) NOT IN ('', '[]')`);
}

/** R36-DB-L1 — the refusal when one of the rows `ids` holds a caution not returned yet, or null. */
function cautionBlocker(database, ids, owner = 'reservation') {
  const all = withConvertedDevis(database, ids);
  if (all.length === 0) return null;
  try {
    const held = database.prepare(`SELECT 1 FROM reservations WHERE id IN (${placeholders(all)})
      AND COALESCE(cautionReceived, 0) = 1 AND COALESCE(cautionReturned, 0) = 0 LIMIT 1`).get(...all);
    return held ? CAUTION_MESSAGES[owner] : null;
  } catch { return null; }
}

/**
 * R36-DB-M1 — the SQL condition « no resource booking names this client » on the clients row `alias`, empty when
 * the plugin table is absent. Every client cleanup (orphan popup, property delete, iCal sync) shares it: a client
 * booked on a resource, paid or not, is no orphan (specs/resource-booking-pricing-and-invoicing.md rule 34).
 */
function noResourceBookingSql(database, alias) {
  const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'resource_bookings'").get();
  return table ? ` AND NOT EXISTS (SELECT 1 FROM resource_bookings b WHERE b.clientId = ${alias}.id)` : '';
}

/**
 * Rule 34 — the refusal when a resource booking pointing at `column = id` is paid or carries a live Qonto invoice, or
 * null. The table and its invoice columns belong to the plugin: read only when present.
 */
function bookingMoneyBlocker(database, column, id) {
  if (!Object.prototype.hasOwnProperty.call(BOOKING_MONEY_MESSAGES, column)) throw new Error('unsupported booking column');
  const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'resource_bookings'").get();
  if (!table) return null;
  const columns = new Set(database.prepare('PRAGMA table_info(resource_bookings)').all().map((c) => c.name));
  if (!columns.has('paid')) return null;
  const invoiced = columns.has('qontoInvoiceId') && columns.has('invoiceCancelledAt')
    ? ' OR (qontoInvoiceId IS NOT NULL AND invoiceCancelledAt IS NULL)'
    : '';
  const held = database.prepare(`SELECT 1 FROM resource_bookings WHERE ${column} = ? AND (paid = 1${invoiced}) LIMIT 1`).get(Number(id));
  return held ? BOOKING_MONEY_MESSAGES[column] : null;
}

/**
 * The refusal when a delete of the rows `ids` would wipe history the per-row routes protect, or null: a
 * cancelled or set-aside stay (accounting history, rule 25) or the CGV acceptance a converted devis carries
 * (specs/terms-acceptance-record.md rule 29). A forced client or property delete obeys the same refusals.
 * `owner` is 'client' or 'property'; one short message per cause.
 */
function historyBlocker(database, ids, owner) {
  const all = withConvertedDevis(database, ids);
  if (all.length === 0) return null;
  const marks = placeholders(all);
  const exists = (sql) => {
    try { return Boolean(database.prepare(sql).get(...all)); } catch { return false; }
  };
  if (exists(`SELECT 1 FROM reservations WHERE id IN (${marks}) AND kind = 'cancelled'`)) return HISTORY_MESSAGES[owner].cancelled;
  if (exists(`SELECT 1 FROM reservations WHERE id IN (${marks}) AND kind = 'superseded'`)) return HISTORY_MESSAGES[owner].superseded;
  if (exists(`SELECT 1 FROM reservations r WHERE r.id IN (${marks}) AND r.kind = 'devis' AND r.convertedReservationId IS NOT NULL
                AND EXISTS (SELECT 1 FROM terms_acceptances a WHERE a.reservationId = r.id)`)) return HISTORY_MESSAGES[owner].cgv;
  return null;
}

/** Every reservations row (stay, devis, cancelled…) of a client or of a property. */
function idsOfOwner(database, column, ownerId) {
  if (!['clientId', 'propertyId'].includes(column)) throw new Error('unsupported owner column');
  return database.prepare(`SELECT id FROM reservations WHERE ${column} = ?`).all(Number(ownerId)).map((r) => r.id);
}

module.exports = {
  MONEY_MESSAGE, CLIENT_MONEY_MESSAGE, PROPERTY_MONEY_MESSAGE, HISTORY_MESSAGES, isHistoryMessage,
  BOOKING_MONEY_MESSAGES, withConvertedDevis, carriesMoney, historyBlocker, idsOfOwner, bookingMoneyBlocker,
  CAUTION_MESSAGES, cautionBlocker, noResourceBookingSql,
};
