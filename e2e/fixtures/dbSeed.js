// @ts-check
// Direct SQLite seed helpers (specs/e2e-playwright-smoke-suite.md §3.1 rule 6, §4.3). Used when
// the spec wants to exercise the UI surfacing of server-side state WITHOUT going through the
// real engine (sync, simulation, etc.). The engines have dense unit test coverage already
// (~880 server tests pin their math); the E2E suite verifies that the Dashboard / Planning
// surface those states correctly.
//
// The helpers open the same `DB_PATH` SQLite file the server is using. SQLite shares the file
// across processes, so direct INSERTs are immediately visible on the next API read. WAL is
// auto-flushed.

const Database = require('better-sqlite3');

const DB_PATH = process.env.GUESTFLOW_E2E_DB_PATH || '/tmp/guestflow-e2e.db';

function withDb(fn) {
  const db = new Database(DB_PATH);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/**
 * Insert a pending row in `ical_date_drift_alerts` (specs/ical-sync-override-locked-dates.md
 * §5). Used by the Dashboard date-drift card spec — no need to run the real sync engine.
 */
function seedPendingDateDrift({ reservationId, previousStartDate, previousEndDate, newStartDate, newEndDate }) {
  return withDb((db) => {
    const res = db.prepare(`
      INSERT INTO ical_date_drift_alerts
        (reservationId, previousStartDate, previousEndDate, newStartDate, newEndDate, detectedAt)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(reservationId, previousStartDate, previousEndDate, newStartDate, newEndDate);
    return Number(res.lastInsertRowid);
  });
}

/**
 * Insert a pending row in `ical_cancellation_alerts` (specs/ical-cancellation-approval.md §5).
 */
function seedPendingCancellation({ reservationId, sourceId, eventUid }) {
  return withDb((db) => {
    const res = db.prepare(`
      INSERT INTO ical_cancellation_alerts (reservationId, sourceId, eventUid, detectedAt)
      VALUES (?, ?, ?, datetime('now'))
    `).run(reservationId, sourceId, eventUid);
    return Number(res.lastInsertRowid);
  });
}

/**
 * Stamp the linen stock in the `linen` plugin's settings so the linen simulation projects a shortage
 * given the reservations already in the DB (specs/linen-inventory-shortage-tracking.md §5,
 * specs/plugins-phase-2-hosts.md rule 15). The caller is responsible for having seeded enough
 * reservations to actually exceed the stock.
 */
function setLinenStock({ single = 0, double = 0, baby = 0, large = 0, medium = 0, small = 0 } = {}) {
  return withDb((db) => {
    const upsert = db.prepare(`
      INSERT INTO plugin_settings (plugin_id, key, value, updated_at) VALUES ('linen', ?, ?, datetime('now'))
      ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    Object.entries({
      bedLinenStockSingle: single, bedLinenStockDouble: double, bedLinenStockBaby: baby,
      towelStockLarge: large, towelStockMedium: medium, towelStockSmall: small,
    }).forEach(([key, value]) => upsert.run(key, String(value)));
  });
}

/**
 * Insert an establishment closure (specs/establishment-closures.md). Used to verify the
 * reservation form rejects dates inside a closure.
 */
function seedClosure({ propertyId, startDate, endDate, reason = 'Test closure' }) {
  return withDb((db) => {
    const res = db.prepare(`
      INSERT INTO establishment_closures (propertyId, startDate, endDate, reason)
      VALUES (?, ?, ?, ?)
    `).run(propertyId, startDate, endDate, reason);
    return Number(res.lastInsertRowid);
  });
}

/**
 * Toggle the global "allow editing past reservations" flag for the admin escape hatch test
 * (specs/admin-unlock-past-reservations.md).
 */
function setAllowEditPastReservations(value) {
  return withDb((db) => {
    db.prepare('UPDATE app_settings SET allowEditPastReservations = ? WHERE id = 1')
      .run(value ? 1 : 0);
  });
}

/**
 * Mark a reservation as iCal-sync-locked so the date-drift / cancellation specs can exercise
 * the locked branch without going through a manual edit cycle.
 */
function lockIcalReservation(reservationId) {
  return withDb((db) => {
    db.prepare('UPDATE reservations SET icalSyncLocked = 1 WHERE id = ?').run(reservationId);
  });
}

/**
 * Force a reservation's stay dates directly (bypasses the API "no past dates" guard). Used to set up
 * a past stay for the email-history rolling-window spec without flipping the global admin escape hatch.
 */
// specs/reservation-payment-ledger.md — a property that takes an acompte (30 %), so the ledger has
// both an acompte and a solde row.
function enablePropertyDeposit(propertyId, percent = 30) {
  return withDb((db) => {
    db.prepare('UPDATE properties SET depositEnabled = 1, depositPercent = ? WHERE id = ?').run(percent, propertyId);
  });
}

// specs/reservation-payment-ledger.md rule 7 — a stored amount that drifted from today's engine (a
// stay priced under an earlier rule), to prove the fiche shows and marks what is stored.
function setReservationAmounts(reservationId, fields) {
  return withDb((db) => {
    const cols = Object.keys(fields);
    db.prepare(`UPDATE reservations SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => fields[c]), reservationId);
  });
}

function setReservationDates(reservationId, startDate, endDate) {
  return withDb((db) => {
    db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?')
      .run(startDate, endDate, reservationId);
  });
}

/**
 * Insert a row in `email_log` (specs/email-history-rolling-window.md). Used to exercise the
 * history list + rolling window without an SMTP send.
 */
function seedEmailLog({ reservationId, templateId = null, status = 'sent', channel = 'smtp', renderedSubject = 'Sujet test', renderedBody = 'Corps test', recipientEmail = 'guest@test.fr', sentAt = null }) {
  return withDb((db) => {
    const res = db.prepare(`
      INSERT INTO email_log
        (templateId, reservationId, sentAt, status, channel, errorMessage, renderedSubject, renderedBody, recipientEmail)
      VALUES (?, ?, COALESCE(?, datetime('now')), ?, ?, '', ?, ?, ?)
    `).run(templateId, reservationId, sentAt, status, channel, renderedSubject, renderedBody, recipientEmail);
    return Number(res.lastInsertRowid);
  });
}

/**
 * Set a reservation's email language directly (transitional fallback path).
 */
function setEmailLanguage(reservationId, lang) {
  return withDb((db) => {
    db.prepare('UPDATE reservations SET emailLanguage = ? WHERE id = ?')
      .run(String(lang) === 'en' ? 'en' : 'fr', reservationId);
  });
}

/**
 * Set a CLIENT's email language (specs/email-client-language-and-fiche-polish.md) — drives every email
 * for that client. The API create helper doesn't take it, so the spec stamps it here.
 */
function setClientEmailLanguage(clientId, lang) {
  return withDb((db) => {
    db.prepare('UPDATE clients SET emailLanguage = ? WHERE id = ?')
      .run(String(lang) === 'en' ? 'en' : 'fr', clientId);
  });
}

/**
 * A « Boissons » + « Restauration » catalogue, linked to one property. The core no longer seeds one
 * (specs/plugins-phase-p-productisation.md rule 12): the spec that needs it brings it, here the list
 * Solio's database holds. Idempotent per article.
 */
function seedCateringOptions(propertyId) {
  const CATERING = require('../../server/src/tests/fixtures/productisation/solio-catering.json');
  return withDb((db) => {
    for (const o of CATERING) {
      let row = db.prepare('SELECT id FROM options WHERE seedKey = ?').get(o.seedKey);
      if (!row) {
        const res = db.prepare("INSERT INTO options (title, price, priceType, category, seedKey) VALUES (?, ?, 'per_stay', ?, ?)")
          .run(o.title, o.price, o.category, o.seedKey);
        row = { id: Number(res.lastInsertRowid) };
      }
      db.prepare('INSERT OR IGNORE INTO property_options (propertyId, optionId) VALUES (?, ?)').run(propertyId, row.id);
    }
  });
}

/**
 * Set one company setting (specs/guest-email-texts-made-simple.md rule 15 — the test send goes to the
 * company address). Returns the previous value so a spec can put it back.
 */
function setCompanySetting(column, value) {
  if (!['companyEmail', 'companyPhone'].includes(column)) throw new Error(`unsupported column ${column}`);
  return withDb((db) => {
    const previous = (db.prepare(`SELECT ${column} AS v FROM app_settings LIMIT 1`).get() || {}).v;
    db.prepare(`UPDATE app_settings SET ${column} = ?`).run(value);
    return previous;
  });
}

/**
 * The public URL the userscript of a plugin embeds (app_settings.publicUrl) — empty on a fresh database.
 */
function setPublicUrl(url) {
  return withDb((db) => {
    db.prepare('UPDATE app_settings SET publicUrl = ? WHERE id = 1').run(url);
  });
}

/**
 * Make a reservation look like the placeholder an iCal import created: source type and feed key.
 */
function markIcalImported(reservationId, platformKey) {
  return withDb((db) => {
    // Like a real import: the stay points at an active source of its property for that platform, which
    // is what the Booking intake reads to tell Booking's stays (specs/booking-extranet-intake.md rule 21).
    const { propertyId } = db.prepare('SELECT propertyId FROM reservations WHERE id = ?').get(reservationId);
    const existing = db.prepare('SELECT id FROM ical_sources WHERE propertyId = ? AND platformKey = ?').get(propertyId, platformKey);
    const sourceId = existing ? existing.id : Number(db.prepare(
      "INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, isActive) VALUES (?, ?, '', ?, ?, 1)",
    ).run(propertyId, platformKey, platformKey, platformKey).lastInsertRowid);
    db.prepare("UPDATE reservations SET sourceType = 'ical', sourcePlatformKey = ?, sourceIcalSourceId = ? WHERE id = ?")
      .run(platformKey, sourceId, reservationId);
  });
}

/**
 * Overwrite one stored « Paiement plateforme » figure, as if the operator had edited it by hand.
 */
function setPlatformPayout(reservationId, amount) {
  return withDb((db) => {
    db.prepare('UPDATE reservations SET platformPayoutAmount = ? WHERE id = ?').run(amount, reservationId);
  });
}

// specs/vat-optional-mode.md — a stay booked in the past, so a switch « à partir d'aujourd'hui » leaves it alone.
function backdateReservation(reservationId, createdAt) {
  return withDb((db) => {
    db.prepare('UPDATE reservations SET createdAt = ? WHERE id = ?').run(createdAt, reservationId);
  });
}

// The shared E2E database carries the VAT regime from one spec to the next: back to period 1 at 10 %.
function resetVatRegime() {
  return withDb((db) => {
    db.prepare('UPDATE reservations SET vatPeriodId = 1').run();
    db.prepare('DELETE FROM vat_periods WHERE id > 1').run();
    db.prepare('UPDATE vat_periods SET rate = 10 WHERE id = 1').run();
    db.prepare('UPDATE app_settings SET vatRate = 10 WHERE id = 1').run();
  });
}

module.exports = {
  backdateReservation,
  resetVatRegime,
  enablePropertyDeposit,
  setReservationAmounts,
  setCompanySetting,
  seedCateringOptions,
  setPublicUrl,
  markIcalImported,
  setPlatformPayout,
  seedPendingDateDrift,
  seedPendingCancellation,
  setLinenStock,
  seedClosure,
  setAllowEditPastReservations,
  lockIcalReservation,
  setReservationDates,
  seedEmailLog,
  setEmailLanguage,
  setClientEmailLanguage,
};
