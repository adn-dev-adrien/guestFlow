/**
 * The mail a recipient gets when the bath is booked on « Mon bain » (specs/gift-vouchers/gift-voucher-campaigns.md rule 31): the day, the hours, the address, what is included and what was paid. It
 * answers the recipient's own action, so it leaves by itself (the same exception as the receipt of a purchase, rule 20). French — the recipient's language is not known. → `{ subject, text, html }`.
 */

const rules = require('./voucherRules');

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;',
}[c]));

const longDate = (iso) => new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${iso}T12:00:00Z`));

function renderUseMail({
  companyName, address, title, resourceName, date, start, end, people, included, supplement, gifts = [], extras, dueCents, number,
}) {
  const when = `${longDate(date)}, de ${start} à ${end}`;
  const includedLines = included.map((line) => (line.qty > 1 ? `${line.qty} × ${line.label}` : line.label));
  const paidLines = [
    `Réglé par le bon cadeau n° ${number}.`,
    ...(supplement ? [`${supplement.label} : ${rules.formatEuros(supplement.cents)}`] : []),
    ...(gifts.some((g) => g.label === 'Boisson offerte') ? ['Une boisson vous sera offerte sur place.'] : []),
    ...(gifts.some((g) => g.label === 'Heure offerte') ? ['Une heure supplémentaire vous est offerte.'] : []),
    ...extras.map((extra) => `${extra.qty > 1 ? `${extra.qty} × ` : ''}${extra.label} : ${rules.formatEuros(extra.cents)}`),
    dueCents > 0 ? `Payé en ligne : ${rules.formatEuros(dueCents)}.` : 'Rien d’autre à payer.',
  ];
  const text = [
    'Bonjour,',
    '',
    `Votre séance est réservée : ${resourceName} (${title}).`,
    `Le ${when}${people ? `, pour ${people} personne${people > 1 ? 's' : ''}` : ''}.`,
    ...(address ? ['', `Adresse : ${address.replace(/\s*\n\s*/g, ', ')}`] : []),
    '',
    'Votre séance comprend :',
    ...includedLines.map((line) => `- ${line}`),
    '',
    ...paidLines,
    '',
    `À bientôt chez ${companyName}.`,
  ].join('\n');
  const p = (s) => `<p style="margin:0 0 12px">${s}</p>`;
  const html = [
    p('Bonjour,'),
    p(`Votre séance est réservée : <strong>${escapeHtml(resourceName)}</strong> (${escapeHtml(title)}).`),
    p(`<strong>${escapeHtml(`Le ${when}${people ? `, pour ${people} personne${people > 1 ? 's' : ''}` : ''}.`)}</strong>`),
    ...(address ? [p(`Adresse : ${escapeHtml(address.replace(/\s*\n\s*/g, ', '))}`)] : []),
    '<p style="margin:16px 0 4px"><strong>Votre séance comprend :</strong></p>',
    `<ul style="margin:0 0 12px;padding-left:20px">${includedLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`,
    ...paidLines.map((line) => p(escapeHtml(line))),
    p(`À bientôt chez ${escapeHtml(companyName)}.`),
  ].join('');
  return { subject: `Votre séance du ${rules.formatFrDate(date)} est réservée`, text, html };
}

module.exports = { renderUseMail };
