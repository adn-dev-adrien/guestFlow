const express = require('express');

/**
 * specs/plugins-phase-4-registry.md rules 7–8.
 *
 *   registryPublicRoutes   GET /registry/v1/index.json, /index.json.sig, /packages/<id>-<version>.tgz —
 *                          no authentication: a package holds no customer data, and the licence
 *                          decides what an instance may install.
 *   registryRoutes         the operator's « Registre » page: list, upload, withdraw.
 */
function registryPublicRoutes(ctx) {
  const router = express.Router();
  router.get('/index.json', (req, res) => res.set('Cache-Control', 'no-cache').type('application/json').sendFile(ctx.registry.indexFiles().index));
  router.get('/index.json.sig', (req, res) => res.set('Cache-Control', 'no-cache').type('text/plain').sendFile(ctx.registry.indexFiles().signature));
  router.get('/packages/:file', (req, res) => {
    const file = ctx.registry.packageFile(req.params.file);
    if (!file) return res.status(404).type('text').send('Introuvable.');
    return res.set('Cache-Control', 'public, max-age=31536000, immutable').type('application/gzip').sendFile(file);
  });
  return router;
}

// Thin: parse, call the store, answer. One file per request; the page sends several in a row.
function registryRoutes(ctx) {
  const router = express.Router();
  const who = (req) => req.session.operatorEmail;
  const audit = (req, text) => {
    const at = ctx.now().toISOString();
    ctx.models.audit.log({ at, day: at.slice(0, 10), operator: who(req), kind: 'registry', text });
  };
  router.get('/', (req, res) => res.json(ctx.registry.list()));
  router.post('/packages', express.raw({ type: 'application/octet-stream', limit: '50mb' }), async (req, res) => {
    const name = decodeURIComponent(String(req.get('x-file-name') || ''));
    const row = await ctx.registry.publish(Buffer.isBuffer(req.body) ? req.body : null, name);
    audit(req, `Plugin ${row.id} ${row.version} publié`);
    res.status(201).json(row);
  });
  router.post('/packages/:id/:version/withdraw', (req, res) => {
    const row = ctx.registry.withdraw(req.params.id, req.params.version);
    audit(req, `Plugin ${row.id} ${row.version} retiré du registre`);
    res.json(row);
  });
  return router;
}

module.exports = { registryPublicRoutes, registryRoutes };
