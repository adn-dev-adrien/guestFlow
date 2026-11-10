/**
 * specs/single-payment-from-the-fiche.md rule 9 reading of 2026-11-10 (audit R44-RES-L2) — the words the fiche history
 * gives a « paiement unique »: the amount in euros the French way (« 281,98 € »), the day as the screens write it
 * (« 01/09/2026 ») and the buckets by their French names, never `balance` / `endOfStayComplement`.
 */

const { formatHistoryMoney } = require('./reservationAudit');
const { formatDateNumeric } = require('./dateFr');

const ARRIVAL_BUCKET_LABELS = Object.freeze({
  deposit: 'acompte',
  balance: 'solde',
  complement: "complément d'arrivée",
  endOfStayComplement: 'complément de fin de séjour',
});

function coveredText(buckets) {
  return (buckets || []).map((bucket) => ARRIVAL_BUCKET_LABELS[bucket] || bucket).join(', ');
}

// « 281,98 € — CB / Chèque le 01/09/2026 — solde, complément de fin de séjour »
function arrivalPaymentText({ total, cash, date, buckets }) {
  return `${formatHistoryMoney(total)} — ${cash ? 'caisse interne' : 'CB / Chèque'} le ${formatDateNumeric(date)} — ${coveredText(buckets)}`;
}

module.exports = { ARRIVAL_BUCKET_LABELS, coveredText, arrivalPaymentText, historyMoney: formatHistoryMoney };
