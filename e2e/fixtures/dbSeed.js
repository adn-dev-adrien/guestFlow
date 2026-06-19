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
 * Stamp the app_settings stock columns so the linen simulation projects a shortage given the
 * reservations already in the DB (specs/linen-inventory-shortage-tracking.md §5). The caller
 * is responsible for having seeded enough reservations to actually exceed the stock.
 */
function setLinenStock({ single = 0, double = 0, baby = 0, large = 0, medium = 0, small = 0 } = {}) {
  return withDb((db) => {
    db.prepare(`
      UPDATE app_settings SET
        bedLinenStockSingle = ?, bedLinenStockDouble = ?, bedLinenStockBaby = ?,
        towelStockLarge = ?, towelStockMedium = ?, towelStockSmall = ?
      WHERE id = 1
    `).run(single, double, baby, large, medium, small);
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
function seedEmailLog({ reservationId, templateId = null, status = 'sent', channel = 'smtp', renderedSubject = 'Sujet test', renderedBody = 'Corps test', recipientEmail = 'guest@test.fr' }) {
  return withDb((db) => {
    const res = db.prepare(`
      INSERT INTO email_log
        (templateId, reservationId, sentAt, status, channel, errorMessage, renderedSubject, renderedBody, recipientEmail)
      VALUES (?, ?, datetime('now'), ?, ?, '', ?, ?, ?)
    `).run(templateId, reservationId, status, channel, renderedSubject, renderedBody, recipientEmail);
    return Number(res.lastInsertRowid);
  });
}

/**
 * Set a reservation's email language (specs/email-language-fr-en.md) directly — the API create helper
 * doesn't take it, so the bilingual-email spec stamps it here.
 */
function setEmailLanguage(reservationId, lang) {
  return withDb((db) => {
    db.prepare('UPDATE reservations SET emailLanguage = ? WHERE id = ?')
      .run(String(lang) === 'en' ? 'en' : 'fr', reservationId);
  });
}

module.exports = {
  seedPendingDateDrift,
  seedPendingCancellation,
  setLinenStock,
  seedClosure,
  setAllowEditPastReservations,
  lockIcalReservation,
  setReservationDates,
  seedEmailLog,
  setEmailLanguage,
};
