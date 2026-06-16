/**
 * Laundry routes — admin-only management of the `laundry_trip_skips` table.
 *
 * Separated from `/api/planning` so the mount point matches the resource semantics: a skip
 * is a property of the laundry process, not of a planning view. `routes/planning.js` keeps
 * its existing surface (read-only inventory + summary endpoints) untouched.
 *
 * Spec: specs/skip-laundry-trip.md §4.1 + §4.3.
 */

const router = require('express').Router();
const ctrl = require('../controllers/laundryTripSkipsController');
const additionsCtrl = require('../controllers/laundryManualAdditionsController');

router.get('/skips', ctrl.listSkips);
router.post('/skips', ctrl.addSkip);
router.delete('/skips/:date', ctrl.removeSkip);

// Per-trip manual linen additions (specs/manual-laundry-additions.md §4.3).
router.get('/manual-additions', additionsCtrl.listAdditions);
router.put('/manual-additions/:date', additionsCtrl.setAddition);

module.exports = router;
