/**
 * Wires the bank reconciliation into the online-payment plugin (specs/qonto-bank-reconciliation.md):
 * tables, the 8-hour read job, the routes, the fiche block, the home subject and the data erasure.
 * Inert without a Qonto connection (rule 1).
 */

const sdk = require('../../sdk');
const express = require('express');
const { up, upV2, upV3, TABLES } = require('./schema');
const { createBankTransactionsModel } = require('./bankTransactionsModel');
const { createReconciliationModel } = require('./reconciliationModel');
const { readTransactions } = require('./transactionsReader');
const { createFicheWriter } = require('./ficheWriter');
const { createReconciliationController } = require('./controller');
const { buildRouter } = require('./routes');
const { summarize, summarizeReserve } = require('./attention');
const { createSplitsModel } = require('./molliePaymentSplits');
const { createSettlementsModel } = require('./mollieSettlements');
const { createMollieConnection } = require('../mollieConnection');

const READ_INTERVAL_MS = 8 * 60 * 60 * 1000;

function mountReconciliation(ctx, { store }) {
  ctx.migrations([{ name: 'reconciliation_v1', up }, { name: 'reconciliation_v2', up: upV2 }, { name: 'reconciliation_v3', up: upV3 }]);

  let controller = null;
  let mollieConnection = null;
  const build = () => {
    if (controller) return controller;
    const { withQonto } = sdk.coreModule('qonto').qontoService;
    const { resolveQontoConfig } = sdk.coreModule('qonto').qontoConfig;
    const { buildLedger } = sdk.coreModule('reservationLedger');
    const { parseGroup } = sdk.coreModule('arrivalPaymentGroup');
    const { applyPaymentMark, computePlatformCommission, takeBackRefusal } = sdk.coreModule('reservationPaymentMark');
    const { platformDisplay } = sdk.coreModule('platformDisplay');
    const { getTodayIsoDate } = sdk.coreModule('reservationHelpers');
    const paymentLinks = sdk.coreModule('paymentLinksModel');
    const reservations = sdk.coreModule('reservationsModel');
    const installments = sdk.coreModule('installmentsModel').buildModel(ctx.db);

    const transactions = createBankTransactionsModel(ctx.db);
    const model = createReconciliationModel(ctx.db);
    const qonto = (fn) => withQonto({ settings: store, origin: 'reconciliation' }, fn);
    const writer = createFicheWriter({ model, applyPaymentMark, computePlatformCommission, reservations, installments, takeBackRefusal });
    const links = paymentLinks.buildModel(ctx.db);
    const settlements = createSettlementsModel(ctx.db);
    const mollie = createMollieConnection({ settings: ctx.settings, db: ctx.db, settlements });
    controller = createReconciliationController({
      splits: createSplitsModel(ctx.db), mollieSettlements: settlements, mollie,
      db: ctx.db, settings: ctx.settings, transactions, model, writer,
      connected: () => store.qontoConnected(),
      qontoConfigured: () => resolveQontoConfig({ settings: store }).configured,
      withQonto: qonto,
      read: () => readTransactions({
        withQonto: qonto, model: transactions, settings: ctx.settings,
        startDate: String(ctx.settings.get('reconciliationStartDate') || getTodayIsoDate()),
      }),
      core: { buildLedger, parseGroup, listLinks: (id) => { try { return links.listForStay(id); } catch { return []; } }, listInstallments: (id) => installments.listFor(id), platformDisplay, todayIso: getTodayIsoDate },
    });
    mollieConnection = mollie;
    return controller;
  };

  const startDateIsSet = () => Boolean(ctx.settings.get('reconciliationStartDate'));

  ctx.mount('/api/payments/reconciliation', buildRouter({
    list: (...a) => build().list(...a), readNow: (...a) => build().readNow(...a), confirm: (...a) => build().confirm(...a),
    undo: (...a) => build().undo(...a), discard: (...a) => build().discard(...a), setOutside: (...a) => build().setOutside(...a),
    linkBatch: (...a) => build().linkBatch(...a), previewAllocation: (...a) => build().previewAllocation(...a),
    confirmAll: (...a) => build().confirmAll(...a), ficheCredits: (...a) => build().ficheCredits(...a),
    candidates: (...a) => build().candidates(...a), bankAccounts: (...a) => build().bankAccounts(...a),
  }));

  // specs/mollie-rolling-reserve-and-incoming-payments.md rule 15 — « Tester » on the optional Mollie account.
  const mollieRouter = express.Router();
  mollieRouter.post('/test', (req, res) => {
    build();
    Promise.resolve(mollieConnection.test({ token: req.body && typeof req.body.token === 'string' ? req.body.token : undefined }))
      .then((answer) => res.status(answer.status).json(answer.body))
      .catch(() => res.status(500).json({ ok: false, settlements: 0, error: 'Erreur interne du test Mollie.' }));
  });
  ctx.mount('/api/plugins/online-payment/mollie', mollieRouter);

  ctx.reservationBlock('online-payment', (reservation) => build().buildFicheBlock(reservation));
  // Rules 18, 23, 28 (SDK 2.29.0) — what the plugin tells the core about the money still to arrive.
  ctx.ledgerBankTranches(({ reservationId }) => build().ledgerTranches(reservationId));
  ctx.incomingPayments(({ recent }) => build().incomingItems({ recent }));
  ctx.journalEntries(({ from, to }) => build().journal({ from, to }));
  // Rule 1 — the split is made when the payment is seen paid, so a later change of the settings never moves it.
  ctx.events.on('reservation.paid', () => { if (startDateIsSet()) build().syncSplits(); });
  ctx.events.on('platform-penalty.changed', ({ reservationId }) => build().afterPenalty(reservationId));
  ctx.paymentDeadlineDecorator((rows) => build().decorateDeadlines(rows));

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
  // Rule 13 — a reserve whose window has passed without a credit.
  ctx.attention({
    key: 'mollie-reserve-late', rank: 56, summarize: summarizeReserve,
    handler: (req, res) => res.json(build().reserveAttention()),
  });

  return { tables: TABLES, describe: () => build().describeData() };
}

module.exports = { mountReconciliation, READ_INTERVAL_MS };
