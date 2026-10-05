/**
 * The quote post-processor (specs/plugins-phase-3b-neat.md rules 1–6). A plugin declares it with
 * `ctx.quotePostProcessor`; the core builds the stay snapshot, asks it, and re-runs its own engine with
 * the answer. The engine stays pure and keeps freezing sold lines itself.
 *
 * Processor contract:
 *   id
 *   isReady()            → configured and usable
 *   priceSync(snapshot)  → { cancellationInsurancePrice } | null — cache only, no network
 *   priceLive(snapshot)  → Promise<{ cancellationInsurancePrice } | null> — may call out
 *
 * The output is closed: the core reads `cancellationInsurancePrice` and nothing else.
 */

const registry = require('../plugins/sdk/registry');

const OUTPUT_KEY = 'cancellationInsurancePrice';

// The processor of a live plugin, ready or not. Its mere presence is what offers the insurance (P13).
function declared() {
  const record = registry.all().find((r) => r.quotePostProcessor && registry.isLive(r.id));
  return record ? record.quotePostProcessor : null;
}

function active() {
  const processor = declared();
  if (!processor) return null;
  try {
    return processor.isReady() ? processor : null;
  } catch {
    return null;
  }
}

// Rule 5 — the cancellation insurance is offered only while a live plugin prices it.
function insuranceOffered() {
  return Boolean(declared());
}

// Rule 2 — a live, ready processor prices the insurance: the public label says « calculé pour vos dates ».
function dynamicInsurance() {
  return Boolean(active());
}

/**
 * The stay snapshot of a quote that is not (yet) a stored reservation. `totalAmount` EXCLUDES the
 * insurance line itself, so the premium never depends on whether the guest already ticked « Oui ».
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

function snapshotFor({ engineInput, quote }) {
  if (!engineInput || !engineInput.db || !quote || quote.error) return null;
  const { db } = engineInput;
  // Only a property that sells the insurance is priced: no call to the partner for the others.
  let insuranceOpt;
  try {
    insuranceOpt = db.prepare(`SELECT o.id FROM options o
        JOIN property_options po ON po.optionId = o.id AND po.propertyId = ?
       WHERE o.isCancellationInsurance = 1 ORDER BY o.id LIMIT 1`).get(Number(engineInput.propertyId));
  } catch {
    // A schema without per-property options (minimal test databases): every property sells it.
    insuranceOpt = db.prepare('SELECT id FROM options WHERE isCancellationInsurance = 1 ORDER BY id LIMIT 1').get();
  }
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

// Rule 1 — only the one key, only a finite amount ≥ 0.
function priceFrom(processor, answer, logger) {
  if (answer == null) return null;
  const extra = Object.keys(answer).filter((k) => k !== OUTPUT_KEY);
  if (extra.length) logger.warn(`[quote-post-processor:${processor.id}] ignored output ${extra.join(', ')}`);
  const price = Number(answer[OUTPUT_KEY]);
  if (answer[OUTPUT_KEY] == null || !Number.isFinite(price) || price < 0) {
    if (answer[OUTPUT_KEY] != null) logger.warn(`[quote-post-processor:${processor.id}] ignored non-amount ${answer[OUTPUT_KEY]}`);
    return null;
  }
  return price;
}

function rerun({ engineInput, quote, calculate, price }) {
  if (price === null) return quote;
  const repriced = calculate({ ...engineInput, cancellationInsurancePriceOverride: price });
  return repriced.error ? quote : repriced;
}

/**
 * The insurance unit price the processor sets for this stay, or null. `engineInput` needs `db`,
 * `propertyId`, `startDate`, `endDate`; `quote` is the engine's first run. Never throws.
 */
async function livePrice({ engineInput, quote, logger = console }) {
  const processor = active();
  if (!processor) return null;
  const snapshot = snapshotFor({ engineInput, quote });
  if (!snapshot) return null;
  try {
    return priceFrom(processor, await processor.priceLive(snapshot), logger);
  } catch (err) {
    logger.error(`[quote-post-processor:${processor.id}] ${err.message}`);
    return null;
  }
}

function syncPrice({ engineInput, quote, logger = console }) {
  const processor = active();
  if (!processor) return null;
  const snapshot = snapshotFor({ engineInput, quote });
  if (!snapshot) return null;
  try {
    return priceFrom(processor, processor.priceSync(snapshot), logger);
  } catch (err) {
    logger.error(`[quote-post-processor:${processor.id}] ${err.message}`);
    return null;
  }
}

/** Saves: cache-only resolution. The quote unchanged when nothing applies or the plugin fails. */
function applySync({ engineInput, quote, calculate, logger = console }) {
  return rerun({ engineInput, quote, calculate, price: syncPrice({ engineInput, quote, logger }) });
}

/** Previews: live resolution, which warms whatever cache the sync path then reads. */
async function applyLive({ engineInput, quote, calculate, logger = console }) {
  return rerun({ engineInput, quote, calculate, price: await livePrice({ engineInput, quote, logger }) });
}

module.exports = {
  declared, active, insuranceOffered, dynamicInsurance, livePrice, syncPrice, applySync, applyLive, buildQuoteSnapshot, snapshotFor,
};
