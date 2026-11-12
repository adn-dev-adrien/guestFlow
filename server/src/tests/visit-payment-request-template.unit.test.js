// the outside-visit spec (outside-booking-sas) rule 42 — the visit payment request template: seeded French and English, stored manual, event-triggered,
// a money template (never auto), not an exception of autoSendPolicy, listed by no date-driven queue.
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../utils/defaultEmailTemplatesRegistry');
const { templateAutoSends, AUTO_SEND_EXCEPTIONS } = require('../utils/autoSendPolicy');

const template = registry.DEFAULT_TEMPLATES.find((t) => t.stableKey === 'visit_payment_request');

test('rule 42: seeded in both languages, stored manual and enabled', () => {
  assert.ok(template);
  assert.equal(template.sendMode, 'manual');
  assert.ok(template.subject && template.body && template.subjectEn && template.bodyEn);
  assert.match(template.body, /\{\{paymentLink\}\}/);
  assert.match(template.bodyEn, /\{\{paymentLink\}\}/);
});

test('rule 42: it is event-triggered and a money template, so no cron and no queue ever sends it', () => {
  assert.ok(registry.EVENT_TRIGGERED_STABLE_KEYS.includes('visit_payment_request'));
  assert.ok(registry.PAYMENT_STABLE_KEYS.includes('visit_payment_request'));
  assert.equal(AUTO_SEND_EXCEPTIONS.includes('visit_payment_request'), false);
  assert.equal(templateAutoSends({ ...template, sendMode: 'auto' }), false, 'even stored auto, it does not send by itself');
});
