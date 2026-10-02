/**
 * Assurance annulation Neat — module per specs/plugins-phase-3b-neat.md §3.C.
 *
 * Neat prices the cancellation insurance through the core's quote post-processor (rule 1) and
 * subscribes the insured stays once their deposit is paid (feature spec §3.2). Its presence is what
 * offers the insurance at all (rule 5); the insurance lines already on stays are core data and stay.
 */

const sdk = require('../sdk');
const { DECLARED, createSettingsStore } = require('./settingsStore');
const { MIGRATIONS, resetLegacyColumns, hasTable } = require('./migrations');
const { buildModel } = require('./subscriptionsModel');
const { createNeatController } = require('./controller');
const { buildRouter } = require('./routes');
const { buildNeatClient } = require('./client');
const { createInsuranceProcessor } = require('./pricing');

const id = 'neat';

const plural = (n, one, many) => (n > 1 ? `${n} ${many}` : `1 ${one}`);

function register(ctx) {
  ctx.migrations(MIGRATIONS);
  ctx.settings.declare(DECLARED);
  const store = createSettingsStore({ settings: ctx.settings });

  // Built on first use: the tables exist only once the plugin is installed, and a purge drops them.
  let model = null;
  const subscriptions = () => {
    if (!model) model = buildModel(ctx.db);
    return model;
  };
  let built = null;
  const controller = () => {
    if (!built) {
      built = createNeatController({
        db: ctx.db,
        settingsModel: store,
        model: subscriptions(),
        pushService: sdk.coreModule('pushService'),
        logger: { log: ctx.log.info, warn: ctx.log.warn, error: ctx.log.error },
        pluginActive: ctx.isLive,
      });
    }
    return built;
  };

  // Rule 1 — the insurance unit price of a quote.
  ctx.quotePostProcessor(createInsuranceProcessor({
    settings: store, cacheModel: subscriptions, buildClient: buildNeatClient,
  }));

  // Rule 8 — the Réglages card and the fiche actions, at their current URLs.
  ctx.mount('/api/neat', buildRouter(controller));

  // Rule 12 — the fiche's `neat` block.
  ctx.reservationBlock('neat', (reservation) => controller().buildFicheBlock(reservation));

  // Rule 9 — the pass: every 5 minutes, and right after the core reports a stay that may now qualify.
  ctx.jobs.every({
    name: 'subscription-pass',
    intervalMs: 5 * 60 * 1000,
    bootDelayMs: 150 * 1000,
    run: () => controller().runPass('cron'),
  });
  ctx.events.on('reservation.created', () => controller().kickPass('reservation-create'));
  ctx.events.on('reservation.updated', () => controller().kickPass('reservation-update'));
  ctx.events.on('reservation.paid', () => controller().kickPass('payment'));

  // Rule 14 — warn, then erase (decision P12): active subscriptions live on at Neat.
  ctx.data({
    tables: ['neat_subscriptions', 'neat_price_cache'],
    describe: (db) => {
      const lines = [];
      if (hasTable(db, 'neat_subscriptions')) {
        const count = (where) => db.prepare(`SELECT COUNT(*) AS n FROM neat_subscriptions WHERE ${where}`).get().n;
        const active = count("status = 'active'");
        if (active > 0) {
          lines.push({
            label: `${plural(active, 'souscription active', 'souscriptions actives')} chez Neat — ${active > 1 ? 'elles restent' : 'elle reste'} en vigueur chez Neat et ne pourr${active > 1 ? 'ont' : 'a'} plus être résiliée${active > 1 ? 's' : ''} depuis GuestFlow`,
            count: active,
            warning: true,
          });
        }
        if (store.isConfigured()) lines.push({ label: 'la connexion Neat (identifiants, contrat, mappage, marge)', count: 1 });
        const open = count("status IN ('pending', 'failed')");
        if (open > 0) lines.push({ label: `${plural(open, 'souscription', 'souscriptions')} en attente ou en échec`, count: open });
        const cached = db.prepare('SELECT COUNT(*) AS n FROM neat_price_cache').get().n;
        if (cached > 0) lines.push({ label: 'le cache des primes', count: cached });
      } else if (store.isConfigured()) {
        lines.push({ label: 'la connexion Neat (identifiants, contrat, mappage, marge)', count: 1 });
      }
      return lines;
    },
    purge: (db) => {
      resetLegacyColumns(db);
      model = null;
      built = null;
    },
  });
}

module.exports = { id, register };
