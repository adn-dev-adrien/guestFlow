const express = require('express');

const router = express.Router();

// GET /api/subscription — what the admin banner shows (specs/control-plane-plans-and-access.md §4.3):
// `{ state: null }` when no licence is enforced.
router.get('/', (req, res) => res.json(require('../utils/licence').default.banner()));

module.exports = router;
