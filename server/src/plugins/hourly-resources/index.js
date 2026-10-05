/**
 * Ressources à l'heure — module per specs/plugins-phase-3c-hourly-resources.md §3.C.
 *
 * A resource sold by the hour (the nordic bath) is priced through the core's price-line contributor
 * (rule 11), its hours are placed on real slots at the arrival SAS (rule 12) and show on the planning
 * (rule 14); it can also be rented outside a stay (the external bookings). Its presence is what
 * offers a `per_hour` resource at all (rule 18); the lines already sold are core data and stay.
 */

const sdk = require('../sdk');
const { MIGRATIONS, resetHourlyColumns, hasTable } = require('./migrations');
const bookingsModel = require('./bookingsModel');
const schedulingModel = require('./schedulingModel');
const planningCardsModel = require('./planningCardsModel');
const { createController } = require('./controller');
const { buildRouter } = require('./routes');
const { createHourlyContributor } = require('./pricing');
const { createSasStep } = require('./sasStep');

const id = 'hourly-resources';

const plural = (n, one, many) => (n > 1 ? `${n} ${many}` : `1 ${one}`);
const euros = (amount) => `${Number(amount).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function register(ctx) {
  ctx.migrations(MIGRATIONS);

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
  const bookings = lazy(() => bookingsModel.create(ctx.db));
  const scheduling = lazy(() => schedulingModel.create(ctx.db));
  const planningCards = lazy(() => planningCardsModel.buildModel(ctx.db));
  const reservations = sdk.coreModule('reservationsModel');
  const controller = lazy(() => createController({ bookings, scheduling, planningCards, reservations }));

  // Rule 11 — the `per_hour` lines of a quote.
  ctx.priceLineContributor(createHourlyContributor());

  // Rule 10 — the external bookings, the SAS picker's free slots and the planning cards, at their
  // current URLs.
  ctx.mount('/api/resource-bookings', buildRouter(controller));
  ctx.route('get', '/api/resources/:id/free-slots', (req, res) => controller().freeSlots(req, res));
  ctx.route('get', '/api/planning/resource-cards', (req, res) => controller().resourceCards(req, res));
  ctx.route('post', '/api/planning/resource-cards/done', (req, res) => controller().setResourceCardDone(req, res));
  // The reception prepares the bath: it toggles its cards and reads the external bookings of the day.
  ctx.reception([
    { method: 'POST', re: /^\/planning\/resource-cards\/done$/ },
    { method: 'GET', re: /^\/resource-bookings\/planning-events$/ },
  ]);

  // Rule 12 — the « Planifier » step of the arrival SAS.
  const sasStep = createSasStep({ scheduling, reservations });
  ctx.sasData((reservationId) => sasStep.data(reservationId));
  ctx.sasCommit(sasStep.hook);

  // Rule 17 (P16) — warn, then erase: the external bookings hold money that is in no ledger.
  ctx.data({
    tables: ['resource_bookings'],
    describe: (db) => {
      const lines = [];
      if (hasTable(db, 'resource_bookings')) {
        const all = db.prepare('SELECT COUNT(*) AS n FROM resource_bookings').get().n;
        const paid = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(totalPrice), 0) AS amount FROM resource_bookings WHERE paid = 1').get();
        if (paid.n > 0) {
          lines.push({
            label: `${plural(paid.n, 'réservation hors séjour', 'réservations hors séjour')}, ${euros(paid.amount)} encaissés, absents de la compta`,
            count: paid.n,
            warning: true,
          });
        }
        const unpaid = all - paid.n;
        if (unpaid > 0) lines.push({ label: plural(unpaid, 'réservation hors séjour', 'réservations hors séjour'), count: unpaid });
      }
      const slotted = db.prepare('SELECT COUNT(*) AS n FROM resources WHERE isComplex = 1 OR showsPlanningCard = 1').get().n;
      if (slotted > 0) lines.push({ label: 'les réglages de créneaux des ressources', count: slotted });
      return lines;
    },
    purge: (db) => {
      resetHourlyColumns(db);
      bookings.reset();
      scheduling.reset();
      planningCards.reset();
      controller.reset();
    },
  });
}

module.exports = { id, register };
