/**
 * What the operator is told when a customer pays for a voucher (specs/site-outside-resource-booking.md rule 23): a push on the shared channel `online-sales` and an e-mail, built from
 * the voucher and its campaign — never from a literal activity. A voucher the team issues itself is never announced. Pure: no database, no clock.
 *
 *   soldNotice({ voucher, title })                                          → { channel, title, body, url, subject, lines }
 *   refundNotice({ resourceName, date, start, end, name, amountCents, reason }) → the same, for a remainder paid after the session could not be booked
 */

const rules = require('./voucherRules');

const CHANNEL = 'online-sales';
const CHANNEL_LABEL = 'Bons cadeaux et séances en ligne';

const amountText = (cents) => {
  const whole = String(Math.trunc(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${whole}${cents % 100 ? `,${String(cents % 100).padStart(2, '0')}` : ''} €`;
};

const dayOf = (iso) => new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
}).format(new Date(`${iso}T12:00:00Z`));

const shortName = (name) => {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words.length === 1 ? words[0] : `${words[0]} ${[...words[words.length - 1]][0].toUpperCase()}.`;
};

function soldNotice({ voucher, title }) {
  const from = voucher.senderName ? ` offert par ${voucher.senderName}` : ' offert';
  const to = voucher.recipientName ? ` à ${voucher.recipientName}` : '';
  const sentence = `${title},${from}${to}. N° ${voucher.number}, valable jusqu’au ${rules.formatFrDate(voucher.expiresOn)}.`;
  return {
    channel: CHANNEL,
    title: `Bon cadeau vendu · ${amountText(voucher.amountCents)}`,
    body: sentence,
    url: `/bons-cadeaux?bon=${Number(voucher.id)}`,
    subject: `Bon cadeau vendu : ${amountText(voucher.amountCents)}, n° ${voucher.number}`,
    lines: [
      sentence,
      '',
      `Montant : ${amountText(voucher.amountCents)}`,
      ...(voucher.email ? [`E-mail de l’acheteur : ${voucher.email}`] : []),
    ],
  };
}

function refundNotice({
  resourceName, date, start, end, name, amountCents, reason,
}) {
  const slot = `${dayOf(date)} · ${start} – ${end}`;
  return {
    channel: CHANNEL,
    title: `Paiement à rembourser · ${resourceName}`,
    body: `${slot} · ${shortName(name)}, ${amountText(amountCents)} payés : ${reason}.`,
    url: '',
    subject: `Paiement à rembourser : ${resourceName}, ${dayOf(date)}`,
    lines: [
      `Le reste à payer d’une séance réservée avec un bon n’a pas pu être honoré : ${reason}.`,
      'Le paiement est signalé « à rembourser » dans GuestFlow.',
      '',
      resourceName,
      slot,
      `Client : ${name || '—'}`,
      `Montant payé : ${amountText(amountCents)}`,
    ],
  };
}

module.exports = {
  CHANNEL, CHANNEL_LABEL, soldNotice, refundNotice,
};
