/**
 * What the price gate runs on a database, shared by the capture (`buildFixture.mjs`, on the anonymised
 * AND the real copy) and by the tests that replay the committed fixture, so both sides execute the same
 * steps (specs/pricing-components.md §3 rule 68):
 *
 *   loadInputs(db, inputs)        the anonymised rows into a database `database.js` has just migrated
 *   recomputeStays(db)            { [reservationId]: figures } through the current code path
 *   replayIntakes(db, intakes)    each stored intake of Booking / Airbnb replayed on its stay (rule 71)
 *
 * Impure on purpose: it calls the application. The caller sets `DB_PATH` and pins the clock BEFORE the first
 * `require` of `server/src/database.js`; the replays move the clock themselves (a stay is replayed the day
 * before it starts, whatever the day the fixture was captured).
 */
const path = require('node:path');
const { figuresOf } = require('./figuresOf');

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
}

function ficheOf(id) {
  const res = fakeRes();
  app('controllers/reservationsController.js').getById({ params: { id }, user: { id: 1, roles: ['admin'], role: 'admin' } }, res);
  if (res.statusCode !== 200 || !res.body) return null;
  const { remainingDue, paymentComplete, collectedTtc, refundTotals } = res.body;
  return { remainingDue, paymentComplete, collectedTtc, refundTotals };
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
      const { overpaymentOf, overpaymentLinesOf } = app('utils/overpayment.js');
      const { readSplitReceived } = app('utils/splitReceived.js');
      const received = readSplitReceived(db, id);
      const overpaymentTtc = overpaymentOf({
        row,
        captured: model.capturedScheduleContribs(id),
        refundedTtc: app('models/refundsModel.js').totalsByReservation(id).withCash,
        depositAmount: quote.depositAmount,
        balanceAmount: quote.balanceAmount,
        engineOverTtc: quote.overCollectedTtc,
        received,
      });
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

/** { [reservationId]: figures } for every reservation and devis of the database. */
function recomputeStays(db) {
  const out = {};
  for (const { id } of db.prepare('SELECT id FROM reservations ORDER BY id').all()) out[id] = figuresOfStay(db, id);
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

module.exports = { replayGdfFixtures, loadInputs, recomputeStays, quoteHashesOf, figuresOfStay, replayIntakes, storedShape, ROW_COLUMNS, fakeRes };
