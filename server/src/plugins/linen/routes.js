/**
 * Laundry routes — the laundry-process overlays: trip skips, per-trip manual lines and extra trips.
 * Mounted at `/api/laundry`, a prefix the `linen` plugin owns (specs/plugins-phase-2-hosts.md rule 15).
 *
 * Separated from `/api/planning` so the mount point matches the resource semantics: a skip
 * is a property of the laundry process, not of a planning view.
 *
 * Specs: specs/skip-laundry-trip.md §4.1 + §4.3, specs/manual-laundry-additions.md §4.3,
 * specs/laundry-extra-trip.md §4.3.
 */

const express = require('express');

function buildRouter({ skips, additions, extraTrips }) {
  const router = express.Router();

  router.get('/skips', skips.listSkips);
  router.post('/skips', skips.addSkip);
  router.delete('/skips/:date', skips.removeSkip);

  // Per-trip manual linen additions (specs/manual-laundry-additions.md §4.3).
  router.get('/manual-additions', additions.listAdditions);
  router.put('/manual-additions/:date', additions.setAddition);

  // Extra laundry trips on a free date (specs/laundry-extra-trip.md §4.3). `/preview` is declared
  // before the `/:date` routes so it never gets parsed as a date. Writes are admin-only (not in the
  // reception allowlist).
  router.get('/extra-trips', extraTrips.list);
  router.get('/extra-trips/preview', extraTrips.preview);
  router.put('/extra-trips/:date', extraTrips.set);
  router.delete('/extra-trips/:date', extraTrips.remove);

  return router;
}

module.exports = { buildRouter };
