const router = require('express').Router();
const ctrl = require('../controllers/tariffRecipesController');

// Tariff recipes (specs/tariff-recipes/spec.md §3.5) — read-only browser + the scheduled-run journal.
router.get('/', ctrl.list);
router.get('/runs', ctrl.listRuns);
router.post('/runs/:runId/dismiss', ctrl.dismissRun);

// Journal des changements tarifaires (specs/tariff-change-journal.md §4.3). Declared BEFORE the
// `/:id` catch-all, which would otherwise swallow `/journal` as a recipe identifier.
router.get('/journal', ctrl.listJournal);
router.post('/journal', ctrl.createJournalEntry);
router.delete('/journal/:eventId', ctrl.deleteJournalEntry);

router.get('/:id', ctrl.getOne);

module.exports = router;
