/**
 * Wires the bank reconciliation into the online-payment plugin (specs/qonto-bank-reconciliation.md):
 * tables, the 8-hour read job, the routes, the fiche block, the home subject and the data erasure.
 * Inert without a Qonto connection (rule 1).
 */

const sdk = require('../../sdk');
const { up, TABLES } = require('./schema');
const { createBankTransactionsModel } = require('./bankTransactionsModel');
const { createReconciliationModel } = require('./reconciliationModel');
const { readTransactions } = require('./transactionsReader');
const { createFicheWriter } = require('./ficheWriter');
const { createReconciliationController } = require('./controller');
const { buildRouter } = require('./routes');
const { summarize } = require('./attention');

const READ_INTERVAL_MS = 8 * 60 * 60 * 1000;

function mountReconciliation(ctx, { store }) {
  ctx.migrations([{ name: 'reconciliation_v1', up }]);

  let controller = null;
  const build = () => {
    if (controller) return controller;
    const { withQonto } = sdk.coreModule('qonto').qontoService;
    const { buildLedger } = sdk.coreModule('reservationLedger');
    const { parseGroup } = sdk.coreModule('arrivalPaymentGroup');
    const { applyPaymentMark, computePlatformCommission } = sdk.coreModule('reservationPaymentMark');
    const { platformDisplay } = sdk.coreModule('platformDisplay');
    const { getTodayIsoDate } = sdk.coreModule('reservationHelpers');
    const paymentLinks = sdk.coreModule('paymentLinksModel');
    const reservations = sdk.coreModule('reservationsModel');
    const installments = sdk.coreModule('installmentsModel').buildModel(ctx.db);

    const transactions = createBankTransactionsModel(ctx.db);
    const model = createReconciliationModel(ctx.db);
    const qonto = (fn) => withQonto({ settings: store, origin: 'reconciliation' }, fn);
    const writer = createFicheWriter({ model, applyPaymentMark, computePlatformCommission, reservations });
    const links = paymentLinks.buildModel(ctx.db);
    controller = createReconciliationController({
      db: ctx.db, settings: ctx.settings, transactions, model, writer,
      connected: () => store.qontoConnected(),
      withQonto: qonto,
      read: () => readTransactions({
        withQonto: qonto, model: transactions, settings: ctx.settings,
        startDate: String(ctx.settings.get('reconciliationStartDate') || getTodayIsoDate()),
      }),
      core: { buildLedger, parseGroup, listLinks: (id) => { try { return links.listForReservation(id); } catch { return []; } }, listInstallments: (id) => installments.listFor(id), platformDisplay, todayIso: getTodayIsoDate },
    });
    return controller;
  };

  ctx.mount('/api/payments/reconciliation', buildRouter({
    list: (...a) => build().list(...a), readNow: (...a) => build().readNow(...a), confirm: (...a) => build().confirm(...a),
    undo: (...a) => build().undo(...a), discard: (...a) => build().discard(...a), setOutside: (...a) => build().setOutside(...a),
    linkBatch: (...a) => build().linkBatch(...a), previewAllocation: (...a) => build().previewAllocation(...a),
    confirmAll: (...a) => build().confirmAll(...a), ficheCredits: (...a) => build().ficheCredits(...a),
    candidates: (...a) => build().candidates(...a), bankAccounts: (...a) => build().bankAccounts(...a),
  }));

  ctx.reservationBlock('online-payment', (reservation) => build().buildFicheBlock(reservation));

  ctx.jobs.every({
    name: 'bank-reconciliation-read',
    intervalMs: READ_INTERVAL_MS,
    bootDelayMs: 4 * 60 * 1000,
    run: async () => {
      try {
        await build().runJob();
      } catch (err) {
        ctx.log.error('reconciliation read error:', err && err.message ? err.message : err);
      }
    },
  });

  ctx.attention({
    key: 'bank-reconciliation', rank: 55, summarize,
    handler: (req, res) => res.json(build().attention()),
  });

  return { tables: TABLES, describe: () => build().describeData() };
}

module.exports = { mountReconciliation, READ_INTERVAL_MS };
