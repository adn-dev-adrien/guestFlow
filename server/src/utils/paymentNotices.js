/**
 * What the operator is told when a guest pays online on a stay (specs/payments/online-payment-notices.md rules 1-3, 5):
 * the words of the push and of the e-mail, and of one line of the home's « Paiements reçus » subject. Pure: no database,
 * no clock — `utils/paymentsReceived.js` reads the rows, this module writes the sentences. Amounts go through the
 * shared euro formatter, never a literal.
 *
 *   paymentNotice({ type, amountCents, stay })  → { channel, title, body, url, subject, lines }
 *   receivedLine({ type, amountCents, stay, paidAt }) → { reservationId, clientName, propertyName, bucketLabel, amountLabel, whenLabel }
 */

const { emailAmount } = require('./emailMoney');
const { formatDateNumeric, formatMomentLong } = require('./dateFr');

const CHANNEL = 'stay-payments';
const CHANNEL_LABEL = 'Paiements en ligne reçus';

// The bucket a link pays, in the words of the title (« Acompte reçu ») and of a home line (« Acompte »).
const BUCKETS = Object.freeze({
  deposit: { received: 'Acompte reçu', label: 'Acompte' },
  balance: { received: 'Solde reçu', label: 'Solde' },
  full: { received: 'Paiement total reçu', label: 'Paiement total' },
  installment: { received: 'Échéance reçue', label: 'Échéance' },
});

const clean = (value) => String(value == null ? '' : value).trim();
const amountOf = (cents) => emailAmount(Number(cents || 0) / 100);

const clientNameOf = (stay) => clean(`${clean(stay.firstName)} ${clean(stay.lastName)}`) || `#${stay.id}`;

function paymentNotice({ type, amountCents, stay }) {
  const bucket = BUCKETS[type] || BUCKETS.deposit;
  const amount = amountOf(amountCents);
  const dates = stay.startDate && stay.endDate
    ? `du ${formatDateNumeric(stay.startDate)} au ${formatDateNumeric(stay.endDate)}`
    : '';
  const sentence = `${[clientNameOf(stay), clean(stay.propertyName), dates].filter(Boolean).join(', ')}.`;
  return {
    channel: CHANNEL,
    title: `${bucket.received} · ${amount}`,
    body: sentence,
    url: `/reservations/${Number(stay.id)}`,
    subject: `${bucket.received} : ${amount}, ${clientNameOf(stay)}`,
    lines: [sentence, '', `Montant : ${amount}`],
  };
}

function receivedLine({ type, amountCents, stay, paidAt }) {
  const bucket = BUCKETS[type] || BUCKETS.deposit;
  return {
    reservationId: Number(stay.id),
    clientName: clientNameOf(stay),
    propertyName: clean(stay.propertyName),
    bucketLabel: bucket.label,
    amountLabel: amountOf(amountCents),
    whenLabel: formatMomentLong(paidAt),
  };
}

module.exports = { CHANNEL, CHANNEL_LABEL, BUCKETS, paymentNotice, receivedLine };
