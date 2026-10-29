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

const CLIENT_HISTORY_MESSAGE = 'Ce client a une réservation annulée ou l’acceptation des CGV d’un séjour : cet historique reste conservé.';
const PROPERTY_HISTORY_MESSAGE = 'Ce logement a une réservation annulée ou l’acceptation des CGV d’un séjour : cet historique reste conservé.';

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
    || exists(`SELECT 1 FROM cancellation_compensations WHERE reservationId IN (${marks})`);
}

/**
 * Whether a delete of the rows `ids` would wipe history the per-row routes protect: a cancelled or
 * set-aside stay (accounting history, rule 25) or the CGV acceptance a converted devis carries
 * (specs/terms-acceptance-record.md rule 29). A forced client or property delete obeys the same refusals.
 */
function removesProtectedHistory(database, ids) {
  const all = withConvertedDevis(database, ids);
  if (all.length === 0) return false;
  const marks = placeholders(all);
  const exists = (sql) => {
    try { return Boolean(database.prepare(sql).get(...all)); } catch { return false; }
  };
  return exists(`SELECT 1 FROM reservations WHERE id IN (${marks}) AND kind NOT IN ('reservation', 'devis')`)
    || exists(`SELECT 1 FROM reservations r WHERE r.id IN (${marks}) AND r.kind = 'devis' AND r.convertedReservationId IS NOT NULL
                AND EXISTS (SELECT 1 FROM terms_acceptances a WHERE a.reservationId = r.id)`);
}

/** Every reservations row (stay, devis, cancelled…) of a client or of a property. */
function idsOfOwner(database, column, ownerId) {
  if (!['clientId', 'propertyId'].includes(column)) throw new Error('unsupported owner column');
  return database.prepare(`SELECT id FROM reservations WHERE ${column} = ?`).all(Number(ownerId)).map((r) => r.id);
}

module.exports = {
  MONEY_MESSAGE, CLIENT_MONEY_MESSAGE, PROPERTY_MONEY_MESSAGE, CLIENT_HISTORY_MESSAGE, PROPERTY_HISTORY_MESSAGE,
  withConvertedDevis, carriesMoney, removesProtectedHistory, idsOfOwner,
};
