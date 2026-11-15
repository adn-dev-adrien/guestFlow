/**
 * Price guidance (specs/gift-vouchers.md rule 14): each idea is a stay `{ label, propertyId, nights, guests }`, priced
 * by the website's own quote engine over the next 12 months. The answer is one lowest amount per tariff season the stay
 * falls in, or a single « à partir de » amount when the property has no named season. Computed at most once a day and
 * again after `pricing.changed`; the scan yields to the event loop so the first reader never freezes the server.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HORIZON_DAYS = 365;
const YIELD_EVERY = 25;
const UNNAMED_SEASON = 'Standard';
const FROM_LABEL = 'À partir de';

const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve));

const priceable = (quote) => quote && !(quote.unpricedNights || []).length && !quote.minNightsBreached
  && !quote.maxNightsBreached && !quote.changeoverBreached && Number(quote.totalStayPrice) > 0;

/** The season a stay belongs to: the label of all its nights, null when it straddles two (it prices neither). */
function seasonOf(quote) {
  const labels = new Set((quote.nightlyBreakdown || []).map((n) => n.seasonLabel || UNNAMED_SEASON));
  return labels.size === 1 ? [...labels][0] : null;
}

/** → `{ label, amounts: [{ label, amountCents }] }` or null when no stay of the next 12 months can be priced. */
async function priceIdea(idea, { quote, today, bounds }) {
  const lowest = new Map();
  for (let offset = 1; offset <= HORIZON_DAYS; offset += 1) {
    if (offset % YIELD_EVERY === 0) await yieldToLoop(); // eslint-disable-line no-await-in-loop
    const startDate = addDays(today, offset);
    let result = null;
    try {
      result = quote({
        propertyId: idea.propertyId, startDate, endDate: addDays(startDate, idea.nights), adults: idea.guests,
      });
    } catch {
      result = null;
    }
    const season = priceable(result) ? seasonOf(result) : null;
    if (season) {
      const cents = Math.round(Number(result.totalStayPrice) * 100);
      if (!lowest.has(season) || cents < lowest.get(season)) lowest.set(season, cents);
    }
  }
  const named = [...lowest].filter(([label]) => label !== UNNAMED_SEASON);
  const rows = named.length
    ? named.map(([label, amountCents]) => ({ label, amountCents })).sort((a, b) => a.amountCents - b.amountCents)
    : (lowest.size ? [{ label: FROM_LABEL, amountCents: Math.min(...lowest.values()) }] : []);
  const amounts = rows.filter((r) => r.amountCents >= bounds.minAmountCents && r.amountCents <= bounds.maxAmountCents);
  return amounts.length ? { label: idea.label, amounts } : null;
}

/** `read()` → the priced ideas; `invalidate()` on `pricing.changed`. */
function createIdeas({
  ideas, bounds, quote, now = () => new Date(), todayOf,
}) {
  let cached = null;
  let inflight = null;
  let generation = 0;

  const fresh = () => cached && now().getTime() - cached.at < DAY_MS;

  function compute() {
    const started = generation;
    const today = todayOf(now());
    const run = (async () => {
      const out = [];
      for (const idea of ideas()) {
        const priced = await priceIdea(idea, { quote, today, bounds: bounds() }); // eslint-disable-line no-await-in-loop
        if (priced) out.push(priced);
      }
      if (started === generation) cached = { at: now().getTime(), value: out };
      return out;
    })();
    const mine = { generation: started, promise: run.finally(() => { if (inflight === mine) inflight = null; }) };
    inflight = mine;
    return mine.promise;
  }

  return {
    read: () => {
      if (fresh()) return Promise.resolve(cached.value);
      return inflight && inflight.generation === generation ? inflight.promise : compute();
    },
    invalidate() { generation += 1; cached = null; },
  };
}

module.exports = { createIdeas, priceIdea, FROM_LABEL };
