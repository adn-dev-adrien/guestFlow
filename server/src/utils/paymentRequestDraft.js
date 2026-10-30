/**
 * The email a payment row offers when no online payment is ready (specs/plugins-phase-3a-online-payment.md
 * rule 25). The operator reads it in the send dialog first, so it must read well without a link:
 * a template that prints `{{paymentLink}}` outside `{{#if hasPaymentLink}}` would end on « en ligne : »
 * and nothing — and one that prints the link's end there would read « valable jusqu'au . »
 * (specs/payment-link-lifecycle.md rule 36). Pure.
 *
 *   draftTemplateFor(templates, type, requestSent) → the template id, or null
 *
 * The request is preferred while the guest was never asked, the reminder once asked or when the
 * request cannot go without a link.
 */

const { namesUsedOutside } = require('./templateTokens');

const REQUEST = Object.freeze({ deposit: 'deposit_request', balance: 'balance_request' });
const REMINDER = Object.freeze({ deposit: 'deposit_reminder', balance: 'balance_reminder' });

const LINK_NAMES = ['paymentLink', 'paymentLinkValidUntil'];

function readsWithoutLink(template) {
  return ['subject', 'body', 'subjectEn', 'bodyEn'].every((field) => {
    const outside = namesUsedOutside(template[field], 'hasPaymentLink');
    return LINK_NAMES.every((name) => !outside.has(name));
  });
}

function draftTemplateFor(templates, type, requestSent) {
  const keys = requestSent ? [REMINDER[type]] : [REQUEST[type], REMINDER[type]];
  for (const key of keys) {
    const t = (templates || []).find((row) => row && row.stableKey === key && Number(row.enabled) === 1);
    if (t && readsWithoutLink(t)) return Number(t.id);
  }
  return null;
}

module.exports = { draftTemplateFor, REQUEST, REMINDER };
