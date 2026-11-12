/**
 * What the price gate runs on a database, shared by the capture (`buildFixture.mjs`, on the anonymised
 * AND the real copy) and by the tests that replay the committed fixture, so both sides execute the same
 * steps (specs/pricing-components.md §3 rule 68):
 *
 *   loadInputs(db, inputs)        the anonymised rows into a database `database.js` has just migrated, then its backfills
 *   recomputeStays(db)            { [reservationId]: figures } through the current code path
 *   replayIntakes(db, intakes)    each stored intake of Booking / Airbnb replayed on its stay (rule 71)
 *
 * Impure on purpose: it calls the application. The caller sets `DB_PATH` and pins the clock BEFORE the first
 * `require` of `server/src/database.js`; the replays move the clock themselves (a stay is replayed the day
 * before it starts, whatever the day the fixture was captured).
 */
const path = require('node:path');
const { figuresOf, figuresOfResourceBooking, figuresOfPropertyGrid } = require('./figuresOf');

const serverSrc = path.resolve(__dirname, '..', '..', 'server', 'src');
const app = (relative) => require(path.join(serverSrc, relative));
const Database = require('node:module').createRequire(path.join(serverSrc, '..', 'package.json'))('better-sqlite3');

const PARIS_NOON = 'T12:00:00+01:00';

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = () => res;
  res.end = (buffer) => { res.body = buffer; return res; };
  return res;
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

/**
 * Replaces the rows of every table of `inputs.tables` (the tables `database.js` seeds are emptied first),
 * then gives each `clientId` a placeholder client — `clients` is never part of the fixture.
 */
function loadInputs(db, inputs) {
  // The columns a plugin adds to `reservations` (payment methods, commissions) exist in the copy; a fresh
  // database gets them from the plugins' own migrations, for the plugins the copy had.
  const { applyPluginSchema, listPlugins } = app('plugins/sdk/testing.js');
  const shipped = new Set(listPlugins());
  for (const { id } of inputs.tables.plugins || []) if (shipped.has(id)) applyPluginSchema(db, id);
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    for (const [table, rows] of Object.entries(inputs.tables)) {
      const known = new Set(tableColumns(db, table));
      if (known.size === 0) throw new Error(`price-gate fixture names a table this schema lacks: ${table}`);
      if (table === 'app_settings') db.prepare('DELETE FROM app_settings WHERE id != 1').run();
      else db.prepare(`DELETE FROM ${table}`).run();
      for (const row of rows) {
        const columns = Object.keys(row);
        const missing = columns.filter((c) => !known.has(c));
        if (missing.length) throw new Error(`price-gate fixture names columns ${table} lacks: ${missing.join(', ')}`);
        if (table === 'app_settings' && db.prepare('SELECT 1 FROM app_settings WHERE id = 1').get()) {
          db.prepare(`UPDATE app_settings SET ${columns.map((c) => `${c} = @${c}`).join(', ')} WHERE id = 1`).run(row);
        } else {
          db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`).run(row);
        }
      }
    }
    const insertClient = db.prepare("INSERT OR IGNORE INTO clients (id, firstName, lastName) VALUES (?, 'Guest', ?)");
    for (const { clientId } of db.prepare('SELECT DISTINCT clientId FROM reservations WHERE clientId IS NOT NULL').all()) {
      insertClient.run(clientId, String(clientId));
    }
  })();
  // `isDirectChannel` reads a set cached at boot, when this database still held the seeded platforms.
  app('utils/platformNameFormat.js').refreshDirectChannels(db);
  // The boot migrated an EMPTY database: the backfills of the stored columns run again on the rows just loaded, as the
  // boot of a real database runs them (specs/pricing-components.md rule 36).
  const lines = app('utils/pricingLinesMigration.js');
  lines.runPricingLinesMigration(db);
  lines.backfillRefundNettings(db, { force: true });
  lines.backfillStayLevelAllocations(db);
  const sales = app('utils/pricingSalesMigration.js');
  sales.runPricingSalesMigration(db);
  sales.backfillOrderRefsOnce(db);
}

function ficheOf(id) {
  const res = fakeRes();
  app('controllers/reservationsController.js').getById({ params: { id }, user: { id: 1, roles: ['admin'], role: 'admin' } }, res);
  if (res.statusCode !== 200 || !res.body) return null;
  const { remainingDue, paymentComplete, collectedTtc, refundTotals, operationalCollection } = res.body;
  return { remainingDue, paymentComplete, collectedTtc, refundTotals, operationalCollection };
}

/**
 * The commissions a platform withheld, as the code itself reports them (rule 70): the `commission` lines of the
 * requalification a cancellation of the stay builds today, read from the refund the real `cancelReservation` writes —
 * inside a transaction that is rolled back. `null` when the cancellation is refused (platform stay, already cancelled…).
 * Only entry points the baseline exports: `cancelReservation` and the refund model.
 */
function withheldOf(db, id) {
  const { cancelReservation } = app('utils/cancelReservation.js');
  const { COMMISSION_KEY } = app('utils/refunds.js');
  const refundsModel = app('models/refundsModel.js');
  const deps = {
    database: db,
    reservationsModel: app('models/reservationsModel.js'),
    refundsModel,
    compensationsModel: app('models/cancellationCompensationsModel.js'),
    paymentLinksModel: app('models/paymentLinksModel.js'),
    installmentsModel: app('models/installmentsModel.js'),
  };
  let withheld = null;
  try {
    db.transaction(() => {
      const done = cancelReservation(deps, id, { today: app('utils/reservationHelpers.js').getTodayIsoDate(), vatRate: app('models/vatRegimeModel.js').rateForRow(db, { id }) });
      if (done.error) throw ROLLBACK;
      const buckets = {};
      let total = 0;
      for (const refund of refundsModel.listByReservation(id)) {
        if (refund.id !== done.refundId) continue;
        for (const line of refund.lines.filter((l) => l.lineKey === COMMISSION_KEY)) {
          buckets[line.bucket] = (buckets[line.bucket] || 0) + Number(line.amountTtc);
          total += Number(line.amountTtc);
        }
      }
      withheld = { total, buckets };
      throw ROLLBACK;
    })();
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return withheld;
}

/**
 * What the refund side of the application says about a stay (rule 72, PR A bullet): the register (refundable lines,
 * collected TTC, refunds made), the trop-perçu stored on the fiche and the live one read on the stored stay's quote,
 * and the accounting-export entries of its refunds. Through the original module paths only (`controllers/`,
 * `utils/overpayment`, the accounting-export plugin), so the capture on the baseline code and the run on a branch
 * read the same entry points.
 */
function refundInputsOf(db, id, row, quote) {
  const out = { register: null, stored: null, live: null, journal: [] };
  const res = fakeRes();
  app('controllers/refundsController.js').list({ params: { id } }, res);
  if (res.statusCode === 200 && res.body) out.register = res.body;
  if (row.kind === 'reservation') {
    out.stored = app('controllers/reservationsController.js').storedOverpayment(id);
    if (quote && !quote.error) {
      const model = app('models/reservationsModel.js');
      const overpaymentModule = app('utils/overpayment.js');
      const { readSplitReceived } = app('utils/splitReceived.js');
      const received = readSplitReceived(db, id);
      // The one formula of rule 76 on the branch (the stored stay re-priced is its own posted fiche: no drift); the three-argument
      // reader of the baseline when the gate runs on the tag.
      const overpaymentTtc = overpaymentModule.overpayment
        ? overpaymentModule.overpayment(app('models/refundInputModel.js').overpaymentContext(db, id, {
          autoComplementCents: Math.round(Number(quote.complementRoutedAmount || 0) * 100),
        }), { basis: 'asSaved' }).cents / 100
        : overpaymentModule.overpaymentOf({
          row,
          captured: model.capturedScheduleContribs(id),
          refundedTtc: app('models/refundsModel.js').totalsByReservation(id).withCash,
          depositAmount: quote.depositAmount,
          balanceAmount: quote.balanceAmount,
          engineOverTtc: quote.overCollectedTtc,
          received,
        });
      const { overpaymentLinesOf } = overpaymentModule;
      out.live = {
        overpaymentTtc,
        overpaymentLines: overpaymentLinesOf({ row, capturedByPoste: model.capturedScheduleContribsByPoste(id), quote, overpaymentTtc, received }),
      };
    }
  }
  if (out.register && out.register.refunds.length) {
    const accounting = app('plugins/accounting-export/accountingModel.js');
    const { entryToStructured } = app('plugins/accounting-export/accountingExport.js');
    const entries = accounting.create(db);
    const months = [...new Set(out.register.refunds.map((r) => String(r.refundDate).slice(0, 7)))].sort();
    for (const month of months) {
      const [year, mm] = month.split('-').map(Number);
      for (const entry of entries.refundsByMonth({ month: mm, year })) {
        if (Number(entry.reservationId) !== Number(id)) continue;
        out.journal.push({ refundId: entry.refundId == null ? null : entry.refundId, date: entry.paidDate || entry.refundDate || null, lines: entryToStructured(entry).lines });
      }
    }
  }
  return out;
}

/** The collected splits the accounting reads (complement split, per-line data, stored-money buckets of the acompte and the solde). */
function splitsOf(db, id, row) {
  const { computeComplementPaidSplit } = app('utils/complementPaidSplit.js');
  const { buildPerLineData, storedMoneyBuckets } = app('utils/storedMoneySplit.js');
  const vatRate = app('models/vatRegimeModel.js').rateForRow(db, { id });
  return {
    complementSplit: computeComplementPaidSplit(db, id),
    perLine: buildPerLineData(db, row),
    deposit: storedMoneyBuckets(db, row, { kind: 'deposit', revenueTtc: Number(row.depositAmount || 0), vatRate }),
    balance: storedMoneyBuckets(db, row, { kind: 'balance', revenueTtc: Number(row.balanceAmount || 0), vatRate }),
  };
}

/** The figures of one stored stay through the current code path. */
function figuresOfStay(db, id) {
  const { quoteStoredReservation } = app('utils/storedReservationQuote.js');
  const { previewFor } = app('controllers/reservationCancellationController.js');
  const installments = app('models/installmentsModel.js');
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  try {
    const quote = quoteStoredReservation(db, row);
    return figuresOf({
      row,
      quote,
      refunds: row.kind === 'devis' ? null : refundInputsOf(db, id, row, quote),
      fiche: row.kind === 'devis' ? null : ficheOf(id),
      cancellation: row.kind === 'devis' ? null : previewFor(id),
      withheld: row.kind === 'reservation' ? withheldOf(db, id) : null,
      splits: row.kind === 'devis' ? null : splitsOf(db, id, row),
      paymentStatus: row.kind === 'devis' ? null : app('utils/paymentStatus.js').computePaymentStatus(row, app('utils/localDate.js').todayIso()),
      installments: installments.listFor(id),
    });
  } catch (err) {
    return { kind: row.kind, 'quote.error': `threw: ${err.message}` };
  }
}

const crypto = require('node:crypto');

const canonical = (value) => JSON.stringify(value, (key, inner) => (
  inner && typeof inner === 'object' && !Array.isArray(inner)
    ? Object.fromEntries(Object.keys(inner).sort().map((k) => [k, inner[k]]))
    : inner
));

/**
 * { [reservationId]: { keys, hash } } — the whole quote of every stay (all its keys, not the figure subset), as a sorted key
 * list and the SHA-256 of its canonical JSON. Rule 4: COMPOSE must give the quote the engine gave before the refactor, key
 * for key; the hash is captured on the baseline code, so the quote itself (lines, descriptions) never enters the fixture.
 */
function quoteHashesOf(db) {
  const { quoteStoredReservation } = app('utils/storedReservationQuote.js');
  const out = {};
  for (const row of db.prepare('SELECT * FROM reservations ORDER BY id').all()) {
    let quote;
    try { quote = quoteStoredReservation(db, row); } catch (err) { quote = { threw: err.message }; }
    out[row.id] = { keys: Object.keys(quote || {}).sort(), hash: crypto.createHash('sha256').update(canonical(quote)).digest('hex') };
  }
  return out;
}

/** { [propertyId]: figures } — the platform price grid (commission grossing-up) of every property. */
function recomputePropertyGrids(db) {
  const model = app('models/propertiesModel.js');
  const out = {};
  for (const { id } of db.prepare('SELECT id FROM properties ORDER BY id').all()) out[id] = figuresOfPropertyGrid(model.platformPrices(id));
  return out;
}

const PARIS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** The instant `HH:MM` of the Paris day `date` (the offset follows the daylight-saving time of that day). */
function parisInstant(date, time) {
  for (const offset of ['+01:00', '+02:00']) {
    const instant = new Date(`${date}T${time}:00${offset}`);
    const parts = Object.fromEntries(PARIS.formatToParts(instant).map((p) => [p.type, p.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` === date && `${parts.hour}:${parts.minute}` === time) return instant.toISOString();
  }
  throw new Error(`no Paris instant for ${date} ${time}`);
}

/**
 * The instants a stay is read at (rule 68): the capture day, and three moments of its own life — the minute before
 * and the minute of the arrival at 15:00, and the noon after its departure. Derived from the stored row, here, so the
 * capture and the gate read the same moments and no test file writes a date.
 */
function instantsOf(row, capturedAt) {
  const instants = [['capture', new Date(capturedAt).toISOString()]];
  if (row.startDate) {
    instants.push(['arrival-1459', parisInstant(row.startDate, '14:59')], ['arrival-1500', parisInstant(row.startDate, '15:00')]);
  }
  if (row.endDate) instants.push(['after', parisInstant(addDays(row.endDate, 1), '12:00')]);
  return instants;
}

/**
 * { [reservationId]: figures } for every reservation and devis of the database, each read at the four instants of
 * `instantsOf`; a figure's name ends with `@capture`, `@arrival-1459`, `@arrival-1500` or `@after`. `pinClock(instant)`
 * moves the clock and returns the function that puts it back on `capturedAt`; `figuresOf(db, id)` is the stay's figures (a test passes its own).
 */
function recomputeStays(db, { capturedAt, pinClock, figuresOf = figuresOfStay }) {
  const out = {};
  for (const row of db.prepare('SELECT id, startDate, endDate FROM reservations ORDER BY id').all()) {
    out[row.id] = {};
    for (const [name, instant] of instantsOf(row, capturedAt)) {
      const unpin = pinClock(instant);
      try {
        for (const [figure, value] of Object.entries(figuresOf(db, row.id))) out[row.id][`${figure}@${name}`] = value;
      } finally {
        unpin();
      }
    }
  }
  return out;
}

/** { [bookingId]: figures } for every standalone resource booking (hourly-resources), at the capture instant. */
function recomputeResourceBookings(db) {
  const out = {};
  const present = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'resource_bookings'").get();
  if (!present) return out;
  const model = app('plugins/hourly-resources/bookingsModel.js').create(db, { standaloneVatRate: () => 20 });
  const sales = new Map();
  // A production copy opened without the plugin's runtime may still hold the table of an older version, with no payment columns.
  const columns = new Set(tableColumns(db, 'resource_bookings'));
  const days = ['paidAt', 'paymentRecordedAt', 'paymentTenders'].every((c) => columns.has(c))
    ? db.prepare('SELECT MIN(paidAt) AS first, MAX(paidAt) AS last FROM resource_bookings WHERE paidAt IS NOT NULL').get()
    : null;
  if (days && days.first) {
    for (const sale of model.standaloneSales({ from: days.first, to: days.last })) {
      const { key, date, totalCents, booksCents, cardCents, vatRate } = sale;
      sales.set(Number(String(key).split(':')[1]), { key, date, totalCents, booksCents, cardCents, vatRate });
    }
  }
  for (const row of db.prepare('SELECT * FROM resource_bookings ORDER BY id').all()) {
    let breakdown = null;
    try {
      const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(row.resourceId);
      breakdown = resource ? model.breakdownOf({
        resource, startTime: row.startTime, endTime: row.endTime, propertyId: row.propertyId, reservationId: row.reservationId,
        offeredMinutes: row.offeredMinutes, date: row.date, stored: row,
      }) : null;
    } catch (err) {
      breakdown = { threw: err.message };
    }
    out[row.id] = figuresOfResourceBooking({ row, breakdown, sale: sales.get(row.id) || null });
  }
  return out;
}

// ---- Intake replay (rule 71) -----------------------------------------------------------------------------

const ROW_COLUMNS = ['totalPrice', 'finalPrice', 'depositAmount', 'balanceAmount', 'complementAmount', 'touristTaxTotal', 'touristTaxRate',
  'discountPercent', 'platform', 'reservationNumber', 'adults', 'children', 'teens', 'babies', 'singleBeds', 'doubleBeds', 'babyBeds', 'checkInTime',
  'platformGrossAmount', 'platformPayoutAmount', 'platformTouristTaxAmount', 'platformCommissionAmount', 'acompteCommissionAmount',
  'clientGrossAmount', 'depositDueDate', 'balanceDueDate'];

function storedShape(db, id) {
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const pick = (table, columns, order) => db.prepare(`SELECT ${columns.join(', ')} FROM ${table} WHERE reservationId = ? ORDER BY ${order}`).all(id);
  return {
    row: Object.fromEntries(ROW_COLUMNS.map((c) => [c, row[c] === undefined ? null : row[c]])),
    lines: {
      options: pick('reservation_options', ['optionId', 'quantity', 'unitPrice', 'billedUnits', 'totalPrice', 'offered', 'inComplement'], 'optionId'),
      custom: pick('reservation_custom_options', ['amount', 'offered', 'inComplement', 'quantity'], 'sortOrder, id'),
      resources: pick('reservation_resources', ['resourceId', 'quantity', 'unitPrice', 'billedUnits', 'totalPrice', 'offered', 'inComplement'], 'resourceId'),
    },
  };
}

const addDays = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const ROLLBACK = new Error('price-gate replay rollback');

/** The SDK the three intake plugins call, minus the client: a replay prices a stay, it creates nobody. */
function intakeCore() {
  const { reservations } = app('plugins/sdk/coreServices.js');
  return {
    updateReservation: (id, patch, { label } = {}) => reservations.update(id, patch, { label }),
    updateBody: reservations.updateBody,
    suggestBeds: reservations.suggestBeds,
    platformCommission: reservations.platformCommission,
  };
}

function bookingService(db, intake, stay, today, clock) {
  const { buildModel, TABLE_SQL } = app('plugins/booking-intake/intakesModel.js');
  const { createIntakeService } = app('plugins/booking-intake/intakeService.js');
  const { reservations } = app('plugins/sdk/coreServices.js');
  const memory = new Database(':memory:');
  memory.exec(TABLE_SQL);
  const model = buildModel(memory);
  const id = model.insert({ resId: intake.resId, hotelId: intake.hotelId, reservationId: stay.id, status: 'proposed', parsed: JSON.parse(intake.parsed) });
  const core = intakeCore();
  const service = createIntakeService({
    intakes: model,
    hotelIds: () => ({}),
    findReservations: () => [],
    getReservation: (rid) => app('models/reservationsModel.js').getByIdWithDetails(rid),
    clientShared: () => true,
    core: { ...core, updateClient: () => {}, withholdsTouristTax: (propertyId) => reservations.platformWithholdsTouristTax(propertyId, 'booking') },
    today: () => today,
    now: () => new Date(clock()),
  });
  return () => service.applyProposal(id);
}

function airbnbService(db, intake, stay, today, clock) {
  const { buildModel, TABLE_SQL } = app('plugins/airbnb-intake/intakesModel.js');
  const { createIntakeService } = app('plugins/airbnb-intake/intakeService.js');
  const { reservations } = app('plugins/sdk/coreServices.js');
  const parsed = JSON.parse(intake.parsed);
  const memory = new Database(':memory:');
  memory.exec(TABLE_SQL);
  const model = buildModel(memory);
  const id = model.insert({ messageId: `replay-${intake.id}`, receivedAt: intake.receivedAt, confirmationCode: intake.confirmationCode, parsed, status: 'proposed' });
  const core = intakeCore();
  const service = createIntakeService({
    intakes: model,
    settings: { listings: () => [[stay.propertyId, String(parsed.listingId)]], mailbox: () => ({}), sender: () => '', autoApply: () => false },
    readMails: async () => {},
    findReservations: ({ propertyIds, startDate, endDate }) => db.prepare(
      `SELECT * FROM reservations WHERE propertyId IN (${propertyIds.map(() => '?').join(',')}) AND startDate = ? AND endDate = ?`,
    ).all(...propertyIds, startDate, endDate),
    propertyOptions: (propertyId) => app('models/optionsModel.js').listForProperty(propertyId),
    getReservation: (rid) => app('models/reservationsModel.js').getByIdWithDetails(rid),
    core: { ...core, withholdsTouristTax: (propertyId, platform) => reservations.platformWithholdsTouristTax(propertyId, platform) },
    today: () => today,
    now: () => new Date(clock()),
  });
  return () => service.applyFromBanner(id);
}

const SERVICES = { booking_intakes: bookingService, airbnb_intakes: airbnbService };

/**
 * Replays every stored intake that parsed and applied (`booking_intakes`, `airbnb_intakes` rows of
 * `intakes.tables`) on its stay, through the plugin's own plan → patch → save (the SDK `reservations.update`),
 * one rolled-back transaction each. `pinClock(isoInstant)` moves the clock (the test and the capture pass their
 * own); the intake service is told the same day.
 */
function replayIntakes(db, intakes, pinClock) {
  const results = [];
  for (const [table, build] of Object.entries(SERVICES)) {
    for (const intake of intakes.tables[table] || []) {
      if (intake.status !== 'applied' || !intake.parsed || intake.reservationId == null) continue;
      const stay = db.prepare('SELECT id, propertyId, startDate, kind FROM reservations WHERE id = ?').get(intake.reservationId);
      const label = `${table}#${intake.id}`;
      if (!stay || stay.kind !== 'reservation') { results.push({ intake: label, reservationId: intake.reservationId, outcome: 'no-stay' }); continue; }
      const today = addDays(stay.startDate, -1);
      const instant = `${today}${PARIS_NOON}`;
      const unpin = pinClock(instant);
      let result;
      try {
        db.transaction(() => {
          const run = build(db, intake, stay, today, () => new Date(instant).getTime());
          const answer = run();
          result = { intake: label, reservationId: stay.id, outcome: answer.status, error: answer.error || null, ...storedShape(db, stay.id), figures: figuresOfStay(db, stay.id) };
          throw ROLLBACK;
        })();
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      } finally {
        unpin();
      }
      results.push(result);
    }
  }
  return results;
}

// Gîtes de France has no stored intake in the snapshot: the plugin's own parser fixtures (its public, fictitious
// « nouvelle réservation » mail and a variant with another net) are parsed by the plugin and applied, with the first
// rent that fits the net, on the first Gîtes de France stay of the database — dates and gîte number follow the stay, the dossier number is a fixture one (the real number is another stay's).
function replayGdfFixtures(db, pinClock) {
  const gdf = 'plugins/gites-de-france-intake';
  const { parseGitesDeFranceMail } = app(`${gdf}/mailParser.js`);
  const { rentCandidates } = app(`${gdf}/rentFromNet.js`);
  const { buildModel, TABLE_SQL } = app(`${gdf}/intakesModel.js`);
  const { createIntakeService } = app(`${gdf}/intakeService.js`);
  const { BOOKING_MAIL, withTotals } = app(`${gdf}/tests/fixtures.js`);
  const mails = [BOOKING_MAIL, withTotals(BOOKING_MAIL, { net: '460.00', options: '80.00', total: '540.00' })];
  const stay = db.prepare("SELECT id, propertyId, platform, startDate, endDate FROM reservations WHERE kind = 'reservation' AND platform LIKE 'Gites%' ORDER BY id LIMIT 1").get();
  const results = [];
  if (!stay) return results;
  const { reservations } = app('plugins/sdk/coreServices.js');
  const platforms = app('models/platformsModel.js');
  mails.forEach((mail, index) => {
    const parsed = { ...parseGitesDeFranceMail(mail).booking, startDate: stay.startDate, endDate: stay.endDate, dossierNumber: `PG-${index + 1}` };
    const today = addDays(stay.startDate, -1);
    const instant = `${today}${PARIS_NOON}`;
    const unpin = pinClock(instant);
    let result;
    try {
      db.transaction(() => {
        const memory = new Database(':memory:');
        memory.exec(TABLE_SQL);
        const model = buildModel(memory);
        const intakeId = model.insert({ messageId: `fixture-${index}`, receivedAt: new Date(instant).toISOString(), dossierNumber: parsed.dossierNumber, parsed, status: 'proposed' });
        const service = createIntakeService({
          intakes: model,
          settings: { giteNumbers: () => ({ [stay.propertyId]: parsed.giteNumber }), mailbox: () => ({}), sender: () => '', autoApply: () => false },
          readMails: async () => {},
          findReservations: ({ propertyIds, startDate, endDate }) => db.prepare(
            `SELECT * FROM reservations WHERE propertyId IN (${propertyIds.map(() => '?').join(',')}) AND startDate = ? AND endDate = ?`,
          ).all(...propertyIds, startDate, endDate),
          commissionPercent: (platform) => Number((platforms.findByName(platform) || {}).commissionPercent || 0),
          propertyOptions: (propertyId) => app('models/optionsModel.js').listForProperty(propertyId),
          getReservation: (rid) => app('models/reservationsModel.js').getByIdWithDetails(rid),
          core: intakeCore(),
          today: () => today,
          now: () => new Date(instant),
        });
        const rent = rentCandidates(parsed.netRent, Number((platforms.findByName(stay.platform) || {}).commissionPercent || 0))[0];
        const answer = service.applyFromBanner(intakeId, { rent });
        result = { intake: `gdf-fixture#${index + 1}`, reservationId: stay.id, outcome: answer.status, error: answer.error || null, ...storedShape(db, stay.id), figures: figuresOfStay(db, stay.id) };
        throw ROLLBACK;
      })();
    } catch (err) {
      if (err !== ROLLBACK) throw err;
    } finally {
      unpin();
    }
    results.push(result);
  });
  return results;
}

module.exports = { replayGdfFixtures, loadInputs, recomputeStays, recomputeResourceBookings, recomputePropertyGrids, instantsOf, parisInstant, quoteHashesOf, figuresOfStay, replayIntakes, storedShape, ROW_COLUMNS, fakeRes };
