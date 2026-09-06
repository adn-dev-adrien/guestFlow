/**
 * Neat-derived guest pricing (specs/neat-cancellation-insurance-subscription.md §3.2 rule 13).
 *
 * Guest price = ceil(premium × (1 + marginPercent/100)) in whole euros — the premium being Neat's
 * own /price answer for the stay's mapped fields. Resolution is async and happens at the request
 * boundary; the pricing engine receives the result as `cancellationInsurancePriceOverride` and
 * stays pure. Premiums go through `neat_price_cache` (24 h freshness); the fallback ladder is
 * fresh cache → live → stale cache → null (static Options tariff, today's behavior).
 */

const crypto = require('crypto');
const { parseMappingJson, validateMapping, buildServiceFieldValues } = require('./neatFieldMapping');

const CACHE_FRESH_MS = 24 * 60 * 60 * 1000;

// Whole-euro ceil: 17.50 € premium + 30 % → 22.75 → 23. A 0 % margin still ceils (17.50 → 18);
// an ABSENT margin (null/'') means Neat pricing is inactive — null, never a 0 % default.
function computeGuestPrice(premium, marginPercent) {
  if (marginPercent === null || marginPercent === undefined || marginPercent === '') return null;
  const p = Number(premium);
  const m = Number(marginPercent);
  if (!Number.isFinite(p) || p < 0 || !Number.isFinite(m) || m < 0) return null;
  return Math.ceil(p * (1 + m / 100));
}

// Tolerates a partial settingsModel (test stubs, like the partial-DDL convention): no
// `neatConfig` reads as « unconfigured », never as a crash.
function readNeatConfig(settingsModel) {
  return settingsModel && typeof settingsModel.neatConfig === 'function' ? settingsModel.neatConfig() : null;
}

function parseContractFields(json) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Guest pricing needs the full configuration AND a margin AND a mapping that validates against the
// cached contract schema. Anything less → inactive (null), never an error.
function pricingConfig(cfg) {
  if (!cfg || !cfg.clientId || !cfg.clientSecret || !cfg.contractId || !cfg.salesChannelId) return null;
  if (cfg.marginPercent === null || cfg.marginPercent === undefined || Number(cfg.marginPercent) < 0) return null;
  const fields = parseContractFields(cfg.contractFieldsJson);
  if (fields.length === 0) return null;
  const mapping = parseMappingJson(cfg.fieldMappingJson);
  if (!validateMapping(mapping, fields).ok) return null;
  return { fields, mapping };
}

function hashFieldValues(serviceFieldValues) {
  return crypto.createHash('sha256').update(JSON.stringify(serviceFieldValues)).digest('hex');
}

/**
 * Resolves the Neat-derived guest price for a prospective stay, or null when Neat pricing is
 * inactive or unreachable with an empty cache (callers then fall back to the static tariff).
 *
 * deps: { settingsModel, cacheModel (neatSubscriptionsModel), buildClient, now? , logger? }
 * staySnapshot: { startDate, endDate, nights, guests, accommodationAmount, totalAmount,
 *                propertyName, reservationRef } — insuranceAmount is unknowable before pricing and
 *                resolves to 0 here (a contract mapping it prices off 0 for the preview).
 */
async function resolveInsurancePricing(deps, staySnapshot) {
  const { settingsModel, cacheModel, buildClient, now = () => new Date(), logger = console } = deps;
  const cfg = readNeatConfig(settingsModel);
  const active = pricingConfig(cfg);
  if (!active) return null;

  const snapshot = { insuranceAmount: 0, ...staySnapshot };
  const serviceFieldValues = buildServiceFieldValues(active.mapping, active.fields, snapshot);
  const fieldsHash = hashFieldValues(serviceFieldValues);
  const nowMs = now().getTime();

  const cached = cacheModel.getCachedPremium(cfg.environment, cfg.contractId, fieldsHash);
  const cacheAge = cached ? nowMs - new Date(cached.fetchedAt).getTime() : Infinity;
  const finish = (premium, source) => {
    const unitPrice = computeGuestPrice(premium, cfg.marginPercent);
    return unitPrice === null ? null : { unitPrice, premium, marginPercent: cfg.marginPercent, source };
  };

  if (cached && cacheAge < CACHE_FRESH_MS) return finish(cached.premium, 'cache');

  try {
    const client = buildClient({ environment: cfg.environment, clientId: cfg.clientId, clientSecret: cfg.clientSecret });
    const { amount } = await client.price(cfg.contractId, { serviceFieldValues, quantity: 1 });
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`Neat price returned a non-amount: ${amount}`);
    cacheModel.storePremium(cfg.environment, cfg.contractId, fieldsHash, amount, new Date(nowMs).toISOString());
    return finish(amount, 'live');
  } catch (err) {
    // Stale cache beats no price; no cache at all → null and the static tariff applies (rule 13).
    logger.warn(`[neat] price failed (${err.message}); ${cached ? 'serving stale cache' : 'falling back to static tariff'}`);
    if (cached) return finish(cached.premium, 'stale-cache');
    return null;
  }
}

/**
 * The stay snapshot of a quote that is not (yet) a stored reservation — public quote/booking,
 * fiche live preview. `totalAmount` deliberately EXCLUDES the insurance line itself, so the
 * premium never depends on whether the visitor already ticked « Oui » (no circularity).
 */
function buildQuoteSnapshot({ startDate, endDate, engineQuote, insuranceLineTotal = 0, propertyName = '', reservationRef = '' }) {
  return {
    startDate,
    endDate,
    nights: Number(engineQuote.nights || 0),
    guests: Number(engineQuote.persons || 0),
    accommodationAmount: Number(engineQuote.cancellationInsuranceBase || 0),
    insuranceAmount: 0,
    totalAmount: Math.max(0, Number(engineQuote.totalStayPrice || 0) - Number(insuranceLineTotal || 0)),
    propertyName,
    reservationRef,
  };
}

/**
 * Cache-only, SYNCHRONOUS resolution — for the sync engine paths (devis compute, reservation
 * save) that cannot await a live call. Any cached premium serves (stale included): the async
 * preview paths keep the cache warm, and a stale price beats an inconsistent one. Null on a cold
 * cache → the static tariff applies (rule 13 fallback ladder).
 */
function resolveInsurancePricingSync(deps, staySnapshot) {
  const { settingsModel, cacheModel } = deps;
  const cfg = readNeatConfig(settingsModel);
  const active = pricingConfig(cfg);
  if (!active) return null;
  const snapshot = { insuranceAmount: 0, ...staySnapshot };
  const serviceFieldValues = buildServiceFieldValues(active.mapping, active.fields, snapshot);
  const cached = cacheModel.getCachedPremium(cfg.environment, cfg.contractId, hashFieldValues(serviceFieldValues));
  if (!cached) return null;
  const unitPrice = computeGuestPrice(cached.premium, cfg.marginPercent);
  return unitPrice === null ? null : { unitPrice, premium: cached.premium, marginPercent: cfg.marginPercent, source: 'cache' };
}

// Shared plumbing of the two reprice wrappers below: snapshot the FIRST engine run, then hand the
// resolved unit price back through a second run. Returns null when Neat pricing does not apply.
function prepareReprice({ engineInput, quote, settingsModel }) {
  if (!engineInput || !engineInput.db || !quote || quote.error) return null;
  if (!pricingConfig(readNeatConfig(settingsModel))) return null;
  const { db } = engineInput;
  const insuranceOpt = db.prepare('SELECT id FROM options WHERE isCancellationInsurance = 1 ORDER BY id LIMIT 1').get();
  if (!insuranceOpt) return null;
  const line = (quote.optionLines || []).find((l) => Number(l.optionId) === Number(insuranceOpt.id));
  const property = db.prepare('SELECT name FROM properties WHERE id = ?').get(Number(engineInput.propertyId));
  return buildQuoteSnapshot({
    startDate: engineInput.startDate,
    endDate: engineInput.endDate,
    engineQuote: quote,
    insuranceLineTotal: line ? Number(line.totalPrice || 0) : 0,
    propertyName: property ? String(property.name || '') : '',
  });
}

/**
 * SYNC reprice for the engine paths that cannot await (devis compute, reservation create/save):
 * cache-only resolution, then a second engine run with the override. On a cold cache the original
 * quote is returned untouched (static tariff — rule 13 fallback). `calculate` is the engine
 * function, injected to keep this module engine-agnostic and the tests self-contained.
 */
function repriceQuoteWithNeatSync({ engineInput, quote, settingsModel, cacheModel, calculate }) {
  const snapshot = prepareReprice({ engineInput, quote, settingsModel });
  if (!snapshot) return { quote, neatPricing: null };
  const neatPricing = resolveInsurancePricingSync({ settingsModel, cacheModel }, snapshot);
  if (!neatPricing) return { quote, neatPricing: null };
  const repriced = calculate({ ...engineInput, cancellationInsurancePriceOverride: neatPricing.unitPrice });
  return { quote: repriced.error ? quote : repriced, neatPricing };
}

/**
 * ASYNC reprice for the preview paths (public /quote, fiche calculate-price): live resolution
 * through the cache — which it WARMS, so the sync save paths that follow read the same premium.
 */
async function repriceQuoteWithNeatLive({ engineInput, quote, settingsModel, cacheModel, buildClient, calculate, now, logger }) {
  const snapshot = prepareReprice({ engineInput, quote, settingsModel });
  if (!snapshot) return { quote, neatPricing: null };
  const neatPricing = await resolveInsurancePricing({ settingsModel, cacheModel, buildClient, now, logger }, snapshot);
  if (!neatPricing) return { quote, neatPricing: null };
  const repriced = calculate({ ...engineInput, cancellationInsurancePriceOverride: neatPricing.unitPrice });
  return { quote: repriced.error ? quote : repriced, neatPricing };
}

// Whether Neat-derived guest pricing is fully configured (drives the public visibility of a
// 0-priced insurance and the « Tarif calculé pour vos dates » label).
function isNeatPricingActive(settingsModel) {
  return Boolean(pricingConfig(readNeatConfig(settingsModel)));
}

module.exports = {
  computeGuestPrice,
  readNeatConfig,
  isNeatPricingActive,
  resolveInsurancePricing,
  resolveInsurancePricingSync,
  repriceQuoteWithNeatSync,
  repriceQuoteWithNeatLive,
  buildQuoteSnapshot,
  pricingConfig,
  hashFieldValues,
  CACHE_FRESH_MS,
};
