/**
 * What every article family shares (specs/pricing-components.md §3 rule 47): the config schema, the request checks,
 * the tagged amount a line emits and the phrase `describe` prints. A family emits tagged amounts (rule 61), never VAT.
 *
 * Internal to `articles/`.
 */
const { roundMoney, toCents, frenchEuros } = require('../money');

const nonNegative = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? null : 'Un nombre positif ou nul est attendu.');

// The keys of an article instance's `config` (makeArticle). Values per article; defaults are today's.
function configSchemaFor(priceTypes) {
  return [
    { key: 'price', type: 'number', default: 0, scope: 'article', validate: nonNegative },
    { key: 'label', type: 'string', default: '', scope: 'article', validate: (value) => (typeof value === 'string' ? null : 'Un texte est attendu.') },
    { key: 'vatClass', type: 'string', default: 'options', scope: 'article', validate: (value) => (typeof value === 'string' && value ? null : 'Une classe de TVA est attendue.') },
    { key: 'priceType', type: 'string', default: priceTypes[0], scope: 'article', validate: (value) => (typeof value === 'string' && value ? null : 'Un type de prix est attendu.') },
    { key: 'freeUnits', type: 'number', default: 0, scope: 'article', validate: nonNegative },
  ];
}

// Out-of-bounds requests: a quantity that is not a count, or a stay context the family needs and does not have.
// A family that reads the stay (persons, nights, the stay's price) cannot price a sale with no stay: `NEEDS_STAY` (rule 53).
function refusalsOf(request, ctx, { needsPersons = false, needsNights = false, stayBound = false } = {}) {
  const refusals = [];
  if (ctx && ctx.customerContext === 'external' && (needsPersons || needsNights || stayBound)) {
    return [{ code: 'NEEDS_STAY', message: 'Cet article ne se vend qu’avec un séjour.' }];
  }
  const quantity = Number(request && request.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) refusals.push({ code: 'INVALID_QUANTITY', message: 'La quantité doit être un nombre positif ou nul.' });
  if (needsPersons && !(Number.isFinite(Number(ctx && ctx.persons)) && Number(ctx.persons) >= 0)) refusals.push({ code: 'STAY_PERSONS_MISSING', message: 'Le nombre de personnes du séjour est requis.' });
  if (needsNights && !(Number.isFinite(Number(ctx && ctx.nights)) && Number(ctx.nights) >= 0)) refusals.push({ code: 'STAY_NIGHTS_MISSING', message: 'Le nombre de nuits du séjour est requis.' });
  return refusals;
}

// A producer says what an amount is; VAT decides its rate (rule 61). `docKey` is the line key the documents print.
function taggedAmount({ totalPrice, vatClass, ref }) {
  return {
    amountCents: toCents(totalPrice), vatClass, customerContext: 'hosted', source: { kind: 'line', ref }, docKey: ref,
  };
}

// What a family returns before the head merges the sold snapshot, the free units and « offert ».
function priced(config, request, { quantity, unitPrice, billedUnits, typed = null, components = null }) {
  const listTotal = roundMoney(billedUnits * unitPrice);
  return {
    quantity,
    unitPrice,
    billedUnits,
    typed,
    components: components || [{ kind: 'base', units: billedUnits, unitPrice }],
    allowanceUsed: 0,
    amounts: [taggedAmount({ totalPrice: listTotal, vatClass: config.vatClass, ref: request.ref })],
  };
}

// « 2 × 6,50 € · 2 offerts » — the label and the detail every screen prints for a priced line.
function describeLine(config, line) {
  const units = line && line.billedUnits != null ? line.billedUnits : (line && line.quantity) || 0;
  const free = Math.max(0, Number(line && line.freeUnits) || 0);
  const parts = [`${String(units).replace('.', ',')} × ${frenchEuros(line && line.unitPrice)}`];
  if (free > 0) parts.push(`${String(free).replace('.', ',')} ${free > 1 ? 'offerts' : 'offert'}`);
  if (line && line.offered) parts.push('offert');
  return { label: config.label, detail: parts.join(' · ') };
}

module.exports = {
  nonNegative, configSchemaFor, refusalsOf, taggedAmount, priced, describeLine,
};
