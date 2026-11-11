const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireOperator } = require('../middleware/requireOperator');

// A password typed opens the second-factor step for this long, like the instances' pending login.
const PENDING_MS = 10 * 60 * 1000;

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
    req.session.pendingAt = ctx.now().getTime();
    res.json(payload);
  });

  const pendingOf = (req) => {
    const { pendingOperatorId, pendingAt } = req.session;
    if (!pendingOperatorId) return null;
    if (!pendingAt || ctx.now().getTime() - pendingAt > PENDING_MS) {
      delete req.session.pendingOperatorId;
      delete req.session.pendingAt;
      return null;
    }
    return pendingOperatorId;
  };

  router.post('/verify', limiter, async (req, res) => {
    const pending = pendingOf(req);
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
    const pending = pendingOf(req);
    if (!pending) return res.status(401).json({ error: 'NO_PENDING_LOGIN', message: 'Reconnectez-vous.' });
    return res.json(await auth.resend(pending));
  });

  router.post('/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

  const guard = requireOperator({ now: ctx.now });
  router.get('/me', guard, (req, res) => res.json(auth.me(req.session.operatorId)));
  // Rule 31: a stolen cookie must not be a free password oracle. Both steps are rate-limited, a wrong
  // password counts toward the lock, and the lock ends the session that hit it.
  const endOnLock = (handler) => async (req, res) => {
    try {
      return res.json(await handler(req.session.operatorId, req.body || {}));
    } catch (err) {
      if (err.status === 429 && err.body && err.body.error === 'LOCKED') await new Promise((r) => req.session.destroy(r));
      throw err;
    }
  };
  router.post('/mfa/start', limiter, guard, endOnLock(auth.startMethod));
  router.post('/mfa/confirm', limiter, guard, endOnLock(auth.confirmMethod));

  return router;
}

module.exports = { authRoutes, PENDING_MS };
