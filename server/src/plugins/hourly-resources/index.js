/**
 * Ressources à l'heure — module per specs/plugins-phase-3c-hourly-resources.md §3.C.
 *
 * A resource sold by the hour (the nordic bath) is priced through the core's price-line contributor
 * (rule 11), its hours are placed on real slots at the arrival SAS (rule 12) and show on the planning
 * (rule 14); it can also be rented outside a stay (the external bookings). Its presence is what
 * offers a `per_hour` resource at all (rule 18); the lines already sold are core data and stay.
 */

const sdk = require('../sdk');
const {
  migrationsFor, resetHourlyColumns, countHourlySettings, hasTable, hasColumn,
} = require('./migrations');
const bookingsModel = require('./bookingsModel');
const schedulingModel = require('./schedulingModel');
const planningCardsModel = require('./planningCardsModel');
const { createController } = require('./controller');
const { createVisitModel } = require('./visitModel');
const { createVisitController } = require('./visitController');
const { buildRouter } = require('./routes');
const { createHourlyContributor } = require('./pricing');
const { createHourlyFamily } = require('./hourlyFamily');
const { createSasStep } = require('./sasStep');
const { buildCatalogueLines } = require('./catalogueLines');
const { createScheduler } = require('./scheduler');
const { createSlotAvailability } = require('./slotAvailability');
const { createBathFulfilment } = require('./bathFulfilment');
const { createInvoicing } = require('./invoicing');
const { SETTINGS, standaloneVatRateOf } = require('./settings');

const id = 'hourly-resources';

const plural = (n, one, many) => (n > 1 ? `${n} ${many}` : `1 ${one}`);
const eurosText = (amount) => `${Number(amount).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function register(ctx) {
  // specs/resource-booking-pricing-and-invoicing.md rule 5 (A1) — « TVA des ventes hors séjour ».
  ctx.settings.declare(SETTINGS);
  const standaloneVatRate = () => standaloneVatRateOf(ctx.settings);
  ctx.migrations(migrationsFor((db, row) => bookingsModel.create(db, { standaloneVatRate }).vatFor(row).rate));

  // Built on first use: `resource_bookings` exists only once the plugin is installed, and an erasure
  // drops it.
  const lazy = (build) => {
    let built = null;
    const get = () => {
      if (!built) built = build();
      return built;
    };
    get.reset = () => { built = null; };
    return get;
  };
  // specs/outside-booking-sas.md — the visit of an outside client: its money is the core's sale document, read and written through the visit model.
  let visits = null;
  const bookings = lazy(() => bookingsModel.create(ctx.db, { standaloneVatRate, visits: () => visits() }));
  visits = lazy(() => createVisitModel({ db: ctx.db, bookings }));
  const scheduling = lazy(() => schedulingModel.create(ctx.db));
  const planningCards = lazy(() => planningCardsModel.buildModel(ctx.db));
  const reservations = sdk.coreModule('reservationsModel');
  const invoicing = lazy(() => createInvoicing({ bookings, visits }));
  const controller = lazy(() => createController({ bookings, scheduling, planningCards, reservations, invoicing }));
  const visitController = lazy(() => createVisitController({ bookings, visits, invoicing }));

  // Rules 20-21 — the sales made outside any stay, for the journal and the card batch.
  ctx.standaloneSales((window) => (hasTable(ctx.db, 'resource_bookings') ? bookings().standaloneSales(window) : []));
  // The outside-visit spec rule 37 — the resources sold by the hour are the contexts of the generic « Proposés à l'arrivée » lists (kind `resource`); the lists
  // themselves are the core's `suggested_articles` rows, never a setting of this plugin.
  ctx.suggestionContexts({
    kind: 'resource',
    label: 'Ressources à l’heure',
    list: () => (hasTable(ctx.db, 'resources')
      ? ctx.db.prepare("SELECT id, name AS label FROM resources WHERE priceType = 'per_hour' AND showsPlanningCard = 1 ORDER BY name, id").all()
      : []),
  });
  // Rules 18, A2 — the attachments still to join, the invoices cancelled by hand in Qonto.
  ctx.jobs.every({ name: 'resource-invoices-watch', intervalMs: 60 * 60 * 1000, bootDelayMs: 5 * 60 * 1000, run: () => invoicing().watch() });

  // Rule 11 — the `per_hour` lines of a quote.
  const hourlyContributor = createHourlyContributor();
  ctx.priceLineContributor(hourlyContributor);
  // Rules 5, 47 of the pricing components — the same contributor, wrapped as the `hourly` family of the Articles head.
  ctx.articleFamily('hourly', createHourlyFamily(hourlyContributor));
  // specs/options-resources-ux.md rule 19 — the evening / external rates and the schedule on the card.
  ctx.resourceCatalogueLines(buildCatalogueLines);

  // Rule 10 — the external bookings, the SAS picker's free slots and the planning cards, at their
  // current URLs.
  ctx.mount('/api/resource-bookings', buildRouter(controller, visitController));
  ctx.route('get', '/api/resources/:id/free-slots', (req, res) => controller().freeSlots(req, res));
  ctx.route('get', '/api/planning/resource-cards', (req, res) => controller().resourceCards(req, res));
  ctx.route('post', '/api/planning/resource-cards/done', (req, res) => controller().setResourceCardDone(req, res));
  // The reception prepares the bath: it toggles its cards and reads the external bookings of the day.
  ctx.reception([
    { method: 'POST', re: /^\/planning\/resource-cards\/done$/ },
    { method: 'GET', re: /^\/resource-bookings\/planning-events$/ },
    // specs/outside-booking-sas.md rule 7 — the reception runs the mini SAS inside the day window; paid lines and refunds stay the administrator's (403 in the controller).
    { method: 'GET', re: /^\/resource-bookings\/\d+\/visit$/ },
    { method: 'POST', re: /^\/resource-bookings\/\d+\/visit(\/quote|\/payment)?$/ },
    { method: 'PATCH', re: /^\/resource-bookings\/\d+\/visit\/lines\/\d+$/ },
    { method: 'POST', re: /^\/resource-bookings\/\d+\/visit\/payment-link(\/\d+\/email)?$/ },
    { method: 'DELETE', re: /^\/resource-bookings\/\d+\/visit\/payment-link\/\d+$/ },
  ]);

  // specs/guest-app.md rules 28-31 — the slots a guest books from the app, read from this planning.
  const scheduler = lazy(() => createScheduler(ctx.db));
  ctx.resourceScheduler({
    slotsForStay: (args) => scheduler().slotsForStay(args),
    validateSessions: (args) => scheduler().validateSessions(args),
    orderSupplement: (args) => scheduler().orderSupplement(args),
  });
  // Rules 48-49 of the pricing components — the planning's availability, and the booking a sale of an hourly resource takes.
  const slotAvailability = createSlotAvailability(scheduler);
  ctx.slotAvailability(slotAvailability);
  ctx.articleFulfilment('hourly-slot', createBathFulfilment({ slotAvailability }));

  // Rule 12 — the « Planifier » step of the arrival SAS.
  const sasStep = createSasStep({ scheduling, reservations });
  ctx.sasData((reservationId) => sasStep.data(reservationId));
  ctx.sasCommit(sasStep.hook);

  // Rule 17 (P16) — warn, then erase: the external bookings hold money, journaled or not.
  ctx.data({
    tables: ['resource_bookings'],
    describe: (db) => {
      const lines = [];
      if (hasTable(db, 'resource_bookings')) {
        const all = db.prepare('SELECT COUNT(*) AS n FROM resource_bookings').get().n;
        // The bookings paid for an amount. A payment recorded since 1.4.0 with a part on the books is a sale of the
        // accounting export: the erase takes it out of every month re-exported (specs/resource-booking-pricing-and-invoicing.md
        // rule 21). A « Payé » ticked before (A4), or all in caisse interne, is in no ledger.
        const recorded = hasColumn(db, 'resource_bookings', 'paymentRecordedAt');
        const paidRows = db.prepare(`SELECT totalPrice, reservationId${recorded ? ', paymentRecordedAt, paymentTenders' : ''} FROM resource_bookings WHERE paid = 1 AND totalPrice > 0`).all();
        const onTheBooks = (row) => {
          if (!row.paymentRecordedAt || row.reservationId) return false;
          try { return JSON.parse(row.paymentTenders || '[]').some((t) => !t.internal); } catch { return false; }
        };
        const sum = (rows) => rows.reduce((total, row) => total + Number(row.totalPrice || 0), 0);
        const sold = paidRows.filter(onTheBooks);
        const unledgered = paidRows.filter((row) => !onTheBooks(row));
        if (sold.length > 0) {
          lines.push({
            label: `${plural(sold.length, 'réservation hors séjour', 'réservations hors séjour')}, ${eurosText(sum(sold))} encaissés, retirés de l’export comptable`,
            count: sold.length,
            warning: true,
          });
        }
        if (unledgered.length > 0) {
          lines.push({
            label: `${plural(unledgered.length, 'réservation hors séjour', 'réservations hors séjour')}, ${eurosText(sum(unledgered))} encaissés, absents de la compta`,
            count: unledgered.length,
            warning: true,
          });
        }
        const invoiced = hasColumn(db, 'resource_bookings', 'invoiceCancelledAt')
          ? db.prepare('SELECT COUNT(*) AS n FROM resource_bookings WHERE qontoInvoiceId IS NOT NULL AND invoiceCancelledAt IS NULL').get().n
          : 0;
        if (invoiced > 0) {
          lines.push({ label: `${plural(invoiced, 'facture Qonto émise', 'factures Qonto émises')} : elles restent dans Qonto`, count: invoiced, warning: true });
        }
        const unpaid = all - paidRows.length;
        if (unpaid > 0) lines.push({ label: plural(unpaid, 'réservation hors séjour', 'réservations hors séjour'), count: unpaid });
      }
      const configured = countHourlySettings(db);
      if (configured > 0) {
        lines.push({ label: 'les réglages horaires des ressources (créneaux, chauffe, maintien en température, soirée, tarifs extérieurs)', count: configured });
      }
      return lines;
    },
    purge: (db) => {
      resetHourlyColumns(db);
      bookings.reset();
      visits.reset();
      visitController.reset();
      invoicing.reset();
      scheduling.reset();
      planningCards.reset();
      scheduler.reset();
      controller.reset();
    },
  });
}

module.exports = { id, register };
