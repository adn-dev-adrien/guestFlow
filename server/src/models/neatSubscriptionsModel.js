/**
 * Neat subscription jobs + premium cache (specs/neat-cancellation-insurance-subscription.md §5).
 *
 * One job per (reservation, environment); statuses pending | active | failed | voided. `failed`
 * means « the last attempt failed » — the backoff ladder keeps retrying it (spec rule 10; even a
 * Neat 400 is retried, the fix being an operator act the next attempt picks up), so it is a
 * display state, not a terminal one. Only `voided` and a scan-detected disqualification end a job.
 *
 * `neat_price_cache` backs the guest-pricing fallback ladder (utils/neatGuestPricing.js).
 */

// Backoff ladder (spec rule 10): attempt № → delay before the next try.
const RETRY_DELAYS_MS = [
  60 * 1000, // after 1st failure: 1 min
  5 * 60 * 1000, // 5 min
  30 * 60 * 1000, // 30 min
  2 * 60 * 60 * 1000, // 2 h
];
const RETRY_STEADY_MS = 6 * 60 * 60 * 1000; // then every 6 h

function retryDelayMs(attempts) {
  return RETRY_DELAYS_MS[attempts - 1] || RETRY_STEADY_MS;
}

function buildModel(database) {
  const findByReservation = database.prepare(
    'SELECT * FROM neat_subscriptions WHERE reservationId = ? AND environment = ?'
  );

  return {
    getByReservationId(reservationId, environment) {
      return findByReservation.get(Number(reservationId), String(environment)) || null;
    },

    // Rule-7 scan: direct, live, not-started, insured reservations with the stay money engaged and
    // no job yet for this environment. The platform filter (isDirectChannel) is applied by the
    // caller in JS — SQL only pre-filters the obvious platform names would drift from the util.
    findEligibleWithoutJob(environment, today) {
      return database.prepare(`
        SELECT r.id, r.platform, r.startDate, r.endDate, r.adults, r.children, r.clientId, r.propertyId
        FROM reservations r
        WHERE r.kind = 'reservation'
          AND r.startDate > ?
          AND (r.depositPaid = 1 OR (r.depositDisabled = 1 AND r.balancePaid = 1))
          AND EXISTS (
            SELECT 1 FROM reservation_options ro
            JOIN options o ON o.id = ro.optionId
            WHERE ro.reservationId = r.id AND o.isCancellationInsurance = 1
          )
          AND NOT EXISTS (
            SELECT 1 FROM neat_subscriptions ns
            WHERE ns.reservationId = r.id AND ns.environment = ?
          )
        ORDER BY r.id
      `).all(String(today), String(environment));
    },

    // Pending jobs whose reservation no longer qualifies (insurance line removed, cancelled,
    // un-paid, stay started) — the scan drops them (spec rule 16 + edge cases).
    listPendingDisqualified(environment, today) {
      return database.prepare(`
        SELECT ns.id, ns.reservationId
        FROM neat_subscriptions ns
        JOIN reservations r ON r.id = ns.reservationId
        WHERE ns.environment = ? AND ns.status = 'pending'
          AND (
            r.kind != 'reservation'
            OR r.startDate <= ?
            OR NOT (r.depositPaid = 1 OR (r.depositDisabled = 1 AND r.balancePaid = 1))
            OR NOT EXISTS (
              SELECT 1 FROM reservation_options ro
              JOIN options o ON o.id = ro.optionId
              WHERE ro.reservationId = r.id AND o.isCancellationInsurance = 1
            )
          )
      `).all(String(environment), String(today));
    },

    listDue(environment, nowIso) {
      return database.prepare(`
        SELECT * FROM neat_subscriptions
        WHERE environment = ? AND status IN ('pending', 'failed')
          AND (nextAttemptAt IS NULL OR nextAttemptAt <= ?)
        ORDER BY id
      `).all(String(environment), String(nowIso));
    },

    enqueue(reservationId, environment, externalId) {
      database.prepare(`
        INSERT INTO neat_subscriptions (reservationId, environment, externalId)
        VALUES (?, ?, ?)
        ON CONFLICT(reservationId, environment) DO NOTHING
      `).run(Number(reservationId), String(environment), String(externalId));
      return this.getByReservationId(reservationId, environment);
    },

    markActive(id, { neatSubscriptionId, premiumAmount, billedAmount }) {
      database.prepare(`
        UPDATE neat_subscriptions
        SET status = 'active', neatSubscriptionId = ?, premiumAmount = ?, billedAmount = ?,
            lastError = NULL, errorKind = NULL, nextAttemptAt = NULL, updatedAt = datetime('now')
        WHERE id = ?
      `).run(String(neatSubscriptionId), premiumAmount ?? null, billedAmount ?? null, Number(id));
    },

    // A failed attempt keeps the job retryable: status 'failed' + a nextAttemptAt on the ladder.
    markFailedAttempt(id, { error, errorKind, nowMs }) {
      const row = database.prepare('SELECT attempts FROM neat_subscriptions WHERE id = ?').get(Number(id));
      const attempts = (row ? Number(row.attempts) : 0) + 1;
      const nextAttemptAt = new Date(nowMs + retryDelayMs(attempts)).toISOString();
      database.prepare(`
        UPDATE neat_subscriptions
        SET status = 'failed', attempts = ?, nextAttemptAt = ?, lastError = ?, errorKind = ?,
            updatedAt = datetime('now')
        WHERE id = ?
      `).run(attempts, nextAttemptAt, String(error || ''), errorKind || null, Number(id));
      return { attempts, nextAttemptAt };
    },

    markVoided(id) {
      database.prepare(`
        UPDATE neat_subscriptions
        SET status = 'voided', nextAttemptAt = NULL, updatedAt = datetime('now')
        WHERE id = ?
      `).run(Number(id));
    },

    dropPending(id) {
      database.prepare("DELETE FROM neat_subscriptions WHERE id = ? AND status IN ('pending', 'failed')").run(Number(id));
    },

    // Force a job due now (the fiche « Réessayer maintenant » button).
    makeDue(id) {
      database.prepare(`
        UPDATE neat_subscriptions SET nextAttemptAt = NULL, updatedAt = datetime('now')
        WHERE id = ? AND status IN ('pending', 'failed')
      `).run(Number(id));
    },

    touchNotifiedAt(id, iso) {
      database.prepare('UPDATE neat_subscriptions SET lastNotifiedAt = ? WHERE id = ?').run(String(iso), Number(id));
    },

    // « Souscriptions : 2 en attente · 1 en échec » on the Réglages card.
    counters(environment) {
      const rows = database.prepare(
        'SELECT status, COUNT(*) AS n FROM neat_subscriptions WHERE environment = ? GROUP BY status'
      ).all(String(environment));
      const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
      return { pending: by.pending || 0, failed: by.failed || 0, active: by.active || 0, voided: by.voided || 0 };
    },

    // ----- premium cache (utils/neatGuestPricing.js) -----

    getCachedPremium(environment, contractId, fieldsHash) {
      return database.prepare(
        'SELECT premium, fetchedAt FROM neat_price_cache WHERE environment = ? AND contractId = ? AND fieldsHash = ?'
      ).get(String(environment), String(contractId), String(fieldsHash)) || null;
    },

    storePremium(environment, contractId, fieldsHash, premium, fetchedAtIso) {
      database.prepare(`
        INSERT INTO neat_price_cache (environment, contractId, fieldsHash, premium, fetchedAt)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(environment, contractId, fieldsHash)
        DO UPDATE SET premium = excluded.premium, fetchedAt = excluded.fetchedAt
      `).run(String(environment), String(contractId), String(fieldsHash), Number(premium), String(fetchedAtIso));
    },
  };
}

const defaultModel = (() => {
  try {
    return buildModel(require('../database'));
  } catch {
    return null;
  }
})();

if (defaultModel) {
  defaultModel.buildModel = buildModel;
  defaultModel.retryDelayMs = retryDelayMs;
  module.exports = defaultModel;
} else {
  module.exports = { buildModel, retryDelayMs };
}
