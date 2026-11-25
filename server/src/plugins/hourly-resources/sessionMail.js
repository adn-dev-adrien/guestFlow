/**
 * The mail a visitor gets once a session ordered on the website is booked (specs/site-outside-resource-booking.md rule 17): the day, the hours, the party, what was paid, the terms
 * accepted and the address. It answers the visitor's own action, so it leaves by itself. French — the visitor's language is not known. → `{ subject, text, html }`.
 */

const euros = (cents) => `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;',
}[c]));

const longDate = (iso) => new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${iso}T12:00:00Z`));

const frDate = (iso) => String(iso).split('-').reverse().join('/');

function renderSessionMail({
  companyName, address, resourceName, date, start, end, people, parts, extras, dueCents,
}) {
  const when = `${longDate(date)}, de ${start} à ${end}`;
  const recap = [
    ...parts.map((part) => `${part.label} : ${euros(part.cents)}`),
    ...extras.map((extra) => `${extra.qty > 1 ? `${extra.qty} × ` : ''}${extra.label} : ${euros(extra.cents)}`),
    `Payé en ligne : ${euros(dueCents)}.`,
  ];
  const lines = [
    'Bonjour,',
    '',
    `Votre séance est réservée : ${resourceName}.`,
    `Le ${when}, pour ${people} personne${people > 1 ? 's' : ''}.`,
    ...(address ? ['', `Adresse : ${address.replace(/\s*\n\s*/g, ', ')}`] : []),
    '',
    ...recap,
    '',
    'Vous avez accepté les conditions générales de la réservation.',
    '',
    `À bientôt chez ${companyName}.`,
  ];
  const p = (s) => `<p style="margin:0 0 12px">${s}</p>`;
  const html = [
    p('Bonjour,'),
    p(`Votre séance est réservée : <strong>${escapeHtml(resourceName)}</strong>.`),
    p(`<strong>${escapeHtml(`Le ${when}`)}</strong>, pour ${people} personne${people > 1 ? 's' : ''}.`),
    ...(address ? [p(`Adresse : ${escapeHtml(address.replace(/\s*\n\s*/g, ', '))}`)] : []),
    `<ul style="margin:0 0 12px;padding-left:20px">${recap.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`,
    p('Vous avez accepté les conditions générales de la réservation.'),
    p(`À bientôt chez ${escapeHtml(companyName)}.`),
  ].join('');
  return { subject: `Votre séance du ${frDate(date)} est réservée`, text: lines.join('\n'), html };
}

module.exports = { renderSessionMail };
