// Pure template renderer — variables + single-level conditionals.
// See specs/email-automation.md §3 rules 3 + 4.

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderTemplate } = require('../utils/emailTemplateRenderer');

test('renderTemplate substitutes simple {{variable}} tokens in subject + body', () => {
  const out = renderTemplate(
    { subject: 'Hello {{firstName}}', body: 'Dear {{firstName}} {{lastName}}' },
    { vars: { firstName: 'Jean', lastName: 'Dupont' } },
  );
  assert.equal(out.subject, 'Hello Jean');
  assert.equal(out.body, 'Dear Jean Dupont');
  assert.deepEqual(out.missingVariables, []);
});

test('renderTemplate: unknown variable renders as empty string + reports in missingVariables', () => {
  const out = renderTemplate(
    { subject: 'Subject', body: 'Hi {{firstName}}, your code is {{accessCode}}' },
    { vars: { firstName: 'Jean' } },
  );
  assert.equal(out.body, 'Hi Jean, your code is ');
  assert.deepEqual(out.missingVariables, ['accessCode']);
});

test('renderTemplate: null / undefined variable values render as empty (never "null"/"undefined")', () => {
  const out = renderTemplate(
    { subject: '{{a}}{{b}}{{c}}', body: '' },
    { vars: { a: null, b: undefined, c: 'X' } },
  );
  assert.equal(out.subject, 'X');
});

test('renderTemplate: number values are stringified', () => {
  const out = renderTemplate(
    { subject: '', body: 'You stay {{nights}} nights' },
    { vars: { nights: 3 } },
  );
  assert.equal(out.body, 'You stay 3 nights');
});

test('renderTemplate: same token repeated several times', () => {
  const out = renderTemplate(
    { subject: '', body: '{{name}}, {{name}}, {{name}}' },
    { vars: { name: 'A' } },
  );
  assert.equal(out.body, 'A, A, A');
});

// ---- conditionals ----

test('{{#if flag}}…{{/if}} keeps the block when flag is truthy', () => {
  const out = renderTemplate(
    { subject: '', body: 'Start{{#if show}}-INNER-{{/if}}End' },
    { vars: {}, flags: { show: true } },
  );
  assert.equal(out.body, 'Start-INNER-End');
});

test('{{#if flag}}…{{/if}} drops the block when flag is falsy / missing', () => {
  const out = renderTemplate(
    { subject: '', body: 'Start{{#if show}}-INNER-{{/if}}End' },
    { vars: {}, flags: { show: false } },
  );
  assert.equal(out.body, 'StartEnd');

  const noFlags = renderTemplate(
    { subject: '', body: 'Start{{#if show}}-INNER-{{/if}}End' },
    { vars: {} },
  );
  assert.equal(noFlags.body, 'StartEnd');
});

test('{{#if}}…{{else}}…{{/if}} picks the right branch', () => {
  const tpl = { subject: '', body: '{{#if hasOption}}With option{{else}}Without option{{/if}}' };

  const yes = renderTemplate(tpl, { vars: {}, flags: { hasOption: true } });
  assert.equal(yes.body, 'With option');

  const no = renderTemplate(tpl, { vars: {}, flags: { hasOption: false } });
  assert.equal(no.body, 'Without option');
});

test('variables INSIDE a conditional are evaluated only when the branch is emitted', () => {
  // {{forgotten}} sits inside a falsy branch → it must NOT show up in missingVariables.
  const out = renderTemplate(
    { subject: '', body: '{{#if show}}Code: {{forgotten}}{{/if}}' },
    { vars: {}, flags: { show: false } },
  );
  assert.equal(out.body, '');
  assert.deepEqual(out.missingVariables, []);
});

test('variables inside an EMITTED conditional are tracked in missingVariables', () => {
  const out = renderTemplate(
    { subject: '', body: '{{#if show}}Code: {{forgotten}}{{/if}}' },
    { vars: {}, flags: { show: true } },
  );
  assert.equal(out.body, 'Code: ');
  assert.deepEqual(out.missingVariables, ['forgotten']);
});

test('multiple sibling conditional blocks are evaluated independently', () => {
  const out = renderTemplate(
    { subject: '', body: '{{#if a}}A{{/if}}|{{#if b}}B{{/if}}|{{#if c}}C{{/if}}' },
    { vars: {}, flags: { a: true, b: false, c: true } },
  );
  assert.equal(out.body, 'A||C');
});

test('malformed {{#if}} without {{/if}} is passed through verbatim', () => {
  // Renderer is fail-safe: no crash; the operator sees the literal token in preview.
  const out = renderTemplate(
    { subject: '', body: 'Start {{#if oops}} no closing tag' },
    { vars: {}, flags: { oops: true } },
  );
  assert.equal(out.body, 'Start {{#if oops}} no closing tag');
});

test('whitespace around the variable name is tolerated', () => {
  const out = renderTemplate(
    { subject: '', body: 'Hello {{  firstName  }}' },
    { vars: { firstName: 'Jean' } },
  );
  assert.equal(out.body, 'Hello Jean');
});

// End-to-end (specs/j7-email-baby-beds.md): the shipped J-7 body renders the baby-bed notice
// driven by the context builder's hasBabyBedNotice flag + babyBedNotice var.
const { buildContext } = require('../utils/emailContextBuilder');
const { ARRIVAL_REMINDER_7D_BODY } = require('../utils/defaultEmailTemplatesRegistry');

function j7Input(reservationOver) {
  return buildContext({
    reservation: {
      startDate: '2026-07-10', endDate: '2026-07-13', checkInTime: '15:00', checkOutTime: '10:00',
      adults: 2, children: 0, teens: 0, finalPrice: 300, ...reservationOver,
    },
    client: { firstName: 'Jean', lastName: 'Dupont' },
    property: { name: 'Gite', nameArticle: 'au' },
    options: [],
    settings: { companyName: 'GF', smtpFromName: 'GF' },
  });
}

test('J-7 body: babies + a baby bed → notice with the provided bed appears', () => {
  const out = renderTemplate({ subject: 'x', body: ARRIVAL_REMINDER_7D_BODY }, j7Input({ babies: 1, babyBeds: 1 }));
  assert.match(out.body, /un lit bébé vous est fourni/);
});

test('J-7 body: babies but no baby bed → "bring one" notice appears', () => {
  const out = renderTemplate({ subject: 'x', body: ARRIVAL_REMINDER_7D_BODY }, j7Input({ babies: 1, babyBeds: 0 }));
  assert.match(out.body, /ne disposons plus de lit bébé/);
  assert.match(out.body, /apporter un/);
});

test('J-7 body: no babies → no baby-bed notice at all', () => {
  const out = renderTemplate({ subject: 'x', body: ARRIVAL_REMINDER_7D_BODY }, j7Input({ babies: 0, babyBeds: 0 }));
  assert.doesNotMatch(out.body, /lit bébé/);
});

// ── J-1 reminder body (specs/j1-arrival-reminder-email.md §3 + §6) ───────────────

const { ARRIVAL_REMINDER_1D_BODY } = require('../utils/defaultEmailTemplatesRegistry');

function j1Input({ reservation = {}, options = [], resources = [] } = {}) {
  return buildContext({
    reservation: {
      startDate: '2026-07-10', endDate: '2026-07-13', checkInTime: '16:00', checkOutTime: '10:00',
      adults: 2, children: 0, teens: 0, babies: 0, finalPrice: 300,
      cautionAmount: 500, cautionReceived: 0, ...reservation,
    },
    client: { firstName: 'Jean', lastName: 'Dupont' },
    property: { name: 'Gite', nameArticle: 'au' },
    options,
    resources,
    settings: { companyName: 'GF', smtpFromName: 'GF', companyPhone: '0102' },
  });
}

test('J-1 body: caution not received + no linen + no cleaning → all three reminders render', () => {
  const out = renderTemplate({ subject: 'x', body: ARRIVAL_REMINDER_1D_BODY }, j1Input({
    resources: [{ name: 'Bain nordique' }],
  }));
  assert.match(out.body, /chèque de caution de 500,00 €/);
  assert.match(out.body, /linge de lit n'est pas inclus/);
  assert.match(out.body, /ménage de fin de séjour n'a pas été réservé/);
  assert.match(out.body, /Équipements réservés : Bain nordique/);
  assert.deepEqual(out.missingVariables, []);
});

test('J-1 body: caution received + linen + cleaning booked → none of the three reminders render', () => {
  const out = renderTemplate({ subject: 'x', body: ARRIVAL_REMINDER_1D_BODY }, j1Input({
    reservation: { cautionAmount: 500, cautionReceived: 1 },
    options: [
      { title: 'Linge de lit', autoOptionType: 'bed_linen' },
      { title: 'Ménage', autoOptionType: 'cleaning' },
    ],
  }));
  assert.doesNotMatch(out.body, /chèque de caution/);
  assert.doesNotMatch(out.body, /n'est pas inclus/);
  assert.doesNotMatch(out.body, /à votre charge/);
  assert.match(out.body, /Options réservées : Linge de lit, Ménage/);
});

test('J-1 body: no resources → no "Équipements réservés" line', () => {
  const out = renderTemplate({ subject: 'x', body: ARRIVAL_REMINDER_1D_BODY }, j1Input({ resources: [] }));
  assert.doesNotMatch(out.body, /Équipements réservés/);
});
