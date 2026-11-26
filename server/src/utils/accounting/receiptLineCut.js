/**
 * The VAT cut of a receipt on a stay the sale-line readers serve (specs/pricing/pricing-components.md §3 rules 51, 61, 62, 63;
 * owner 2026-11-15 « Brancher quand même », read with « éviter de toucher les anciens séjours », utils/saleLinesReaders.js).
 *
 * `cutReceipt(entry, { regime, saleLines })` → the entry with `fraction: 1` and its `buckets` cut by the VAT component:
 *   1. the revenue the receipt credits (its TTC less its tourist tax, in cents) is allocated to the families the entry's buckets
 *      name (accommodation, options, resources), by largest remainder on their TTC — the receipt's own share, never a ratio
 *      applied to HT and VAT separately;
 *   2. inside a family, to the VAT classes of the stay's sale lines of that family (`saleLines`, the sale detail's lines), by
 *      their totals — a drink sold on a stay is cut as a drink;
 *   3. `vatOf` cuts the receipt ONCE per (class, rate) group (rule 62: a receipt is a document), and the shares come back as one
 *      bucket per (family, rate): `{ name, ht, vat, ratePercent }`.
 *   The platform commission's VAT is the VAT component's « VAT first » cut (`splitTtc`), like the sales'.
 * `cutRefund(entry, { regime })` → an avoir's buckets cut once per (bucket, rate) group by `vatOf`; a closing avoir (it debits what
 * is left on the accounts) is returned as it is.
 * Entries that are not a stay's sale or avoir are returned as they are. Pure: no DB, no clock.
 */
const { vatOf, splitTtc } = require('../pricing/vat');
const { allocateCents, toCents, fromCents } = require('../pricing/money');

const FAMILIES = Object.freeze(['accommodation', 'options', 'resources']);
const FAMILY_OF_KIND = Object.freeze({
  accommodation: 'accommodation', extraGuests: 'accommodation', option: 'options', custom: 'options', resource: 'resources',
});
const SALE_KINDS = new Set(['deposit', 'balance', 'complement', 'installment', 'endOfStayComplement', 'midStayComplement']);

// The VAT classes of a family on the stay's sale lines, with their weight; the family's own class when no line says otherwise.
function classesOf(family, saleLines) {
  const weights = new Map();
  for (const line of saleLines || []) {
    if (FAMILY_OF_KIND[line.kind] !== family || !line.vatClass) continue;
    const weight = Math.max(0, Number(line.totalCents || 0));
    if (weight > 0) weights.set(line.vatClass, (weights.get(line.vatClass) || 0) + weight);
  }
  return weights.size ? [...weights.entries()] : [[family, 1]];
}

function bucketsFrom(tagged, regime) {
  if (!tagged.length) return [];
  const { amounts } = vatOf(tagged, { regime, settings: null });
  const byBucket = new Map();
  for (const amount of amounts) {
    const key = `${amount.bucket}|${amount.rate}`;
    const bucket = byBucket.get(key) || { name: amount.bucket, htCents: 0, vatCents: 0, ratePercent: amount.rate };
    bucket.htCents += amount.netCents;
    bucket.vatCents += amount.vatCents;
    byBucket.set(key, bucket);
  }
  return [...byBucket.values()]
    .map((b) => ({ name: b.name, ht: fromCents(b.htCents), vat: fromCents(b.vatCents), ratePercent: b.ratePercent }))
    .filter((b) => b.ht > 0 || b.vat > 0);
}

function cutCommission(commission) {
  if (!commission || !commission.hasVat || !(commission.ttc > 0)) return commission;
  const { vat, net } = splitTtc(commission.ttc, Number(commission.vatRate) || 0);
  return { ...commission, ht: net, vat };
}

function cutReceipt(entry, { regime = null, saleLines = [] } = {}) {
  if (!entry || entry.direction || !SALE_KINDS.has(entry.kind)) return entry;
  const revenueCents = toCents(entry.encaissementTtc) - toCents(entry.taxTtc || 0);
  const families = FAMILIES.map((name) => {
    const own = (entry.buckets || []).filter((b) => b.name === name);
    return { name, weight: own.reduce((sum, b) => sum + toCents(Number(b.ht || 0) + Number(b.vat || 0)), 0) };
  });
  if (!(revenueCents > 0) || families.every((f) => f.weight <= 0)) return { ...entry, commission: cutCommission(entry.commission) };
  const familyCents = allocateCents(revenueCents, families.map((f) => f.weight));
  const tagged = [];
  families.forEach((family, index) => {
    if (!(familyCents[index] > 0)) return;
    const classes = classesOf(family.name, saleLines);
    const classCents = allocateCents(familyCents[index], classes.map(([, weight]) => weight));
    classes.forEach(([vatClass], position) => {
      if (classCents[position] > 0) {
        tagged.push({
          amountCents: classCents[position], vatClass, customerContext: 'hosted', bucket: family.name, source: { kind: 'receipt' }, docKey: entry.kind,
        });
      }
    });
  });
  return { ...entry, fraction: 1, buckets: bucketsFrom(tagged, regime), commission: cutCommission(entry.commission) };
}

function cutRefund(entry, { regime = null } = {}) {
  if (!entry || entry.direction !== 'refund' || entry.closing) return entry;
  const tagged = (entry.buckets || [])
    .map((b) => ({ ttcCents: toCents(Number(b.ht || 0) + Number(b.vat || 0)), b }))
    .filter(({ ttcCents, b }) => ttcCents > 0 && Number(b.ratePercent || 0) > 0)
    .map(({ ttcCents, b }) => ({
      amountCents: ttcCents, vatClass: `${b.name}@${Number(b.ratePercent)}`, customerContext: 'hosted', bucket: b.name, source: { kind: 'refund' }, docKey: 'refund', fixedRate: Number(b.ratePercent),
    }));
  if (!tagged.length) return entry;
  // An avoir gives back at the rate each line was re-rated with (rule 64): the rate is the line's, the cut is the VAT component's.
  const settings = Object.fromEntries(tagged.map((t) => [`vat.rate.${t.vatClass}.hosted`, t.fixedRate]));
  const { amounts } = vatOf(tagged, { regime: regime && regime.regime === 'not_subject' ? null : regime, settings });
  const cut = new Map(amounts.map((a) => [`${a.bucket}|${a.rate}`, a]));
  return {
    ...entry,
    buckets: (entry.buckets || []).map((b) => {
      const a = cut.get(`${b.name}|${Number(b.ratePercent || 0)}`);
      return a ? { ...b, ht: fromCents(a.netCents), vat: fromCents(a.vatCents) } : b;
    }),
  };
}

module.exports = { cutReceipt, cutRefund };
