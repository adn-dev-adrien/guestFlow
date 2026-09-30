const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireOperator } = require('../middleware/requireOperator');

function authRoutes(ctx) {
  const router = express.Router();
  const auth = ctx.controllers.auth;
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'RATE_LIMITED', message: 'Trop de tentatives : patientez quelques minutes.' } });
  const regenerate = (req) => new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));

  router.post('/login', limiter, async (req, res) => {
    const { operatorId, payload } = await auth.login(req.body || {});
    await regenerate(req);
    req.session.pendingOperatorId = operatorId;
    res.json(payload);
  });

  router.post('/verify', limiter, async (req, res) => {
    const pending = req.session.pendingOperatorId;
    if (!pending) return res.status(401).json({ error: 'NO_PENDING_LOGIN', message: 'Reconnectez-vous.' });
    let result;
    try {
      result = auth.verify(pending, req.body || {});
    } catch (err) {
      if (err.status === 429) delete req.session.pendingOperatorId;
      throw err;
    }
    await regenerate(req);
    const t = ctx.now().getTime();
    Object.assign(req.session, { operatorId: result.operator.id, operatorEmail: result.operator.email, loggedInAt: t, lastSeenAt: t });
    return res.json(result);
  });

  router.post('/resend', limiter, async (req, res) => {
    const pending = req.session.pendingOperatorId;
    if (!pending) return res.status(401).json({ error: 'NO_PENDING_LOGIN', message: 'Reconnectez-vous.' });
    return res.json(await auth.resend(pending));
  });

  router.post('/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

  const guard = requireOperator({ now: ctx.now });
  router.get('/me', guard, (req, res) => res.json(auth.me(req.session.operatorId)));
  router.post('/mfa/start', guard, async (req, res) => res.json(await auth.startMethod(req.session.operatorId, req.body || {})));
  router.post('/mfa/confirm', guard, (req, res) => res.json(auth.confirmMethod(req.session.operatorId, req.body || {})));

  return router;
}

module.exports = { authRoutes };
