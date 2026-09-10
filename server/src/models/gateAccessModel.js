// Guest gate access model (specs/guest-gate-access.md §3, §5). Owns the four gate tables plus the
// one-row runtime, and nothing else: every policy decision — whether the window is open, whether a
// pulse may be asked for — lives in the controllers. This layer answers questions and records facts.

const crypto = require('crypto');
const db = require('../database');
const { generateCode, makeSalt, hashCode, verifyCode, normalizeCode } = require('../utils/gateCode');
const { computeWindow, windowState } = require('../utils/gateWindow');

// SQLite's own `datetime('now')` shape, in UTC: 'YYYY-MM-DD HH:MM:SS'. Written from JS rather than
// from SQL so a test can inject its clock and still match the column defaults.
function toSqlDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// The reverse. Rows written by the column defaults carry no zone, and they are UTC.
function fromSqlDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const iso = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`;
  const date = new Date(iso.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const DEDUP_MS = 10 * 1000;            // §3.5 rule 17 — two presses inside this window are one request
const REQUEST_TIMEOUT_MS = 30 * 1000;  // §3.5 rule 19 — a request nobody claimed is dead
const POLLER_STALE_MS = 60 * 1000;     // §3.5 rule 19 / 19.bis — no heartbeat, no button; stale state is 'unknown'
const CODE_LOCKOUT_FAILURES = 10;      // §3.3 rule 12
const CODE_LOCKOUT_MS = 60 * 60 * 1000;
const OPENS_PER_HOUR_PER_ACCESS = 12;  // §3.8 rule 30
const OPENS_PER_HOUR_PER_GATE = 30;

// The stay a candidate code could belong to. Deliberately coarse: it only has to be a superset of
// the live accesses, the exact verdict comes from computeWindow() in JS.
const CANDIDATE_SQL = `
  SELECT a.*, r.startDate, r.endDate, r.checkInTime, r.checkOutTime, r.cancelledAt,
         r.propertyId, r.clientId
    FROM gate_accesses a
    JOIN reservations r ON r.id = a.reservationId
   WHERE a.revokedAt IS NULL
     AND r.cancelledAt IS NULL
     AND r.kind = 'reservation'
     AND date(r.endDate) >= date(?, '-2 days')
     AND date(r.startDate) <= date(?, '+1 day')
`;

function createGateAccessModel(database, deps = {}) {
  const clock = deps.now || (() => new Date());
  // Seam for the tests only: the collision retry of drawUniqueCode() is unreachable otherwise
  // (32^8 possibilities against a handful of live codes), and an unreachable branch is an untested
  // branch. Production always gets the real draw.
  const drawCode = deps.generateCode || generateCode;

  const readAccessRow = (accessId) => database
    .prepare('SELECT * FROM gate_accesses WHERE id = ?')
    .get(Number(accessId)) || null;

  /**
   * Draws a code no live access already carries (§3.1 rule 2.bis). The candidate set is a handful
   * of rows — one stay per lodging — so the check is a scan, and a scan is the price of the
   * per-row salt: there is no hash to index on, and a database dump cannot be swept with one
   * rainbow table across every stay that ever happened.
   */
  function drawUniqueCode() {
    const now = clock();
    const stamp = toSqlDate(now);
    const candidates = database.prepare(CANDIDATE_SQL).all(stamp, stamp);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = drawCode();
      const clash = candidates.some((row) => verifyCode(code, row));
      if (!clash) return code;
    }
    // 32^8 possibilities against a handful of live codes: reaching here means the draw is broken,
    // and handing out a code that might already be someone else's is not an option.
    throw new Error('gate access: could not draw a code distinct from the live ones');
  }

  const model = {
    POLLER_STALE_MS,
    DEDUP_MS,
    REQUEST_TIMEOUT_MS,
    OPENS_PER_HOUR_PER_ACCESS,
    OPENS_PER_HOUR_PER_GATE,

    // ---------- the access ----------

    getByReservation(reservationId) {
      return database
        .prepare('SELECT * FROM gate_accesses WHERE reservationId = ?')
        .get(Number(reservationId)) || null;
    },

    /**
     * The access of a reservation, created on first need (§3.1 rule 1). A cancelled reservation —
     * or a devis — never gets one; the caller gets null and shows nothing.
     */
    ensureForReservation(reservationId) {
      const id = Number(reservationId);
      const existing = model.getByReservation(id);
      if (existing) return existing;

      const reservation = database
        .prepare('SELECT id, cancelledAt, kind FROM reservations WHERE id = ?')
        .get(id);
      if (!reservation || reservation.cancelledAt || reservation.kind !== 'reservation') return null;

      const code = drawUniqueCode();
      const codeSalt = makeSalt();
      try {
        database.prepare(`
          INSERT INTO gate_accesses (reservationId, code, codeHash, codeSalt, createdAt)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, code, hashCode(code, codeSalt), codeSalt, toSqlDate(clock()));
      } catch {
        // UNIQUE(reservationId) — two callers raced (the SAS read and the email pass, say).
        // Whoever lost simply uses the row that won.
        return model.getByReservation(id);
      }
      model.appendEvent({ accessId: model.getByReservation(id).id, kind: 'created' });
      return model.getByReservation(id);
    },

    /**
     * Resolves a typed code to `{ access, reservation, state }`, or null when nothing live matches.
     * Only non-revoked accesses of non-cancelled stays are candidates, so a code that expired at
     * the end of a stay is indistinguishable from one that never existed.
     */
    findByCode(input, { now = clock() } = {}) {
      if (!normalizeCode(input)) return null;
      const stamp = toSqlDate(now);
      const rows = database.prepare(CANDIDATE_SQL).all(stamp, stamp);
      for (const row of rows) {
        if (!verifyCode(input, row)) continue;
        // The same shape resolve() returns, deliberately: the payload builder reads propertyId and
        // clientId to name the lodging and greet the guest, and a partial row here made the page go
        // anonymous on the unlock but not on a reload — the kind of split behaviour nobody notices
        // until a guest sees « Bonjour » with no name.
        const reservation = {
          id: row.reservationId,
          startDate: row.startDate,
          endDate: row.endDate,
          checkInTime: row.checkInTime,
          checkOutTime: row.checkOutTime,
          propertyId: row.propertyId,
          clientId: row.clientId,
        };
        return {
          access: readAccessRow(row.id),
          reservation,
          state: windowState(reservation, { now, earlyOpenedAt: row.earlyOpenedAt }),
          window: computeWindow(reservation, { earlyOpenedAt: row.earlyOpenedAt }),
        };
      }
      return null;
    },

    /** The window of an access, recomputed from the live reservation (§3.2 rule 7). */
    resolve(accessId, { now = clock() } = {}) {
      const access = readAccessRow(accessId);
      if (!access) return null;
      const reservation = database.prepare(`
        SELECT id, startDate, endDate, checkInTime, checkOutTime, cancelledAt, propertyId, clientId
          FROM reservations WHERE id = ?
      `).get(access.reservationId);
      if (!reservation) return null;
      return {
        access,
        reservation,
        state: access.revokedAt || reservation.cancelledAt
          ? 'revoked'
          : windowState(reservation, { now, earlyOpenedAt: access.earlyOpenedAt }),
        window: computeWindow(reservation, { earlyOpenedAt: access.earlyOpenedAt }),
      };
    },

    isLockedOut(accessId, { now = clock() } = {}) {
      const access = readAccessRow(accessId);
      if (!access || !access.lockedUntil) return false;
      const until = fromSqlDate(access.lockedUntil);
      return !!until && until.getTime() > now.getTime();
    },

    /** A failed attempt on a KNOWN code. Ten of them lock that code for an hour (§3.3 rule 12). */
    noteCodeFailure(accessId, { now = clock() } = {}) {
      const access = readAccessRow(accessId);
      if (!access) return null;
      const failedCount = access.failedCount + 1;
      const lockedUntil = failedCount >= CODE_LOCKOUT_FAILURES
        ? toSqlDate(new Date(now.getTime() + CODE_LOCKOUT_MS))
        : access.lockedUntil;
      database
        .prepare('UPDATE gate_accesses SET failedCount = ?, lockedUntil = ? WHERE id = ?')
        .run(failedCount, lockedUntil, access.id);
      return readAccessRow(access.id);
    },

    clearCodeFailures(accessId) {
      database
        .prepare('UPDATE gate_accesses SET failedCount = 0, lockedUntil = NULL WHERE id = ?')
        .run(Number(accessId));
    },

    revoke(accessId, { now = clock() } = {}) {
      database
        .prepare('UPDATE gate_accesses SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL')
        .run(toSqlDate(now), Number(accessId));
      model.appendEvent({ accessId: Number(accessId), kind: 'revoked' });
      return readAccessRow(accessId);
    },

    /**
     * A new code, and every device forgotten (§3.1 rule 5). The old code is gone the instant this
     * returns: every link already sent stops working, which is the whole point of the button.
     */
    regenerate(accessId, { now = clock() } = {}) {
      const access = readAccessRow(accessId);
      if (!access) return null;
      const code = drawUniqueCode();
      const codeSalt = makeSalt();
      database.transaction(() => {
        database.prepare(`
          UPDATE gate_accesses
             SET code = ?, codeHash = ?, codeSalt = ?, failedCount = 0, lockedUntil = NULL,
                 revokedAt = NULL
           WHERE id = ?
        `).run(code, hashCode(code, codeSalt), codeSalt, access.id);
        database.prepare('DELETE FROM gate_devices WHERE accessId = ?').run(access.id);
      })();
      model.appendEvent({ accessId: access.id, kind: 'regenerated' });
      return readAccessRow(access.id);
    },

    /** The arrival SAS opening the access for a guest who turned up early (§3.6 rule 20). */
    markEarlyOpen(accessId, { now = clock() } = {}) {
      database
        .prepare('UPDATE gate_accesses SET earlyOpenedAt = ? WHERE id = ? AND earlyOpenedAt IS NULL')
        .run(toSqlDate(now), Number(accessId));
      model.appendEvent({ accessId: Number(accessId), kind: 'early_open' });
      return readAccessRow(accessId);
    },

    // ---------- devices ----------

    newDeviceId() {
      return crypto.randomBytes(16).toString('hex');
    },

    /**
     * Records a device and answers how many this access now has. No cap, on purpose (§3.4 rule 15):
     * a cap would lock a legitimate brother-in-law out at 23 h. The count is what triggers the
     * owner's notification, not a refusal.
     */
    touchDevice(accessId, deviceId, { ip = null, userAgent = null, now = clock() } = {}) {
      if (!deviceId) return { deviceCount: model.countDevices(accessId), isNew: false };
      const stamp = toSqlDate(now);
      const before = database
        .prepare('SELECT id FROM gate_devices WHERE accessId = ? AND deviceId = ?')
        .get(Number(accessId), String(deviceId));
      database.prepare(`
        INSERT INTO gate_devices (accessId, deviceId, firstSeenAt, lastSeenAt, ip, userAgent)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(accessId, deviceId) DO UPDATE SET
          lastSeenAt = excluded.lastSeenAt,
          ip = excluded.ip,
          userAgent = excluded.userAgent
      `).run(Number(accessId), String(deviceId), stamp, stamp, ip, userAgent);
      return { deviceCount: model.countDevices(accessId), isNew: !before };
    },

    countDevices(accessId) {
      return database
        .prepare('SELECT COUNT(*) AS n FROM gate_devices WHERE accessId = ?')
        .get(Number(accessId)).n;
    },

    listDevices(accessId) {
      return database.prepare(`
        SELECT * FROM gate_devices WHERE accessId = ? ORDER BY firstSeenAt ASC
      `).all(Number(accessId));
    },

    // ---------- journal ----------

    appendEvent({ accessId = null, kind, reason = null, ip = null, userAgent = null, deviceId = null } = {}) {
      if (!kind) return null;
      const info = database.prepare(`
        INSERT INTO gate_events (accessId, kind, reason, ip, userAgent, deviceId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(accessId == null ? null : Number(accessId), String(kind), reason, ip, userAgent, deviceId, toSqlDate(clock()));
      return info.lastInsertRowid;
    },

    listEvents(accessId, { limit = 50 } = {}) {
      return database.prepare(`
        SELECT * FROM gate_events WHERE accessId = ? ORDER BY createdAt DESC, id DESC LIMIT ?
      `).all(Number(accessId), Number(limit));
    },

    // ---------- requests ----------

    /**
     * Creates an open request, or hands back the one that is already in flight (§3.5 rule 17).
     * Deduplication is not a nicety: two pulses on a sequential gate mean open then close, and the
     * second one closes it on the car going through (§3.8 rule 28).
     */
    createRequest({ accessId, deviceId = null, now = clock() } = {}) {
      const latest = database.prepare(`
        SELECT * FROM gate_requests WHERE accessId = ? ORDER BY id DESC LIMIT 1
      `).get(Number(accessId));

      if (latest) {
        if (latest.status === 'pending') return { request: latest, deduped: true };
        const resolvedAt = fromSqlDate(latest.resolvedAt);
        const fresh = resolvedAt && (now.getTime() - resolvedAt.getTime()) < DEDUP_MS;
        if (fresh && (latest.status === 'opened' || latest.status === 'already_open')) {
          return { request: latest, deduped: true };
        }
      }

      const info = database.prepare(`
        INSERT INTO gate_requests (accessId, deviceId, status, requestedAt)
        VALUES (?, ?, 'pending', ?)
      `).run(Number(accessId), deviceId, toSqlDate(now));
      return { request: model.getRequest(info.lastInsertRowid), deduped: false };
    },

    getRequest(requestId) {
      return database
        .prepare('SELECT * FROM gate_requests WHERE id = ?')
        .get(Number(requestId)) || null;
    },

    /**
     * The oldest unclaimed request, stamped as claimed (§3.8 rule 29). One at a time and in order:
     * two guests pressing in the same second produce one pulse and two honest answers.
     */
    claimNextRequest({ now = clock() } = {}) {
      const claim = database.transaction(() => {
        const next = database.prepare(`
          SELECT * FROM gate_requests
           WHERE status = 'pending' AND claimedAt IS NULL
           ORDER BY id ASC LIMIT 1
        `).get();
        if (!next) return null;
        database
          .prepare('UPDATE gate_requests SET claimedAt = ? WHERE id = ?')
          .run(toSqlDate(now), next.id);
        return model.getRequest(next.id);
      });
      return claim();
    },

    /** Idempotent: a second call on a resolved request changes nothing and says so. */
    resolveRequest(requestId, status, { detail = null, now = clock() } = {}) {
      const request = model.getRequest(requestId);
      if (!request) return { request: null, changed: false };
      if (request.status !== 'pending') return { request, changed: false };
      database.prepare(`
        UPDATE gate_requests SET status = ?, detail = ?, resolvedAt = ? WHERE id = ? AND status = 'pending'
      `).run(String(status), detail, toSqlDate(now), request.id);
      return { request: model.getRequest(request.id), changed: true };
    },

    /** Requests nobody ever answered. Called by the scheduler and before every read of a status. */
    expireStaleRequests({ now = clock(), maxAgeMs = REQUEST_TIMEOUT_MS } = {}) {
      const cutoff = toSqlDate(new Date(now.getTime() - maxAgeMs));
      const info = database.prepare(`
        UPDATE gate_requests
           SET status = 'timeout', resolvedAt = ?, detail = COALESCE(detail, 'no answer from the house')
         WHERE status = 'pending' AND requestedAt <= ?
      `).run(toSqlDate(now), cutoff);
      return info.changes;
    },

    countOpensSince(accessId, { now = clock(), windowMs = 60 * 60 * 1000 } = {}) {
      const since = toSqlDate(new Date(now.getTime() - windowMs));
      return database.prepare(`
        SELECT COUNT(*) AS n FROM gate_requests
         WHERE accessId = ? AND requestedAt >= ? AND status IN ('pending', 'opened', 'already_open')
      `).get(Number(accessId), since).n;
    },

    countGateOpensSince({ now = clock(), windowMs = 60 * 60 * 1000 } = {}) {
      const since = toSqlDate(new Date(now.getTime() - windowMs));
      return database.prepare(`
        SELECT COUNT(*) AS n FROM gate_requests
         WHERE requestedAt >= ? AND status IN ('pending', 'opened', 'already_open')
      `).get(since).n;
    },

    // ---------- what the house last told us (§3.5 rule 19.bis) ----------

    noteHeartbeat({ state = 'unknown', now = clock() } = {}) {
      const clean = ['open', 'closed', 'unknown'].includes(state) ? state : 'unknown';
      const stamp = toSqlDate(now);
      database.prepare(`
        UPDATE gate_runtime SET gateState = ?, gateStateAt = ?, pollerSeenAt = ? WHERE id = 1
      `).run(clean, stamp, stamp);
      return model.readRuntime({ now });
    },

    /**
     * The advisory view of the gate. A state older than a minute reads 'unknown', never 'closed' —
     * a stale 'closed' would let the page invite a press that the recipe then refuses, and a stale
     * 'open' would hide the button for nothing.
     */
    readRuntime({ now = clock() } = {}) {
      const row = database.prepare('SELECT * FROM gate_runtime WHERE id = 1').get()
        || { gateState: 'unknown', gateStateAt: null, pollerSeenAt: null };
      const seenAt = fromSqlDate(row.pollerSeenAt);
      const stateAt = fromSqlDate(row.gateStateAt);
      const available = !!seenAt && (now.getTime() - seenAt.getTime()) <= POLLER_STALE_MS;
      const stateFresh = !!stateAt && (now.getTime() - stateAt.getTime()) <= POLLER_STALE_MS;
      return {
        gateState: stateFresh ? row.gateState : 'unknown',
        gateStateAt: stateAt,
        pollerSeenAt: seenAt,
        available,
      };
    },

    // ---------- housekeeping (§3.7 rule 24) ----------

    purge({ now = clock() } = {}) {
      const clearCodesBefore = toSqlDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
      const dropRequestsBefore = toSqlDate(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
      const dropEventsBefore = toSqlDate(new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000));

      const codes = database.prepare(`
        UPDATE gate_accesses SET code = NULL
         WHERE code IS NOT NULL
           AND reservationId IN (SELECT id FROM reservations WHERE datetime(endDate) <= datetime(?))
      `).run(clearCodesBefore).changes;
      const requests = database
        .prepare('DELETE FROM gate_requests WHERE requestedAt <= ?')
        .run(dropRequestsBefore).changes;
      const events = database
        .prepare('DELETE FROM gate_events WHERE createdAt <= ?')
        .run(dropEventsBefore).changes;
      return { codes, requests, events };
    },
  };

  return model;
}

const defaultModel = createGateAccessModel(db);
defaultModel.create = createGateAccessModel;
defaultModel.__test = { toSqlDate, fromSqlDate };

module.exports = defaultModel;
