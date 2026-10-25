/**
 * Saisie Airbnb (specs/airbnb-mail-intake.md). Reads Airbnb's « Réservation confirmée » mails in the
 * mailbox GuestFlow sends from, and fills the matching iCal fiche — guest, party, confirmation code,
 * message and « Paiement plateforme » — through the fiche's own save path.
 */

const express = require('express');
const sdk = require('../sdk');
const { buildModel, TABLE_SQL } = require('./intakesModel');
const { createIntakeService, listingIdOf } = require('./intakeService');

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
  ctx.migrations([{ name: 'intakes_table_v1', up: (db) => db.exec(TABLE_SQL) }]);

  ctx.settings.declare([
    { key: 'senderAddress', default: 'automated@airbnb.com' },
    { key: 'imapHost', default: '' },
    { key: 'imapPort', default: '993' },
    { key: 'pollEveryHours', default: '3', validate: validateHours },
    { key: 'listings', default: '{}', validate: validateListings },
    { key: 'autoApply', default: '1' },
    { key: 'lastRunAt', default: '' },
  ]);

  let model = null;
  const intakes = () => { if (!model) model = buildModel(ctx.db); return model; };
  const options = () => sdk.coreModule('optionsModel');

  const mailboxConfig = () => {
    const core = ctx.core.settings.mailbox();
    return { host: ctx.settings.get('imapHost') || sdk.mailbox.imapHostFor(core.host), port: Number(ctx.settings.get('imapPort') || 993), user: core.user, password: core.password };
  };

  const service = () => createIntakeService({
    intakes: intakes(),
    settings: {
      mailbox: mailboxConfig,
      sender: () => ctx.settings.get('senderAddress'),
      listings: () => JSON.parse(ctx.settings.get('listings') || '{}'),
      autoApply: () => String(ctx.settings.get('autoApply')) !== '0',
    },
    readMails: (cfg) => sdk.mailbox.readMailsFrom(cfg),
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
      withholdsTouristTax: (propertyId) => ctx.core.reservations.platformWithholdsTouristTax(propertyId, 'airbnb'),
      findOrCreateClient: ctx.core.clients.findOrCreate,
    },
  });

  async function runPass() {
    const result = await service().runPass();
    ctx.settings.set('lastRunAt', new Date().toISOString());
    return result;
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
  router.get('/', (req, res) => res.json({ items: service().attention() }));
  router.post('/run', async (req, res) => {
    try { res.json(await runPass()); } catch (err) { res.status(502).json({ error: err.message }); }
  });
  router.post('/test-mailbox', async (req, res) => res.json(await sdk.mailbox.testConnection(mailboxConfig())));
  router.get('/mailbox', (req, res) => {
    const cfg = mailboxConfig();
    res.json({ host: cfg.host, defaultHost: sdk.mailbox.imapHostFor(ctx.core.settings.mailbox().host), port: cfg.port, user: cfg.user, hasPassword: Boolean(cfg.password), lastRunAt: ctx.settings.get('lastRunAt') || null });
  });
  // The banner of the fiche (rule 14), ready to render.
  router.get('/reservation/:reservationId', (req, res) => res.json({ intake: service().blockFor(Number(req.params.reservationId)) }));
  router.post('/:intakeId/apply', (req, res) => {
    const result = service().applyFromBanner(Number(req.params.intakeId));
    res.status(result.status === 'error' ? 400 : 200).json(result);
  });
  router.post('/:intakeId/dismiss', (req, res) => { service().dismiss(Number(req.params.intakeId)); res.json({ ok: true }); });
  ctx.mount('/api/airbnb-intake', router);

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
