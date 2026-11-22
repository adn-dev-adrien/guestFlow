/**
 * The e-mail of a voucher (specs/gift-voucher-campaigns.md rule 20, which lifts the « code never in the mail » rule of specs/gift-vouchers.md rule 23): the greeting, the campaign's
 * public title, « Pour … de la part de … », the code in large type, the same lines as the PDF's back, the validity date and — for a voucher that was paid — an invoice-style recap
 * read from what was frozen when the voucher was issued (its priced lines and its VAT lines), never computed again. The PDF travels attached. French or English.
 */

const rules = require('./voucherRules');
const code = require('./code');
const { contentLines } = require('./contentsText');

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;',
}[c]));

const TEXTS = Object.freeze({
  fr: {
    subject: (title) => `Votre bon cadeau : ${title}`,
    greeting: 'Bonjour,',
    intro: (title) => `Voici votre bon cadeau : ${title}.`,
    parties: (to, from) => [to && `Pour ${to}`, from && `de la part de ${from}`].filter(Boolean).join(' '),
    codeLabel: 'Le code du bon',
    printNote: 'Le PDF joint s\'imprime tel quel. Si vous avez la carte du commerçant, vous pouvez aussi recopier le code dans l\'encart blanc.',
    includes: 'Le bon comprend :',
    validUntil: (date) => `Valable jusqu’au ${rules.formatFrDate(date)}.`,
    pageLine: (link) => `Le bon s’ouvre aussi ici : ${link}`,
    recap: 'Récapitulatif du paiement',
    date: (date) => `Date : ${rules.formatFrDate(date)}`,
    number: (n) => `Bon n° ${n}`,
    line: ({ qty, label, unit, rate, total }) => `${qty} × ${label} · ${unit} TTC l’unité · TVA ${rules.formatPercent(rate)} · ${total}`,
    total: (cents) => `Total payé TTC : ${rules.formatEuros(cents)}`,
    vat: (percent, cents) => `dont TVA ${rules.formatPercent(percent)} : ${rules.formatEuros(cents)}`,
    closing: 'Belle journée.',
    columns: ['Quantité', 'Désignation', 'PU TTC', 'TVA', 'Total TTC'],
    attachment: (number) => `${number}.pdf`,
  },
  en: {
    subject: (title) => `Your gift voucher: ${title}`,
    greeting: 'Hello,',
    intro: (title) => `Here is your gift voucher: ${title}.`,
    parties: (to, from) => [to && `For ${to}`, from && `from ${from}`].filter(Boolean).join(' '),
    codeLabel: 'The voucher code',
    printNote: 'The attached PDF prints as it is. If you have the shop’s card, you can also copy the code into its white box.',
    includes: 'The voucher includes:',
    validUntil: (date) => `Valid until ${date}.`,
    pageLine: (link) => `The voucher can also be opened here: ${link}`,
    recap: 'Payment summary',
    date: (date) => `Date: ${date}`,
    number: (n) => `Voucher no. ${n}`,
    line: ({ qty, label, unit, rate, total }) => `${qty} × ${label} · ${unit} incl. VAT each · VAT ${String(Number(rate))}% · ${total}`,
    total: (cents) => `Total paid incl. VAT: ${rules.formatEuros(cents)}`,
    vat: (percent, cents) => `including VAT ${String(Number(percent))}%: ${rules.formatEuros(cents)}`,
    closing: 'Kind regards.',
    columns: ['Qty', 'Item', 'Unit price incl. VAT', 'VAT', 'Total incl. VAT'],
    attachment: (number) => `${number}.pdf`,
  },
});

/** The lines of the recap: a composed voucher's frozen priced lines, a lodging voucher's single amount at its frozen rate. */
function recapLines(voucher, title) {
  const contents = rules.contentsOf(voucher);
  if (contents.kind === 'resource' && Array.isArray(contents.lines) && contents.lines.length) return contents.lines;
  const [first] = rules.vatLinesOf(voucher);
  return [{
    label: title, qty: 1, unitCents: voucher.amountCents, totalCents: voucher.amountCents, vatRate: first ? first.ratePercent : 0,
  }];
}

/**
 * → `{ subject, text, html, filename }`. `title` is the campaign's public title, `plainCode` the normalised code, `link` the voucher page when the site has one.
 * A voucher given away (« Offert ») has no payment: no recap.
 */
function renderMail({
  voucher, title, plainCode, link = null, language = 'fr',
}) {
  const t = TEXTS[language === 'en' ? 'en' : 'fr'];
  const en = language === 'en';
  const paid = voucher.paymentMethod !== rules.OFFERED_METHOD;
  const parties = t.parties(voucher.recipientName, voucher.senderName);
  const includes = contentLines(voucher);
  const vatLines = paid ? rules.vatLinesOf(voucher).filter((l) => l.vatCents > 0) : [];
  const priced = paid ? recapLines(voucher, title).map((l) => ({
    qty: l.qty, label: l.label, unit: rules.formatEuros(l.unitCents), rate: l.vatRate, total: rules.formatEuros(l.totalCents),
  })) : [];
  const issued = rules.parisDate(new Date(voucher.issuedAt));
  const formatted = code.format(plainCode);

  const text = [
    t.greeting,
    '',
    t.intro(title),
    ...(parties ? [parties] : []),
    ...(voucher.message ? [`« ${voucher.message} »`] : []),
    '',
    `${t.codeLabel} : ${formatted}`,
    t.printNote,
    '',
    t.includes,
    ...includes.map((line) => `- ${line}`),
    t.validUntil(voucher.expiresOn),
    ...(link ? ['', t.pageLine(link)] : []),
    ...(paid ? [
      '',
      t.recap,
      `${t.date(issued)} · ${t.number(voucher.number)}`,
      ...priced.map((l) => `- ${t.line(l)}`),
      t.total(voucher.amountCents),
      ...vatLines.map((l) => t.vat(l.ratePercent, l.vatCents)),
    ] : []),
    '',
    t.closing,
  ].join('\n');

  const p = (s) => `<p style="margin:0 0 12px">${s}</p>`;
  const html = [
    p(escapeHtml(t.greeting)),
    p(escapeHtml(t.intro(title))),
    ...(parties ? [p(`<strong>${escapeHtml(parties)}</strong>`)] : []),
    ...(voucher.message ? [p(`<em>${escapeHtml(voucher.message)}</em>`)] : []),
    `<p style="margin:16px 0 4px;color:#5c665f">${escapeHtml(t.codeLabel)}</p>`,
    `<p style="margin:0 0 8px;font-size:26px;font-weight:700;letter-spacing:2px;font-family:monospace">${escapeHtml(formatted)}</p>`,
    p(escapeHtml(t.printNote)),
    `<p style="margin:16px 0 4px"><strong>${escapeHtml(t.includes)}</strong></p>`,
    `<ul style="margin:0 0 12px;padding-left:20px">${includes.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`,
    p(escapeHtml(t.validUntil(voucher.expiresOn))),
    ...(link ? [p(`<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`)] : []),
    ...(paid ? [
      `<p style="margin:16px 0 4px"><strong>${escapeHtml(t.recap)}</strong></p>`,
      p(`${escapeHtml(t.date(issued))} · ${escapeHtml(t.number(voucher.number))}`),
      `<table style="border-collapse:collapse;margin:0 0 12px"><thead><tr>${t.columns.map((c) => `<th style="text-align:left;padding:2px 10px 2px 0;border-bottom:1px solid #c9cfc9">${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${priced.map((l) => `<tr><td style="padding:2px 10px 2px 0">${l.qty}</td><td style="padding:2px 10px 2px 0">${escapeHtml(l.label)}</td><td style="padding:2px 10px 2px 0">${escapeHtml(l.unit)}</td><td style="padding:2px 10px 2px 0">${escapeHtml(en ? `${String(Number(l.rate))}%` : rules.formatPercent(l.rate))}</td><td style="padding:2px 0">${escapeHtml(l.total)}</td></tr>`).join('')}</tbody></table>`,
      `<p style="margin:0 0 4px"><strong>${escapeHtml(t.total(voucher.amountCents))}</strong></p>`,
      ...vatLines.map((l) => `<p style="margin:0 0 4px">${escapeHtml(t.vat(l.ratePercent, l.vatCents))}</p>`),
    ] : []),
    p(escapeHtml(t.closing)),
  ].join('');

  return {
    subject: t.subject(title).replace(/[\r\n]+/g, ' '), text, html, filename: t.attachment(voucher.number),
  };
}

/**
 * Rule 41 — the mail an operator sends with the one-hour payment link of a voucher sold by telephone: what it is, how much, the link, how long it lives.
 * → `{ subject, text, html }`.
 */
function renderPaymentLinkMail({
  url, language, label, termsUrl = '',
}) {
  const en = language === 'en';
  const subject = en ? 'Your gift voucher: payment link' : 'Votre bon cadeau : lien de paiement';
  const terms = termsUrl
    ? (en ? `\n\nPaying accepts our terms of sale: ${termsUrl}` : `\n\nLe paiement vaut acceptation de nos conditions générales de vente : ${termsUrl}`)
    : '';
  const text = en
    ? `Hello,\n\nHere is the link to pay for your gift voucher (${label}): ${url}\n\nThe link stays valid for one hour. Once the payment is confirmed, the voucher is sent to this address.${terms}\n\nKind regards.`
    : `Bonjour,\n\nVoici le lien pour régler votre bon cadeau (${label}) : ${url}\n\nLe lien reste valable une heure. Une fois le paiement confirmé, le bon vous est envoyé à cette adresse.${terms}\n\nBelle journée.`;
  const linked = [url, termsUrl].filter(Boolean).reduce((html, link) => html.replace(escapeHtml(link), `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`), escapeHtml(text));
  const html = `<p>${linked.split(/\n{2,}/).map((p) => p.replace(/\n/g, '<br>')).join('</p><p>')}</p>`;
  return { subject, text, html };
}

module.exports = { renderMail, renderPaymentLinkMail };
