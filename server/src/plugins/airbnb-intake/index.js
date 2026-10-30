/**
 * Saisie Airbnb (specs/airbnb-mail-intake.md). Reads Airbnb's « Réservation confirmée » mails in the
 * mailbox GuestFlow sends from, and fills the matching iCal fiche — guest, party, confirmation code,
 * message and « Paiement plateforme » — through the fiche's own save path.
 */

const express = require('express');
const sdk = require('../sdk');
const { buildModel, TABLE_SQL, addSenderVerifiedColumn, addParserVersionColumn } = require('./intakesModel');
const { createIntakeService } = require('./intakeService');
const { listingIdOf, detectedFromIcal, listingPairs } = require('./listings');

const id = 'airbnb-intake';
const TICK_MS = 15 * 60 * 1000;

const validateHours = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 24 ? null : 'Une fréquence entre 1 et 24 heures.';
};
const validateListings = (v) => {
  try {
    const map = JSON.parse(v || '{}');
    const ok = map && typeof map === 'object' && !Array.isArray(map)
      && Object.entries(map).every(([k, value]) => /^\d+$/.test(k) && (!String(value || '').trim() || listingIdOf(value)));
    return ok ? null : 'Une annonce Airbnb est un numéro, ou un lien airbnb.fr/rooms/…';
  } catch {
    return 'Correspondance illisible.';
  }
};

function register(ctx) {
  ctx.migrations([
    { name: 'intakes_table_v1', up: (db) => db.exec(TABLE_SQL) },
    { name: 'intakes_sender_verified_v2', up: addSenderVerifiedColumn },
    { name: 'intakes_parser_version_v3', up: addParserVersionColumn },
  ]);

  ctx.settings.declare([
    { key: 'senderAddress', supportLocked: true, default: 'automated@airbnb.com' },
    { key: 'imapHost', supportLocked: true, default: '', validate: (v) => (!v || sdk.mailbox.resolveImapHost(ctx.core.settings.mailbox().host, v) === String(v).trim().toLowerCase() ? null : 'Un serveur du même domaine que le serveur d’envoi.') },
    { key: 'imapPort', supportLocked: true, default: '993' },
    { key: 'pollEveryHours', default: '3', validate: validateHours },
    { key: 'listings', default: '{}', validate: validateListings },
    { key: 'autoApply', default: '1' },
    { key: 'senderDomains', supportLocked: true, default: '' },
    { key: 'trustedAuthservId', supportLocked: true, default: '' },
    { key: 'lastRunAt', internal: true, default: '' },
    { key: 'unreadMails', internal: true, default: '0' },
    { key: 'unreadStreak', internal: true, default: '0' },
  ]);

  let model = null;
  const intakes = () => { if (!model) model = buildModel(ctx.db); return model; };
  const options = () => sdk.coreModule('optionsModel');

  // Rule 11 — every property with an Airbnb iCal feed is covered without typing anything.
  const detectedListings = () => detectedFromIcal(ctx.db.prepare(
    `SELECT propertyId, url FROM ical_sources WHERE COALESCE(isActive, 1) = 1 AND COALESCE(disabled, 0) = 0
     AND lower(url) LIKE '%airbnb.%/calendar/ical/%'`).all());
  const listings = () => listingPairs({ detected: detectedListings(), manual: JSON.parse(ctx.settings.get('listings') || '{}') });

  const mailboxConfig = () => {
    const core = ctx.core.settings.mailbox();
    return { host: sdk.mailbox.resolveImapHost(core.host, ctx.settings.get('imapHost')), port: Number(ctx.settings.get('imapPort') || 993), user: core.user, password: core.password };
  };

  const service = () => createIntakeService({
    intakes: intakes(),
    parserVersion: sdk.manifestVersion(__dirname),
    settings: {
      mailbox: mailboxConfig,
      sender: () => ctx.settings.get('senderAddress'),
      authentication: () => ({ allowedDomains: ctx.settings.get('senderDomains'), trustedAuthservId: ctx.settings.get('trustedAuthservId') }),
      listings,
      autoApply: () => String(ctx.settings.get('autoApply')) !== '0',
    },
    readMails: (cfg, handlers) => sdk.mailbox.readMailsFrom({ ...cfg, ...handlers, log: (line) => ctx.log.warn(line) }),
    findReservations: ({ propertyIds, startDate, endDate }) => ctx.db.prepare(`
      SELECT id, propertyId, platform, kind, sourceType, icalSyncLocked, platformGrossAmount, cancelledAt FROM reservations
      WHERE propertyId IN (${propertyIds.map(() => '?').join(',')}) AND startDate = ? AND endDate = ?`)
      .all(...propertyIds, startDate, endDate),
    propertyOptions: (propertyId) => options().listForProperty(propertyId),
    getReservation: (reservationId) => ctx.core.reservations.getByIdWithDetails(reservationId),
    core: {
      updateReservation: ctx.core.reservations.update,
      suggestBeds: ctx.core.reservations.suggestBeds,
      platformCommission: ctx.core.reservations.platformCommission,
      // Rule 20 — the mode of the fiche's own platform row (« Airbnb », or a renamed / second Airbnb channel).
      withholdsTouristTax: (propertyId, platform) => ctx.core.reservations.platformWithholdsTouristTax(propertyId, platform),
    },
  });

  // Rule 31(c) — one pass at a time across the job tick and « Lire maintenant »: a second caller joins it.
  // Rule 32(b) — the home line shows the mails left unread only once two passes in a row hit the cap: a first
  // read of a 30-day backlog, or a re-read after a parser update, drains within a pass or two and is no flood.
  function noteUnread(unread) {
    const streak = unread ? (Number(ctx.settings.get('unreadStreak')) || 0) + 1 : 0;
    ctx.settings.set('unreadStreak', String(streak));
    ctx.settings.set('unreadMails', String(streak >= 2 ? unread : 0));
  }

  let running = null;
  function runPass() {
    if (!running) {
      running = (async () => {
        let result;
        try {
          result = await service().runPass();
        } catch (err) {
          noteUnread(0);
          throw err;
        }
        ctx.settings.set('lastRunAt', new Date().toISOString());
        noteUnread(result.skipped ? 0 : result.unread || 0);
        return result;
      })().finally(() => { running = null; });
    }
    return running;
  }

  // Rule 2 — every `pollEveryHours` (3 by default). The job ticks every 15 minutes and only reads the
  // mailbox once the period has elapsed, so a new frequency applies without a restart.
  ctx.jobs.every({
    name: 'mail-intake',
    intervalMs: TICK_MS,
    bootDelayMs: 3 * 60 * 1000,
    run: async () => {
      const last = Date.parse(ctx.settings.get('lastRunAt') || '') || 0;
      const period = Number(ctx.settings.get('pollEveryHours') || 3) * 3600 * 1000;
      if (Date.now() - last < period) return;
      try {
        const result = await runPass();
        if (result.read || result.applied || result.error) ctx.log.info(`mail intake: ${JSON.stringify(result)}`);
      } catch (err) {
        ctx.settings.set('lastRunAt', new Date().toISOString());
        ctx.log.warn(`mail intake failed: ${err.message}`);
      }
    },
  });

  const router = express.Router();
  const listAttention = (req, res) => res.json({ items: service().attention(), unread: Number(ctx.settings.get('unreadMails')) || 0 });
  router.get('/', listAttention);
  router.post('/run', async (req, res) => {
    try { res.json(await runPass()); } catch (err) { res.status(502).json({ error: err.message }); }
  });
  router.post('/test-mailbox', async (req, res) => res.json(await sdk.mailbox.testConnection(mailboxConfig())));
  router.get('/mailbox', (req, res) => {
    const cfg = mailboxConfig();
    const detected = Object.fromEntries(Object.entries(detectedListings()).map(([propertyId, ids]) => [propertyId, ids[0]]));
    res.json({ host: cfg.host, defaultHost: sdk.mailbox.imapHostFor(ctx.core.settings.mailbox().host), port: cfg.port, user: cfg.user, hasPassword: Boolean(cfg.password), lastRunAt: ctx.settings.get('lastRunAt') || null, detected });
  });
  // The banner of the fiche (rule 14), ready to render.
  router.get('/reservation/:reservationId', (req, res) => res.json({ intake: service().blockFor(Number(req.params.reservationId)) }));
  router.post('/:intakeId/apply', (req, res) => {
    const result = service().applyFromBanner(Number(req.params.intakeId));
    res.status(result.status === 'error' ? 400 : 200).json(result);
  });
  router.post('/:intakeId/dismiss', (req, res) => { service().dismiss(Number(req.params.intakeId)); res.json({ ok: true }); });
  ctx.mount('/api/airbnb-intake', router);
  ctx.attention({ key: 'airbnb-intake', rank: 65, handler: listAttention, summarize: require('./attention').summarize });

  ctx.data({
    tables: ['airbnb_intakes'],
    purge: () => { model = null; },
    describe: () => {
      const n = intakes().count();
      return n > 0 ? [{ label: n > 1 ? `${n} mails Airbnb lus` : '1 mail Airbnb lu', count: n }] : [];
    },
  });
}

module.exports = { id, register };
