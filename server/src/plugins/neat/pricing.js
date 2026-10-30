/**
 * Neat-derived guest pricing (specs/neat-cancellation-insurance-subscription.md §3.2 rule 13), declared to
 * the core as its quote post-processor (specs/plugins-phase-3b-neat.md rules 1, 7).
 *
 * Guest price = ceil(premium × (1 + marginPercent/100)) in whole euros — the premium being Neat's
 * own /price answer for the stay's mapped fields. Resolution is async and happens at the request
 * boundary; the core re-runs its engine with the result (`utils/quotePostProcessors.js`) and the
 * engine stays pure. Premiums go through `neat_price_cache` (24 h freshness); the fallback ladder is
 * fresh cache → live → stale cache → null (static Options tariff, today's behavior).
 */

const crypto = require('crypto');
const { parseMappingJson, validateMapping, buildServiceFieldValues } = require('./fieldMapping');

const CACHE_FRESH_MS = 24 * 60 * 60 * 1000;
// After a failed live call Neat is not asked again for this long: an outage costs one bounded wait,
// not one per quote. Guest pricing only — the subscription pass keeps its own retry schedule.
const BREAKER_MS = 60 * 1000;
const breakerOpenUntil = new Map();

// Only an outage opens the breaker: a timeout, a network error (no HTTP status) or a 5xx. A 4xx — Neat
// refusing the fields of one particular stay — says nothing about the next stay.
function isOutage(err) {
  return !err || err.status === undefined || err.status >= 500;
}

function resetPriceBreaker() { breakerOpenUntil.clear(); }

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

  const breakerKey = `${cfg.environment}:${cfg.clientId}`;
  if ((breakerOpenUntil.get(breakerKey) || 0) > nowMs) {
    return cached ? finish(cached.premium, 'stale-cache') : null;
  }

  try {
    const client = buildClient({ environment: cfg.environment, clientId: cfg.clientId, clientSecret: cfg.clientSecret });
    const { amount } = await client.price(cfg.contractId, { serviceFieldValues, quantity: 1 });
    if (!Number.isFinite(amount) || amount < 0) {
      throw Object.assign(new Error(`Neat price returned a non-amount: ${amount}`), { status: 422 });
    }
    breakerOpenUntil.delete(breakerKey);
    cacheModel.storePremium(cfg.environment, cfg.contractId, fieldsHash, amount, new Date(nowMs).toISOString());
    return finish(amount, 'live');
  } catch (err) {
    // Stale cache beats no price; no cache at all → null and the static tariff applies (rule 13).
    if (isOutage(err)) breakerOpenUntil.set(breakerKey, nowMs + BREAKER_MS);
    logger.warn(`[neat] price failed (${err.message}); ${cached ? 'serving stale cache' : 'falling back to static tariff'}`);
    if (cached) return finish(cached.premium, 'stale-cache');
    return null;
  }
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

/**
 * The quote post-processor of rule 1: `priceSync` reads the cache only (saves), `priceLive` may call
 * Neat and warms the cache (previews). `isReady` = guest pricing fully configured, margin included.
 */
function createInsuranceProcessor({ settings, cacheModel, buildClient, now, logger }) {
  // One client per account, so its token is reused and a normal quote is a single exchange.
  const clients = new Map();
  const sharedClient = (cfg) => {
    const key = `${cfg.environment}:${cfg.clientId}:${hashFieldValues(cfg.clientSecret)}`;
    if (!clients.has(key)) clients.set(key, buildClient(cfg));
    return clients.get(key);
  };
  const answer = (pricing) => (pricing ? { cancellationInsurancePrice: pricing.unitPrice } : null);
  return {
    id: 'neat',
    isReady: () => isNeatPricingActive(settings),
    priceSync: (snapshot) => answer(resolveInsurancePricingSync({ settingsModel: settings, cacheModel: cacheModel() }, snapshot)),
    priceLive: async (snapshot) => answer(await resolveInsurancePricing({
      settingsModel: settings, cacheModel: cacheModel(), buildClient: sharedClient, now, logger,
    }, snapshot)),
  };
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
  createInsuranceProcessor,
  pricingConfig,
  hashFieldValues,
  CACHE_FRESH_MS,
  BREAKER_MS,
  resetPriceBreaker,
};
