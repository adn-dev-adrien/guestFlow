/**
 * The plugin's HTTP surface (specs/booking-extranet-intake.md §4.4).
 *
 * `publicRouter` is the one door that is not behind a session: it authenticates itself with the secret the
 * userscript carries, in constant time, and answers 401 without detail on a mismatch. It reads nothing and
 * writes nothing before the secret is verified, and it never logs the page.
 */

const crypto = require('crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');

const MAX_PAGE_BYTES = 128 * 1024;
const REQUESTS_PER_MINUTE = 30;

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
const secretMatches = (given, expected) => Boolean(given) && Boolean(expected) && crypto.timingSafeEqual(digest(given), digest(expected));

function publicRouter({ secret, handlePage, perMinute = REQUESTS_PER_MINUTE, log = () => {} }) {
  const router = express.Router();
  // Counted before the secret is checked, so guessing it is limited too.
  router.use(rateLimit({
    windowMs: 60 * 1000,
    max: perMinute,
    standardHeaders: false,
    legacyHeaders: false,
    message: { status: 'refused', message: 'Trop de demandes, réessayer dans une minute' },
  }));
  router.post('/page', (req, res) => {
    if (!secretMatches(req.get('X-Booking-Intake-Key'), secret())) return res.status(401).json({ error: 'UNAUTHORIZED' });
    const body = req.body || {};
    if (req.rawBody && req.rawBody.length > MAX_PAGE_BYTES) return res.status(413).json({ status: 'refused', message: 'Page trop volumineuse' });
    if (typeof body.text !== 'string' || !body.hotelId || !body.resId) {
      return res.status(400).json({ status: 'refused', message: 'Requête incomplète' });
    }
    try {
      return res.json(handlePage({ hotelId: String(body.hotelId), resId: String(body.resId), text: body.text }));
    } catch (err) {
      log(`intake failed: ${err.message}`);
      return res.status(500).json({ status: 'refused', message: 'Erreur interne de GuestFlow' });
    }
  });
  return router;
}

function adminRouter({ service, pending, dismissFiche, intakeLog, userscript, createSecret, regenerateSecret }) {
  const router = express.Router();
  // A read: it never creates the secret (rule 25).
  router.get('/userscript.user.js', (req, res) => {
    const built = userscript();
    if (!built.ok) return res.status(409).json({ error: built.error });
    res.type('text/javascript; charset=utf-8').send(built.source);
  });
  router.post('/secret', (req, res) => res.json(createSecret()));
  router.post('/secret/regenerate', (req, res) => { regenerateSecret(); res.json({ ok: true }); });
  router.get('/pending', (req, res) => res.json(pending()));
  router.post('/pending/:reservationId/dismiss', (req, res) => { dismissFiche(Number(req.params.reservationId)); res.json({ ok: true }); });
  router.get('/intakes', (req, res) => res.json(intakeLog(req.query.limit)));
  router.get('/reservation/:reservationId', (req, res) => res.json({ intake: service().blockFor(Number(req.params.reservationId)) }));
  router.post('/:id/apply', (req, res) => {
    const result = service().applyProposal(Number(req.params.id));
    res.status(result.status === 'error' ? 400 : 200).json(result);
  });
  router.post('/:id/ignore', (req, res) => { service().ignoreProposal(Number(req.params.id)); res.json({ ok: true }); });
  router.post('/:id/hide', (req, res) => { service().hide(Number(req.params.id)); res.json({ ok: true }); });
  return router;
}

module.exports = { publicRouter, adminRouter, secretMatches, MAX_PAGE_BYTES, REQUESTS_PER_MINUTE };
