/**
 * Rule 17 — the price check (specs/google-vacation-rentals-feed.md). Draws N stays and compares, for
 * each, what Google was sent with what the website quotes now. Any difference is listed: it is the
 * gate before switching to Envoi and the answer to an accuracy complaint from Google.
 *
 * Three draws out of four come from what was sent (the prices Google shows); the fourth is any stay
 * of the horizon, so that a stay the site sells but the feed never sent shows up too.
 *
 * deps:
 *   settings, model      as in pushService.js
 *   quoteWebsite         (propertyId, { checkin, nights, guests }) → { sellable, amountCents }
 *   sizesOf              (propertyId) → the party sizes the feed prices (itineraries.partySizes)
 *   capacityOf           (propertyId) → the public guest cap
 *   today                () → 'YYYY-MM-DD'
 *   random               () → [0, 1), injectable for the tests
 */

const { addDays, daysBetween, itineraryKey } = require('./itineraries');

const DEFAULT_SAMPLES = 200;
const MAX_SAMPLES = 2000;

function createAccuracyCheck({
  settings, model, quoteWebsite, sizesOf, capacityOf, today, random = Math.random,
}) {
  const pick = (n) => Math.floor(random() * n);

  function drawUniform(propertyId, { from, horizonDays, maxLos }) {
    const checkin = addDays(from, pick(horizonDays));
    const room = daysBetween(checkin, addDays(from, horizonDays));
    return { checkin, nights: 1 + pick(Math.max(1, Math.min(maxLos, room))), guests: 1 + pick(capacityOf(propertyId)) };
  }

  function checkProperty(property, samples) {
    const snapshot = model.rateSnapshot(property.id);
    const keys = [...snapshot.keys()];
    const sizes = sizesOf(property.id);
    const smallest = sizes.length ? sizes[0] : 1;
    const window = { from: today(), horizonDays: settings.horizonDays(), maxLos: settings.maxLos() };
    const mismatches = [];
    for (let i = 0; i < samples; i += 1) {
      let stay;
      if (keys.length && random() < 0.75) {
        const [checkin, nights, guests] = keys[pick(keys.length)].split('|');
        stay = { checkin, nights: Number(nights), guests: Number(guests) };
      } else {
        stay = drawUniform(property.id, window);
      }
      // A party smaller than the first priced size pays that size's price (itineraries.partySizes).
      const sentCents = snapshot.get(itineraryKey({ ...stay, guests: Math.max(stay.guests, smallest) }));
      const site = quoteWebsite(property.id, stay);
      const websiteCents = site && site.sellable ? site.amountCents : undefined;
      if (sentCents === websiteCents) continue;
      mismatches.push({
        propertyId: property.id,
        propertyName: property.name,
        checkin: stay.checkin,
        nights: stay.nights,
        guests: stay.guests,
        sent: sentCents === undefined ? null : sentCents / 100,
        website: websiteCents === undefined ? null : websiteCents / 100,
      });
    }
    return mismatches;
  }

  let last = null;

  return {
    /** → { checkedAt, checked, mismatches } */
    run({ propertyId = null, samples = DEFAULT_SAMPLES } = {}) {
      const n = Math.max(1, Math.min(MAX_SAMPLES, Math.floor(Number(samples) || DEFAULT_SAMPLES)));
      const properties = settings.enabledProperties().filter((p) => propertyId == null || p.id === Number(propertyId));
      const mismatches = [];
      let checked = 0;
      properties.forEach((property, i) => {
        // The samples are shared out between the properties; the first ones take the remainder.
        const share = Math.floor(n / properties.length) + (i < n % properties.length ? 1 : 0);
        mismatches.push(...checkProperty(property, share));
        checked += share;
      });
      last = { checkedAt: new Date().toISOString(), checked, mismatches };
      return last;
    },
    last: () => last,
  };
}

module.exports = { createAccuracyCheck, DEFAULT_SAMPLES, MAX_SAMPLES };
