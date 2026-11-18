/**
 * The e-mail of a voucher (specs/gift-vouchers.md rule 23): the operator's template, French or English, with the
 * amount, the expiry and the voucher link. The code never appears in it, and there is no attachment.
 */

const rules = require('./voucherRules');
const { PLACEHOLDERS } = require('./settings');

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;',
}[c]));

const fill = (template, values, format) => String(template).replace(/\{([^{}]*)\}/g, (match, name) => (PLACEHOLDERS.includes(name) ? format(name, values[name] ?? '') : match));

/** « , dont TVA 10 % : 13,64 € » — the tail of the amount's sentence; several rates are listed, and a voucher with no VAT (or given away) says nothing. */
function vatSentence(voucher, language) {
  if (voucher.paymentMethod === rules.OFFERED_METHOD) return '';
  const lines = rules.vatLinesOf(voucher).filter((line) => Number(line.ratePercent) > 0 && line.vatCents > 0);
  if (!lines.length) return '';
  const en = language === 'en';
  const rate = (line) => (en ? `${String(Number(line.ratePercent))}%` : rules.formatPercent(line.ratePercent));
  if (lines.length === 1) return `${en ? ', including VAT' : ', dont TVA'} ${rate(lines[0])}${en ? ':' : ' :'} ${rules.formatEuros(lines[0].vatCents)}`;
  const total = rules.formatEuros(lines.reduce((sum, line) => sum + line.vatCents, 0));
  const parts = lines.map((line) => `${rate(line)}${en ? ':' : ' :'} ${rules.formatEuros(line.vatCents)}`).join(en ? ', ' : ' ; ');
  return `${en ? ', including VAT' : ', dont TVA'}${en ? ':' : ' :'} ${total} (${parts})`;
}

/** → `{ subject, text, html }`. `get(key)` reads the plugin's settings. */
function renderMail({ voucher, link, language }, get) {
  const lang = language === 'en' ? 'En' : 'Fr';
  const values = {
    amount: rules.formatEuros(voucher.amountCents),
    expiry: language === 'en' ? voucher.expiresOn : rules.formatFrDate(voucher.expiresOn),
    vat: vatSentence(voucher, language),
    link,
    recipientName: voucher.recipientName || '',
    senderName: voucher.senderName || '',
    number: voucher.number,
  };
  const body = get(`mailBody${lang}`);
  const html = fill(escapeHtml(body), values, (name, value) => (name === 'link' ? `<a href="${escapeHtml(value)}">${escapeHtml(value)}</a>` : escapeHtml(value)));
  return {
    subject: fill(get(`mailSubject${lang}`), values, (name, value) => String(value)).replace(/[\r\n]+/g, ' '),
    text: fill(body, values, (name, value) => String(value)),
    html: `<p>${html.split(/\n{2,}/).map((p) => p.replace(/\n/g, '<br>')).join('</p><p>')}</p>`,
  };
}

/**
 * Rule 41 — the mail an operator sends with the one-hour payment link of a voucher sold by telephone: what it is, how much, the link, how long it lives.
 * → `{ subject, text, html }`.
 */
function renderPaymentLinkMail({ url, language, label }) {
  const en = language === 'en';
  const subject = en ? 'Your gift voucher: payment link' : 'Votre bon cadeau : lien de paiement';
  const text = en
    ? `Hello,\n\nHere is the link to pay for your gift voucher (${label}): ${url}\n\nThe link stays valid for one hour. Once the payment is confirmed, the voucher is sent to this address.\n\nKind regards.`
    : `Bonjour,\n\nVoici le lien pour régler votre bon cadeau (${label}) : ${url}\n\nLe lien reste valable une heure. Une fois le paiement confirmé, le bon vous est envoyé à cette adresse.\n\nBelle journée.`;
  const html = `<p>${escapeHtml(text).replace(escapeHtml(url), `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`).split(/\n{2,}/).map((p) => p.replace(/\n/g, '<br>')).join('</p><p>')}</p>`;
  return { subject, text, html };
}

module.exports = { renderMail, renderPaymentLinkMail };
