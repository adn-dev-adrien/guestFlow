const router = require('express').Router();
const ctrl = require('../controllers/tariffRecipesController');

// Tariff recipes (specs/tariff-recipes/spec.md §3.5) — read-only browser + the scheduled-run journal.
router.get('/', ctrl.list);
router.get('/runs', ctrl.listRuns);
router.post('/runs/:runId/dismiss', ctrl.dismissRun);
router.get('/:id', ctrl.getOne);

module.exports = router;
