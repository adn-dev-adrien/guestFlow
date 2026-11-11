/**
 * Content migration (specs/reservation-number-and-search.md §4): the J-7 and J-2 reminders recall the
 * reservation number in the stay recap. Reaches already-seeded rows with a targeted REPLACE that inserts
 * the gated `{{#if hasReservationNumber}}` line between the recap header and "- Logement".
 *
 * Idempotent and silent when there is nothing to do: a row is written only if it does not carry the token
 * yet AND still contains the anchor, so an operator-rewritten recap header is left alone and its
 * `updatedAt` is not bumped at every boot.
 */
const RECAPS = [
  ['arrival_reminder_7d', 'Rappel des informations de votre séjour :'],
  ['arrival_reminder_1d', 'Votre séjour :'],
];

function addReservationNumberToRecaps(db) {
  const update = db.prepare(`
    UPDATE email_templates
       SET body = REPLACE(body, ?, ?), updatedAt = datetime('now')
     WHERE stableKey = ? AND body NOT LIKE '%{{reservationNumber}}%' AND instr(body, ?) > 0
  `);
  for (const [stableKey, header] of RECAPS) {
    const anchor = `${header}\n- Logement : {{propertyName}}`;
    const replacement = `${header}\n{{#if hasReservationNumber}}- N° de réservation : {{reservationNumber}}\n{{/if}}- Logement : {{propertyName}}`;
    update.run(anchor, replacement, stableKey, anchor);
  }
}

module.exports = { addReservationNumberToRecaps };
