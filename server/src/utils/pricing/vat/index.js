/**
 * VAT — the one place a rate is resolved and a VAT is cut out of a TTC amount (specs/pricing-components.md §3 rules 51, 61, 62).
 *
 * Contract:
 * - `resolveRate(vatClass, customerContext, { regime, settings })` → the rate in percent. A franchise regime
 *   (`regime.regime === 'not_subject'`) and the class `outOfScope` give 0; otherwise the setting
 *   `vat.rate.<vatClass>.<customerContext>` when it is set, else (PR A) the regime's rate for `hosted`. An `external`
 *   rate nobody set throws `VAT_RATE_UNKNOWN`.
 * - `vatOf(taggedAmounts, { regime, settings })` → `{ amounts, groups, byRate, totals }` from
 *   `[{ amountCents (TTC), vatClass, customerContext, source, docKey }]`. The VAT is rounded ONCE per (vatClass, rate,
 *   customerContext) group on the group's TTC total, then shared over the group's amounts by largest remainder
 *   (`money.allocateCents`) for per-line display: `amounts[i] = { ...tagged, rate, vatCents, netCents }`.
 * - Named rounding strategies, each the arithmetic of a reader that existed before this unit and moved here unchanged:
 *   `splitTtc` (engine, accounting buckets: VAT first, net by difference), `netFirst` (hourly bookings: net first, VAT by
 *   difference), `htOfPortion` (finance pages: the HT share of a TTC portion), and the Qonto basket's integer-cent helpers
 *   `rateToBasis`, `lineTotalCents`, `htFromTtc`.
 *
 * Pure: no DB, no clock. The caller hands the regime (`vatRegimeModel.forRow`) and, optionally, the settings.
 */
const {
  roundMoney, toCents, fromCents, allocateCents,
} = require('../money');
const { rateKey, settingsSchema } = require('./settingsSchema');

function readSetting(settings, key) {
  if (!settings) return undefined;
  const value = typeof settings.get === 'function' ? settings.get(key) : settings[key];
  return value === undefined || value === null || value === '' ? undefined : Number(value);
}

function resolveRate(vatClass, customerContext, { regime = null, settings = null } = {}) {
  if (regime && regime.regime === 'not_subject') return 0;
  if (vatClass === 'outOfScope') return 0;
  const configured = readSetting(settings, rateKey(vatClass, customerContext));
  if (Number.isFinite(configured)) return configured;
  if (customerContext === 'hosted' && regime) return Number(regime.rate || 0);
  const error = new Error(`VAT_RATE_UNKNOWN: ${rateKey(vatClass, customerContext)}`);
  error.code = 'VAT_RATE_UNKNOWN';
  throw error;
}

// Strategy « VAT first »: the VAT is the rounded share of the TTC, the net is what is left.
function splitTtc(ttc, rate) {
  const vat = roundMoney(ttc * (rate / (100 + rate)));
  const net = roundMoney(ttc - vat);
  return { vat, net };
}

// Strategy « net first »: the net is the rounded TTC without VAT, the VAT is what is left.
function netFirst(total, rate) {
  const net = roundMoney(total / (1 + rate / 100));
  return { amount: roundMoney(total - net), net };
}

// Strategy « HT share »: the HT of a TTC portion of a stay is the portion times the HT fraction of the stay's whole TTC
// (the VAT-able price over the VAT-able price plus the tourist tax, the tax bearing no VAT).
function htOfPortion({
  portion: ttcPortion, finalPrice: finalPriceInput, touristTaxTotal, vatRate,
}) {
  const portion = Number(ttcPortion || 0);
  if (portion <= 0) return 0;
  const finalPrice = Math.max(0, Number(finalPriceInput || 0));
  const tax = Math.max(0, Number(touristTaxTotal || 0));
  const fullTtc = finalPrice + tax;
  if (fullTtc <= 0) return 0;
  const ratio = (finalPrice / (1 + vatRate / 100)) / fullTtc;
  return roundMoney(portion * ratio);
}

// Rate as integer hundredths-of-a-percent so 10 % → 1000, 8.5 % → 850, 20 % → 2000. Keeps everything
// in integers: a line total = htCents × (10000 + R) / 10000.
function rateToBasis(vatRatePercent) {
  return Math.round(Number(vatRatePercent || 0) * 100);
}

// Qonto's per-line total (cents) for an HT amount at rate R (basis). Half-up, integer-exact.
function lineTotalCents(htCents, R) {
  if (R <= 0) return htCents;
  return Math.floor((htCents * (10000 + R) + 5000) / 10000);
}

// HT (cents) whose Qonto line total is ≤ the TTC target (floor → non-negative residual).
function htFromTtc(ttcCents, R) {
  if (R <= 0) return ttcCents;
  return Math.floor((ttcCents * 10000) / (10000 + R));
}

// The group's VAT shared over its amounts in proportion, largest remainder first. A group of positive amounts is
// `money.allocateCents`; a group holding a discount (a negative amount) shares in proportion to the signed amounts.
function shareCents(totalCents, amountsCents) {
  if (totalCents >= 0 && amountsCents.every((cents) => cents >= 0)) return allocateCents(totalCents, amountsCents);
  const sum = amountsCents.reduce((a, b) => a + b, 0);
  if (sum === 0) return amountsCents.map(() => 0);
  const exact = amountsCents.map((cents) => (totalCents * cents) / sum);
  const shares = exact.map((x) => Math.floor(x));
  let left = totalCents - shares.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, index) => ({ index, remainder: Math.round((x - Math.floor(x)) * 1e9) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; left > 0 && i < order.length; i += 1, left -= 1) shares[order[i].index] += 1;
  return shares;
}

function vatOf(taggedAmounts, { regime = null, settings = null } = {}) {
  const list = (taggedAmounts || []).map((tagged) => ({
    ...tagged,
    customerContext: tagged.customerContext || 'hosted',
    rate: resolveRate(tagged.vatClass, tagged.customerContext || 'hosted', { regime, settings }),
  }));
  const byKey = new Map();
  list.forEach((amount, index) => {
    const key = `${amount.vatClass}|${amount.rate}|${amount.customerContext}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        vatClass: amount.vatClass, rate: amount.rate, customerContext: amount.customerContext, indexes: [],
      });
    }
    byKey.get(key).indexes.push(index);
  });

  const groups = [...byKey.values()].map((group) => {
    const ttcCents = group.indexes.reduce((sum, index) => sum + Math.round(Number(list[index].amountCents || 0)), 0);
    const { vat } = splitTtc(fromCents(ttcCents), group.rate);
    const vatCents = toCents(vat);
    const shares = shareCents(vatCents, group.indexes.map((index) => Math.round(Number(list[index].amountCents || 0))));
    group.indexes.forEach((index, position) => {
      list[index].vatCents = shares[position];
      list[index].netCents = Math.round(Number(list[index].amountCents || 0)) - shares[position];
    });
    return {
      vatClass: group.vatClass,
      rate: group.rate,
      customerContext: group.customerContext,
      count: group.indexes.length,
      ttcCents,
      vatCents,
      netCents: ttcCents - vatCents,
    };
  });

  const byRateMap = new Map();
  for (const group of groups) {
    const row = byRateMap.get(group.rate) || {
      rate: group.rate, ttcCents: 0, vatCents: 0, netCents: 0,
    };
    row.ttcCents += group.ttcCents;
    row.vatCents += group.vatCents;
    row.netCents += group.netCents;
    byRateMap.set(group.rate, row);
  }
  const totals = groups.reduce((sum, group) => ({
    ttcCents: sum.ttcCents + group.ttcCents,
    vatCents: sum.vatCents + group.vatCents,
    netCents: sum.netCents + group.netCents,
  }), { ttcCents: 0, vatCents: 0, netCents: 0 });

  return {
    amounts: list, groups, byRate: [...byRateMap.values()], totals,
  };
}

module.exports = {
  settingsSchema,
  vatOf,
  resolveRate,
  splitTtc,
  netFirst,
  htOfPortion,
  rateToBasis,
  lineTotalCents,
  htFromTtc,
};
