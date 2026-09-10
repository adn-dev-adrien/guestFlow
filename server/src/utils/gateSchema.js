// Guest gate access — the DDL (specs/guest-gate-access.md §5). One access per reservation: the code the
// guest types, the devices it was opened on, the open requests Sowel comes to fetch, and the
// journal. Additive and idempotent — no existing table or column is touched.
//
// Two deliberate shapes:
//   - `gate_accesses.code` holds the CLEAR code beside its salted hash. Verification always goes
//     through the hash (utils/gateCode.js); the clear column exists so the operator can re-read
//     the code to dictate it, and the purge nulls it 7 days after the stay (§3.7 rule 24).
//   - `gate_events` carries NO foreign key. The journal is the only thing that answers "who came
//     in that night", so it must outlive the access — including a reservation deleted by mistake.
//
// It lives in its own module, and not inline in database.js like its neighbours, for one
// reason: the unit tests build these same five tables in an in-memory database. Any other
// arrangement means two copies of the DDL, and two copies drift — the test suite would keep
// passing against a shape production no longer has.

const GATE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS gate_accesses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL UNIQUE,
    code          TEXT,
    codeHash      TEXT NOT NULL,
    codeSalt      TEXT NOT NULL,
    earlyOpenedAt TEXT,
    revokedAt     TEXT,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
    lockedUntil   TEXT,
    failedCount   INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_gate_accesses_hash ON gate_accesses(codeHash);

  CREATE TABLE IF NOT EXISTS gate_devices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    accessId    INTEGER NOT NULL,
    deviceId    TEXT NOT NULL,
    firstSeenAt TEXT NOT NULL DEFAULT (datetime('now')),
    lastSeenAt  TEXT,
    ip          TEXT,
    userAgent   TEXT,
    UNIQUE (accessId, deviceId),
    FOREIGN KEY (accessId) REFERENCES gate_accesses(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS gate_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    accessId    INTEGER NOT NULL,
    deviceId    TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    detail      TEXT,
    requestedAt TEXT NOT NULL DEFAULT (datetime('now')),
    claimedAt   TEXT,
    resolvedAt  TEXT,
    CHECK (status IN ('pending', 'opened', 'already_open', 'refused', 'error', 'timeout')),
    FOREIGN KEY (accessId) REFERENCES gate_accesses(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_gate_requests_status ON gate_requests(status, requestedAt);
  CREATE INDEX IF NOT EXISTS idx_gate_requests_access ON gate_requests(accessId, requestedAt);

  CREATE TABLE IF NOT EXISTS gate_events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    accessId  INTEGER,
    kind      TEXT NOT NULL,
    reason    TEXT,
    ip        TEXT,
    userAgent TEXT,
    deviceId  TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_gate_events_access ON gate_events(accessId, createdAt);

  CREATE TABLE IF NOT EXISTS gate_runtime (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    gateState    TEXT NOT NULL DEFAULT 'unknown',
    gateStateAt  TEXT,
    pollerSeenAt TEXT,
    CHECK (gateState IN ('open', 'closed', 'unknown'))
  );
  INSERT OR IGNORE INTO gate_runtime (id) VALUES (1);
`;

module.exports = { GATE_SCHEMA_SQL };
