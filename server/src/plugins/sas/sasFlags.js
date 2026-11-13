/**
 * specs/reservation-payment-ledger.md rule 72 (audit R39-M-L2) — a SAS tick is read as the PATCH reads one (rule 66):
 * true, false, 1 or 0, or absent. `Boolean("false")` settled a solde and returned a caution the request said were not.
 * `sasFlagsRefusal(body, fields, lineFields)` answers the first tick of another shape as 400 INVALID_PAYMENT_FLAG with
 * its field (`<list>.offered` for a line's « Offrir »), else `{ body }` with every tick sent made a boolean.
 */

const isTick = (value) => value === true || value === false || value === 1 || value === 0;
const refusal = (field) => ({ refusal: { status: 400, body: { error: 'Valeur invalide.', code: 'INVALID_PAYMENT_FLAG', field } } });

function sasFlagsRefusal(body, fields, lineFields = []) {
  const read = { ...body };
  for (const field of fields) {
    if (read[field] === undefined) continue;
    if (!isTick(read[field])) return refusal(field);
    read[field] = read[field] === true || read[field] === 1;
  }
  for (const list of lineFields) {
    if (!Array.isArray(read[list])) continue;
    const lines = [];
    for (const line of read[list]) {
      if (line && typeof line === 'object' && line.offered !== undefined) {
        if (!isTick(line.offered)) return refusal(`${list}.offered`);
        lines.push({ ...line, offered: line.offered === true || line.offered === 1 });
      } else {
        lines.push(line);
      }
    }
    read[list] = lines;
  }
  return { body: read };
}

const ARRIVAL_FLAGS = [
  'cautionReceived', 'cautionWaived', 'stayPaid', 'stayPaidCash', 'complementSettled', 'complementPaidCash', 'arrivalPaymentSplit',
  'cleaningAdded', 'bathLinenAdded', 'cleaningOffered', 'bathLinenOffered', 'extinguisherSealOkAtArrival',
];
const ARRIVAL_LINES = ['linenItems', 'keptLines'];
const DEPARTURE_FLAGS = [
  'cautionReturned', 'complementsSettled', 'complementsPaidCash', 'cleaningCharged', 'cleaningOffered',
  'extinguisherSealOkAtDeparture',
];
const DEPARTURE_LINES = ['missingItems', 'storedLines', 'extinguisherCharges'];

module.exports = {
  sasFlagsRefusal, ARRIVAL_FLAGS, ARRIVAL_LINES, DEPARTURE_FLAGS, DEPARTURE_LINES,
};
