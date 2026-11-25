/**
 * What the operator is told of a session sold outside a stay (specs/site-outside-resource-booking.md rule 23): a push on the shared channel `online-sales` and an e-mail, both built from the
 * booking and the resource, never from a literal activity. Pure: no database, no clock.
 *
 *   bookedNotice({ resourceName, date, start, end, customer, people, tenders, bookingId }) → { channel, title, body, url, subject, lines }
 *   refundNotice({ resourceName, date, start, end, name, amountCents, reason })           → the same, for a payment the plugin could not honour
 */

const CHANNEL = 'online-sales';
const CHANNEL_LABEL = 'Bons cadeaux et séances en ligne';

const euros = (cents) => `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;

const dayOf = (date) => new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
}).format(new Date(`${date}T12:00:00Z`));

/** « Marie Dupont » → « Marie D. »: the first word and the initial of the last. */
function shortName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words.length === 1 ? words[0] : `${words[0]} ${[...words[words.length - 1]][0].toUpperCase()}.`;
}

/** How the session was settled: « 90 € payés », « bon cadeau n° 0042 », « bon cadeau n° 0042 + 40 € payés ». */
function settlementOf(tenders) {
  const prepaid = tenders.filter((t) => t.method === 'prepaid').map((t) => `${String(t.label || '').toLowerCase()} n° ${t.ref}`);
  const cardCents = tenders.filter((t) => t.method === 'card').reduce((sum, t) => sum + t.amountCents, 0);
  return [...prepaid, ...(cardCents > 0 ? [`${euros(cardCents)} payés`] : [])].join(' + ');
}

const slotOf = (date, start, end) => `${dayOf(date)} · ${start} – ${end}`;

function bookedNotice({
  resourceName, date, start, end, customer = {}, people = null, tenders = [], bookingId,
}) {
  const settlement = settlementOf(tenders);
  const party = people ? `${people} pers.` : '';
  return {
    channel: CHANNEL,
    title: `Séance réservée en ligne · ${resourceName}`,
    body: [slotOf(date, start, end), [shortName(customer.name), party].filter(Boolean).join(', '), settlement].filter(Boolean).join(' · '),
    url: `/passages/${Number(bookingId)}`,
    subject: `Séance réservée en ligne : ${resourceName}, ${dayOf(date)}`,
    lines: [
      resourceName,
      slotOf(date, start, end),
      ...(people ? [`${people} personne${people > 1 ? 's' : ''}`] : []),
      '',
      `Client : ${customer.name || '—'}`,
      `E-mail : ${customer.email || '—'} · Tél. : ${customer.phone || '—'}`,
      ...(settlement ? [`Règlement : ${settlement}`] : []),
    ],
  };
}

function refundNotice({
  resourceName, date, start, end, name, amountCents, reason,
}) {
  return {
    channel: CHANNEL,
    title: `Paiement à rembourser · ${resourceName}`,
    body: `${slotOf(date, start, end)} · ${shortName(name)}, ${euros(amountCents)} payés : ${reason}.`,
    url: '',
    subject: `Paiement à rembourser : ${resourceName}, ${dayOf(date)}`,
    lines: [
      `Une séance payée en ligne n’a pas pu être réservée : ${reason}.`,
      'Le paiement est signalé « à rembourser » dans GuestFlow.',
      '',
      resourceName,
      slotOf(date, start, end),
      `Client : ${name || '—'}`,
      `Montant payé : ${euros(amountCents)}`,
    ],
  };
}

module.exports = {
  CHANNEL, CHANNEL_LABEL, bookedNotice, refundNotice, euros, dayOf,
};
