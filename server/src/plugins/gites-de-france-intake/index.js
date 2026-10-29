/**
 * Saisie Gîtes de France (specs/gites-de-france-mail-intake.md). Reads the centrale's « nouvelle
 * réservation » mails in the mailbox GuestFlow sends from, and fills the matching iCal fiche — guest,
 * party, booking number, supplements and « Paiement plateforme » — through the fiche's own save path.
 */

const express = require('express');
const sdk = require('../sdk');
const { buildModel, TABLE_SQL, addSenderVerifiedColumn, addParserVersionColumn } = require('./intakesModel');
const { createIntakeService } = require('./intakeService');

const id = 'gites-de-france-intake';
const TICK_MS = 15 * 60 * 1000;

const validateHours = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 24 ? null : 'Une fréquence entre 1 et 24 heures.';
};
const validateGiteNumbers = (v) => {
  try {
    const map = JSON.parse(v || '{}');
    const ok = map && typeof map === 'object' && !Array.isArray(map)
      && Object.entries(map).every(([k, g]) => /^\d+$/.test(k) && /^\d*$/.test(String(g)));
    return ok ? null : 'Un numéro de gîte est fait de chiffres.';
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
    { key: 'senderAddress', supportLocked: true, default: 'resa@gdf07.com' },
    { key: 'imapHost', supportLocked: true, default: '', validate: (v) => (!v || sdk.mailbox.resolveImapHost(ctx.core.settings.mailbox().host, v) === String(v).trim().toLowerCase() ? null : 'Un serveur du même domaine que le serveur d’envoi.') },
    { key: 'imapPort', supportLocked: true, default: '993' },
    { key: 'pollEveryHours', default: '3', validate: validateHours },
    { key: 'giteNumbers', default: '{}', validate: validateGiteNumbers },
    { key: 'autoApply', default: '1' },
    { key: 'senderDomains', supportLocked: true, default: '' },
    { key: 'trustedAuthservId', supportLocked: true, default: '' },
    { key: 'lastRunAt', default: '' },
  ]);

  let model = null;
  const intakes = () => { if (!model) model = buildModel(ctx.db); return model; };
  const platforms = () => sdk.coreModule('platformsModel');
  const options = () => sdk.coreModule('optionsModel');

  const mailboxConfig = () => {
    const core = ctx.core.settings.mailbox();
    return { host: sdk.mailbox.resolveImapHost(core.host, ctx.settings.get('imapHost')), port: Number(ctx.settings.get('imapPort') || 993), user: core.user, password: core.password };
  };

  const service = () => createIntakeService({
    intakes: intakes(),
    parserVersion: require('./manifest.json').version,
    settings: {
      mailbox: mailboxConfig,
      sender: () => ctx.settings.get('senderAddress'),
      authentication: () => ({ allowedDomains: ctx.settings.get('senderDomains'), trustedAuthservId: ctx.settings.get('trustedAuthservId') }),
      giteNumbers: () => JSON.parse(ctx.settings.get('giteNumbers') || '{}'),
      autoApply: () => String(ctx.settings.get('autoApply')) !== '0',
    },
    readMails: (cfg) => sdk.mailbox.readMailsFrom({ ...cfg, log: (line) => ctx.log.warn(line) }),
    findReservations: ({ propertyIds, startDate, endDate }) => ctx.db.prepare(`
      SELECT id, propertyId, platform, kind, sourceType, icalSyncLocked, platformGrossAmount, cancelledAt FROM reservations
      WHERE propertyId IN (${propertyIds.map(() => '?').join(',')}) AND startDate = ? AND endDate = ?`)
      .all(...propertyIds, startDate, endDate),
    commissionPercent: (platform) => Number((platforms().findByName(platform) || {}).commissionPercent || 0),
    propertyOptions: (propertyId) => options().listForProperty(propertyId),
    getReservation: (reservationId) => ctx.core.reservations.getByIdWithDetails(reservationId),
    core: {
      updateReservation: ctx.core.reservations.update,
      suggestBeds: ctx.core.reservations.suggestBeds,
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
    bootDelayMs: 2 * 60 * 1000,
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
  const listAttention = (req, res) => res.json({ items: service().attention() });
  router.get('/', listAttention);
  router.post('/run', async (req, res) => {
    try { res.json(await runPass()); } catch (err) { res.status(502).json({ error: err.message }); }
  });
  router.post('/test-mailbox', async (req, res) => res.json(await sdk.mailbox.testConnection(mailboxConfig())));
  router.get('/mailbox', (req, res) => {
    const cfg = mailboxConfig();
    res.json({ host: cfg.host, defaultHost: sdk.mailbox.imapHostFor(ctx.core.settings.mailbox().host), port: cfg.port, user: cfg.user, hasPassword: Boolean(cfg.password), lastRunAt: ctx.settings.get('lastRunAt') || null });
  });
  // The banner of the fiche (rule 12), ready to render.
  router.get('/reservation/:reservationId', (req, res) => res.json({ intake: service().blockFor(Number(req.params.reservationId)) }));
  router.post('/:intakeId/apply', (req, res) => {
    const result = service().applyFromBanner(Number(req.params.intakeId), { rent: req.body && req.body.rent });
    res.status(result.status === 'error' ? 400 : 200).json(result);
  });
  router.post('/:intakeId/dismiss', (req, res) => { service().dismiss(Number(req.params.intakeId)); res.json({ ok: true }); });
  ctx.mount('/api/gdf-intake', router);
  ctx.attention({ key: 'gdf-intake', rank: 60, handler: listAttention, summarize: require('./attention').summarize });

  ctx.data({
    tables: ['gdf_intakes'],
    purge: () => { model = null; },
    describe: () => {
      const n = intakes().count();
      return n > 0 ? [{ label: n > 1 ? `${n} mails de réservation lus` : '1 mail de réservation lu', count: n }] : [];
    },
  });
}

module.exports = { id, register };
