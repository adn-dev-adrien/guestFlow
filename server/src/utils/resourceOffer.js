/**
 * A resource sold by the hour is offered only while the `hourly-resources` plugin is live
 * (specs/plugins-phase-3c-hourly-resources.md rules 18–20 — decision P14, as P13 for the insurance).
 * Without it:
 *   - the resource lists hide the `per_hour` resources;
 *   - nothing new gets one: a payload that adds one is refused;
 *   - a line a stay or a devis already carries is kept exactly as stored, read-only, even where the
 *     devis price lock has expired.
 */

const { offered } = require('./priceLineContributors');
const bookingLinesModel = require('../models/bookingLinesModel');

const NOT_OFFERED = Object.freeze({
  status: 422,
  code: 'RESOURCE_NOT_OFFERED',
  error: 'Ce produit n’est plus proposé.',
});
const PRICE_TYPE_REFUSED = 'Le prix à l’heure demande le plugin Ressources à l’heure.';
const READ_ONLY_REASON = 'Lecture seule : plugin Ressources à l’heure inactif';

const isOffered = (resource) => offered(resource && resource.priceType);

/** Rule 18 — a resource list without the resources nothing offers. */
function hideUnoffered(resources) {
  return Array.isArray(resources) ? resources.filter(isOffered) : resources;
}

// The ids of the resources nothing offers today. A partial schema has none to gate.
function unofferedIds(db) {
  try {
    return new Set(db.prepare('SELECT id, priceType FROM resources').all()
      .filter((r) => !isOffered(r)).map((r) => Number(r.id)));
  } catch {
    return new Set();
  }
}

function storedLines(db, bookingId, ids) {
  if (!bookingId || ids.size === 0) return [];
  return db.prepare('SELECT * FROM reservation_resources WHERE reservationId = ?').all(Number(bookingId))
    .filter((line) => ids.has(Number(line.resourceId)));
}

const parseSessions = (raw) => {
  if (Array.isArray(raw)) return raw;
  try { const parsed = JSON.parse(raw || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};

/**
 * Rule 18 — the engine input of a quote or a save while some resources are not offered.
 * `bookingId` is the stored reservation or devis being priced (0/undefined for a new one).
 * Returns `{ selectedResources, lockedResourceLines }`, or `{ error }` (422) when the payload adds a
 * resource nothing offers. A line the booking carries is the stored one — hours, sessions, complement,
 * « offert » and price lock — whatever the payload says, removal included.
 */
function gateResources({ db, bookingId, selectedResources, lockedResourceLines }) {
  const unchanged = { selectedResources, lockedResourceLines };
  const ids = unofferedIds(db);
  if (ids.size === 0) return unchanged;
  const list = Array.isArray(selectedResources) ? selectedResources : [];
  const stored = storedLines(db, bookingId, ids);
  const storedIds = new Set(stored.map((line) => Number(line.resourceId)));
  if (list.some((r) => ids.has(Number(r.resourceId)) && !storedIds.has(Number(r.resourceId)))) return { error: NOT_OFFERED };
  if (stored.length === 0) return unchanged;

  const kept = stored.map((line) => ({
    resourceId: Number(line.resourceId),
    quantity: Number(line.quantity || 0),
    offered: Number(line.offered || 0) === 1,
    inComplement: Number(line.inComplement || 0) === 1,
    sessions: parseSessions(line.sessions),
  }));
  // The lock is always the stored one: a preview's body cannot price the line differently from the save.
  const storedLocks = (bookingLinesModel.buildModel(db).getPricingSnapshot(Number(bookingId)).lockedResourceLines || [])
    .filter((l) => storedIds.has(Number(l.resourceId)));
  const otherLocks = (Array.isArray(lockedResourceLines) ? lockedResourceLines : []).filter((l) => !storedIds.has(Number(l.resourceId)));
  return {
    selectedResources: [...list.filter((r) => !storedIds.has(Number(r.resourceId))), ...kept],
    lockedResourceLines: [...otherLocks, ...storedLocks],
  };
}

/**
 * Rule 18 — the catalogue entries of the resources a stored booking carries but the catalogue now
 * hides, marked read-only so the fiche draws the line without its controls.
 */
function frozenResources(db, bookingId) {
  const ids = unofferedIds(db);
  return storedLines(db, bookingId, ids)
    .map((line) => db.prepare('SELECT * FROM resources WHERE id = ?').get(Number(line.resourceId)))
    .filter(Boolean)
    .map((resource) => ({ ...resource, readOnly: true, readOnlyReason: READ_ONLY_REASON }));
}

module.exports = {
  NOT_OFFERED, PRICE_TYPE_REFUSED, READ_ONLY_REASON, isOffered, hideUnoffered, gateResources, frozenResources,
};
