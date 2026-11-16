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

/** « , dont TVA 10 % : 13,64 € » — the tail of the amount's sentence, empty when the voucher carries no VAT. */
function vatSentence(voucher, language) {
  if (!(Number(voucher.vatRatePercent) > 0)) return '';
  const { vatCents } = rules.vatSplit(voucher.amountCents, voucher.vatRatePercent);
  if (language === 'en') return `, including VAT ${String(Number(voucher.vatRatePercent))}%: ${rules.formatEuros(vatCents)}`;
  return `, dont TVA ${rules.formatPercent(voucher.vatRatePercent)} : ${rules.formatEuros(vatCents)}`;
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

module.exports = { renderMail };
