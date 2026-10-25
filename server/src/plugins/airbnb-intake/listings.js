/**
 * Which property an Airbnb listing belongs to (specs/airbnb-mail-intake.md rule 11). Pure.
 *
 * Nothing to type for a property that already has its Airbnb iCal feed: that feed's address carries the
 * listing id (`airbnb.fr/calendar/ical/<id>.ics`), so a new property is covered the day its feed is added.
 * The plugin setting `listings` is only an override — the id or a pasted `airbnb.fr/rooms/<id>` link.
 */

// The setting takes the listing id or a pasted `airbnb.fr/rooms/<id>` link.
function listingIdOf(value) {
  const s = String(value || '').trim();
  const fromUrl = s.match(/\/rooms\/(\d+)/);
  if (fromUrl) return fromUrl[1];
  return /^\d+$/.test(s) ? s : '';
}

// `[{ propertyId, url }]` (the iCal sources of the platform) → `{ propertyId: [listingId] }`.
function detectedFromIcal(sources) {
  const out = {};
  for (const { propertyId, url } of sources) {
    const id = (String(url || '').match(/airbnb\.[a-z.]+\/calendar\/ical\/(\d+)/i) || [])[1];
    if (!id) continue;
    out[propertyId] = out[propertyId] || [];
    if (!out[propertyId].includes(id)) out[propertyId].push(id);
  }
  return out;
}

// The detected ids, each property's own override replacing what was detected for it → `[[propertyId, listingId]]`.
function listingPairs({ detected, manual }) {
  const pairs = [];
  const propertyIds = new Set([...Object.keys(detected), ...Object.keys(manual)]);
  for (const propertyId of propertyIds) {
    const own = listingIdOf(manual[propertyId]);
    for (const id of own ? [own] : (detected[propertyId] || [])) pairs.push([Number(propertyId), id]);
  }
  return pairs;
}

module.exports = { listingIdOf, detectedFromIcal, listingPairs };
