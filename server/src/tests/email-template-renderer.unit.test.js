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

// End-to-end: the shipped J-7 and J-2 bodies (mails 2 and 3 of specs/guest-email-sequence.md §6.1)
// rendered through the real context builder, with the property facts the sequence reads.
const { buildContext } = require('../utils/emailContextBuilder');
const { ARRIVAL_REMINDER_7D_BODY, ARRIVAL_REMINDER_1D_BODY } = require('../utils/defaultEmailTemplatesRegistry');

// Catalogue ids: 8 bed linen, 9 bath linen, 7 cleaning (L'Estiva includes all three), 3 cleaning
// (La Granja, paid), 33 baby cot.
const OPTION_META = {
  3: { id: 3, title: 'Ménage', autoOptionType: 'cleaning' },
  7: { id: 7, title: 'Ménage', autoOptionType: 'cleaning' },
  8: { id: 8, title: 'Linge de lit', autoOptionType: 'bed_linen' },
  9: { id: 9, title: 'Linge de toilette', autoOptionType: 'bathroom_linen' },
  33: { id: 33, title: 'Lit bébé', autoOptionType: 'baby_bed' },
};
const GRANJA_FACTS = {
  optionMeta: OPTION_META,
  defaults: [{ optionId: 8, offered: 1 }],
  available: [
    { ...OPTION_META[3], price: 80 }, { ...OPTION_META[9], price: 8 }, { ...OPTION_META[33], price: 5 },
  ],
};
const ESTIVA_FACTS = {
  optionMeta: OPTION_META,
  defaults: [{ optionId: 7, offered: 1 }, { optionId: 8, offered: 1 }, { optionId: 9, offered: 1 }],
  available: [{ ...OPTION_META[33], price: 5 }],
};

function render(body, { reservation = {}, property = {}, options = [], facts = GRANJA_FACTS } = {}) {
  const context = buildContext({
    reservation: {
      startDate: '2026-07-10', endDate: '2026-07-13', checkInTime: '16:00', checkOutTime: '10:00',
      adults: 2, children: 0, teens: 0, babies: 0, doubleBeds: 1, singleBeds: 2, finalPrice: 300,
      cautionAmount: 500, cautionReceived: 0, ...reservation,
    },
    client: { firstName: 'Jean', lastName: 'Dupont' },
    property: { name: 'La Granja', nameArticle: 'à', defaultCautionAmount: 500, ...property },
    options,
    stayFacts: facts,
    settings: { companyName: 'GF', smtpFromName: 'GF', companyPhone: '0102' },
  });
  return renderTemplate({ subject: 'x', body }, context);
}

test('J-7 body: the bed configuration is announced with the beds made up', () => {
  const out = render(ARRIVAL_REMINDER_7D_BODY);
  assert.match(out.body, /Nous préparerons les lits ainsi : 1 lit double et 2 lits simples/);
  assert.deepEqual(out.missingVariables, []);
});

test('J-7 body: a baby with the cot booked → the cot and its linen are confirmed', () => {
  const out = render(ARRIVAL_REMINDER_7D_BODY, { reservation: { babies: 1 }, options: [{ optionId: 33, offered: 0, title: 'Lit bébé' }] });
  assert.match(out.body, /Le lit bébé sera installé avant votre arrivée, avec son linge/);
});

test('J-7 body: a baby without the cot → the cot is proposed at its unit price', () => {
  const out = render(ARRIVAL_REMINDER_7D_BODY, { reservation: { babies: 1 } });
  assert.match(out.body, /nous pouvons installer un lit bébé avec son linge \(5 € pour le séjour\)/);
});

test('J-7 body: no baby → no cot sentence at all', () => {
  const out = render(ARRIVAL_REMINDER_7D_BODY);
  assert.doesNotMatch(out.body, /lit bébé/);
});

test('J-7 body: towels are proposed at La Granja, never at L\'Estiva where they are included', () => {
  assert.match(render(ARRIVAL_REMINDER_7D_BODY).body, /Vos serviettes de toilette\. Si vous préférez voyager plus léger/);
  const estiva = render(ARRIVAL_REMINDER_7D_BODY, { property: { name: 'L\'Estiva' }, facts: ESTIVA_FACTS });
  assert.doesNotMatch(estiva.body, /serviettes de toilette/);
});

test('J-2 body: caution cheque asked while not received, never said to be returned', () => {
  const owed = render(ARRIVAL_REMINDER_1D_BODY);
  assert.match(owed.body, /chèque de caution de 500,00 €, que nous vous demanderons à l'arrivée/);
  assert.doesNotMatch(owed.body, /rendu/);
  const received = render(ARRIVAL_REMINDER_1D_BODY, { reservation: { cautionReceived: 1 } });
  assert.doesNotMatch(received.body, /chèque de caution/);
});

test('J-2 body: La Granja without cleaning → the gentle reminder with the sign and the option still open', () => {
  const out = render(ARRIVAL_REMINDER_1D_BODY);
  assert.match(out.body, /vous n'avez pas choisi l'option ménage/);
  assert.match(out.body, /un petit panneau dans le logement/);
  assert.deepEqual(out.missingVariables, []);
});

test('J-2 body: an iCal booking at L\'Estiva with no option line is NOT told cleaning is on them', () => {
  const out = render(ARRIVAL_REMINDER_1D_BODY, { property: { name: 'L\'Estiva' }, facts: ESTIVA_FACTS });
  assert.match(out.body, /Le ménage de fin de séjour est pour nous/);
  assert.doesNotMatch(out.body, /n'avez pas choisi l'option ménage/);
});

test('J-2 body: an unpaid complement is one sentence with its amount, no itemised total', () => {
  const out = render(ARRIVAL_REMINDER_1D_BODY, { reservation: { complementAmount: 45, complementPaid: 0 } });
  assert.match(out.body, /Un complément de 45 € reste à régler sur place à votre arrivée/);
  assert.doesNotMatch(out.body, /Total/);
});

test('J-2 body: the family coffee maker is mentioned only where the property has one', () => {
  assert.match(render(ARRIVAL_REMINDER_1D_BODY, { property: { hasFilterCoffeeMaker: 1 } }).body, /grande cafetière familiale/);
  assert.doesNotMatch(render(ARRIVAL_REMINDER_1D_BODY).body, /cafetière familiale/);
});
