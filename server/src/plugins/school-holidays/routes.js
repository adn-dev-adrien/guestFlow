const express = require('express');

// Static sub-paths must come BEFORE the /:id catchalls.
function buildRouter(ctrl) {
  const router = express.Router();
  router.get('/', ctrl.list);
  router.post('/sync', ctrl.sync);
  router.post('/', ctrl.create);
  router.put('/:id/unlock', ctrl.unlock);
  router.put('/:id', ctrl.update);
  router.delete('/:id', ctrl.remove);
  return router;
}

module.exports = { buildRouter };
