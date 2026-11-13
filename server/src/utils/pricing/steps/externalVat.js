/**
 * STEP vat (external) — the VAT of an external sale's lines (specs/pricing-components.md §3 rules 51, 61, 62).
 *
 * Every line is a tagged amount with `customerContext = 'external'` and its article's class, and the VAT component resolves
 * `vat.rate.<class>.external`. A line the document already stores keeps the rate it was sold at (rule 74): its amount is cut at that
 * frozen rate. The VAT is rounded once per (class, rate) group of the whole document and shared over its lines (rule 62), so
 * the new lines and the stored ones are cut together. A class with no external rate answers `VAT_RATE_UNKNOWN` for the lines that need it.
 */
const { vatOf, resolveRate } = require('../vat');

const refuse = (ref, vatClass) => ({ ref, code: 'VAT_RATE_UNKNOWN', message: `TVA du client extérieur à renseigner pour la classe « ${vatClass} ».` });

// `amounts[i] = { ...tagged, rate, vatCents, netCents }` for the stored lines (at their frozen rate) and the new ones (at the rate in force).
function vatOfDocument(tagged, { regime, settings }) {
  const byRate = new Map();
  tagged.forEach((amount, index) => {
    const key = `${amount.vatClass}|${amount.frozenRate == null ? 'live' : amount.frozenRate}`;
    if (!byRate.has(key)) byRate.set(key, []);
    byRate.get(key).push(index);
  });
  const amounts = new Array(tagged.length);
  const groups = [];
  for (const indexes of byRate.values()) {
    const frozen = tagged[indexes[0]].frozenRate;
    const pinned = frozen == null ? settings : { get: () => frozen };
    const result = vatOf(indexes.map((index) => tagged[index]), { regime: frozen == null ? regime : null, settings: pinned });
    indexes.forEach((index, position) => { amounts[index] = result.amounts[position]; });
    groups.push(...result.groups);
  }
  return { amounts, groups };
}

const step = {
  id: 'externalVat',
  requires: ['quoted', 'stored', 'settings', 'vatRegime'],
  provides: ['familyVat', 'vatRefusals'],
  apply(ctx) {
    const vatRefusals = [];
    const tagged = [];
    ctx.stored.forEach((line) => tagged.push({
      amountCents: line.offered || line.cancelled ? 0 : line.totalCents, vatClass: line.vatClass, customerContext: 'external', frozenRate: Number(line.vatRate || 0), source: { kind: 'stored', ref: line.ref },
    }));
    const slots = [];
    ctx.quoted.forEach((line, index) => {
      if (!line) { slots.push(null); return; }
      const amount = line.taggedAmounts[0];
      try {
        resolveRate(amount.vatClass, 'external', { regime: ctx.vatRegime, settings: ctx.settings.vat });
        slots.push(tagged.length);
        tagged.push(amount);
      } catch (err) {
        if (err.code !== 'VAT_RATE_UNKNOWN') throw err;
        slots.push(null);
        vatRefusals.push(refuse(line.ref, amount.vatClass));
      }
    });
    const familyVat = vatOfDocument(tagged, { regime: ctx.vatRegime, settings: ctx.settings.vat });
    return { ...ctx, familyVat: { ...familyVat, slots }, vatRefusals };
  },
};

module.exports = step;
