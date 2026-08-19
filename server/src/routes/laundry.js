/**
 * Laundry routes — the laundry-process overlays: trip skips, per-trip manual lines and extra trips.
 *
 * Separated from `/api/planning` so the mount point matches the resource semantics: a skip
 * is a property of the laundry process, not of a planning view. `routes/planning.js` keeps
 * its existing surface (read-only inventory + summary endpoints) untouched.
 *
 * Specs: specs/skip-laundry-trip.md §4.1 + §4.3, specs/manual-laundry-additions.md §4.3,
 * specs/laundry-extra-trip.md §4.3.
 */

const router = require('express').Router();
const ctrl = require('../controllers/laundryTripSkipsController');
const additionsCtrl = require('../controllers/laundryManualAdditionsController');
const extraTripsCtrl = require('../controllers/laundryExtraTripsController');

router.get('/skips', ctrl.listSkips);
router.post('/skips', ctrl.addSkip);
router.delete('/skips/:date', ctrl.removeSkip);

// Per-trip manual linen additions (specs/manual-laundry-additions.md §4.3).
router.get('/manual-additions', additionsCtrl.listAdditions);
router.put('/manual-additions/:date', additionsCtrl.setAddition);

// Extra laundry trips on a free date (specs/laundry-extra-trip.md §4.3). `/preview` is declared
// before the `/:date` routes so it never gets parsed as a date. Writes are admin-only (not in the
// reception allowlist).
router.get('/extra-trips', extraTripsCtrl.list);
router.get('/extra-trips/preview', extraTripsCtrl.preview);
router.put('/extra-trips/:date', extraTripsCtrl.set);
router.delete('/extra-trips/:date', extraTripsCtrl.remove);

module.exports = router;
