/**
 * The plugin's own memory of the website requests (specs/public-request-abuse-and-grouping.md §5):
 *
 * - `public_request_challenges_used` — a solved challenge is spent once (rule 3), remembered until it
 *   expires;
 * - `public_request_log` — one line per request that passed the proof, with the visitor's address key,
 *   kept 24 h: the per-address difficulty (rule 4), the flood surcharge (rule 5b) and the home's
 *   « trafic inhabituel » line (rule 11) count it;
 * - `public_request_issued` — created by the v2 migration for rule 23 and dropped by v3: since rule
 *   29 a challenge handed out costs nothing, only a request made does;
 * - `public_request_stays` — per site devis, the fingerprint of the last request that wrote it (a
 *   double click finds the same stay unchanged, edge case of rule 13), the client created for it,
 *   which the purge may delete with it (rule 10), and how many messages were appended (rule 22).
 *
 * The tables are created by the plugin's migration and, for suites that load the controllers without
 * the plugin loader, on first use.
 */

const sdk = require('../sdk');

const TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS public_request_challenges_used (
    challengeId TEXT PRIMARY KEY,
    expiresAt   TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS public_request_log (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    at    TEXT NOT NULL,
    ipKey TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_public_request_log_at ON public_request_log (at);
  CREATE INDEX IF NOT EXISTS idx_public_request_log_ip ON public_request_log (ipKey, at);
  CREATE TABLE IF NOT EXISTS public_request_stays (
    reservationId   INTEGER PRIMARY KEY,
    fingerprint     TEXT NOT NULL,
    createdClientId INTEGER
  );
`;

// Review of PR #805: the issued challenges (rule 23) and the appended-message count (rule 22).
const TABLES_V2_SQL = `
  CREATE TABLE IF NOT EXISTS public_request_issued (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    at    TEXT NOT NULL,
    ipKey TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_public_request_issued_ip ON public_request_issued (ipKey, at);
`;

function migrateV2(db) {
  db.exec(TABLES_SQL);
  db.exec(TABLES_V2_SQL);
  const cols = db.prepare('PRAGMA table_info(public_request_stays)').all().map((c) => c.name);
  if (!cols.includes('appendCount')) db.exec('ALTER TABLE public_request_stays ADD COLUMN appendCount INTEGER NOT NULL DEFAULT 0');
  // When the guest last wrote this quote, `YYYY-MM-DD HH:MM:SS` UTC like `reservations.createdAt`: the
  // 30 days of the purge run from it (rule 10, review of PR #805).
  if (!cols.includes('lastRequestAt')) db.exec('ALTER TABLE public_request_stays ADD COLUMN lastRequestAt TEXT');
}

// Rule 29 (2026-10-27 spec review) — the issued challenges no longer count: their table goes.
function migrateV3(db) {
  db.exec('DROP TABLE IF EXISTS public_request_issued');
}

const TABLES = ['public_request_challenges_used', 'public_request_log', 'public_request_stays'];
const LOG_KEPT_MS = 24 * 60 * 60 * 1000;

const ready = new WeakSet();
function database(db) {
  const handle = db || sdk.coreModule('database');
  if (!ready.has(handle)) {
    migrateV2(handle);
    migrateV3(handle);
    ready.add(handle);
  }
  return handle;
}

const iso = (ms) => new Date(ms).toISOString();

/** True the first time `challengeId` is spent, false when it already was (rule 3). */
function spendChallenge(challengeId, expiresAt, { db, now = Date.now() } = {}) {
  const d = database(db);
  d.prepare('DELETE FROM public_request_challenges_used WHERE expiresAt < ?').run(iso(now));
  const info = d.prepare('INSERT OR IGNORE INTO public_request_challenges_used (challengeId, expiresAt) VALUES (?, ?)')
    .run(String(challengeId), String(expiresAt));
  return info.changes === 1;
}

function logRequest(ipKey, { db, now = Date.now() } = {}) {
  const d = database(db);
  d.prepare('DELETE FROM public_request_log WHERE at < ?').run(iso(now - LOG_KEPT_MS));
  d.prepare('INSERT INTO public_request_log (at, ipKey) VALUES (?, ?)').run(iso(now), String(ipKey || ''));
}

/** Requests of the last `windowMs`, all addresses or one. */
function countRecent({ ipKey = null, windowMs = 60 * 60 * 1000, db, now = Date.now() } = {}) {
  const d = database(db);
  const since = iso(now - windowMs);
  const row = ipKey === null
    ? d.prepare('SELECT COUNT(*) AS n FROM public_request_log WHERE at >= ?').get(since)
    : d.prepare('SELECT COUNT(*) AS n FROM public_request_log WHERE ipKey = ? AND at >= ?').get(String(ipKey), since);
  return Number(row.n || 0);
}

function getStay(reservationId, { db } = {}) {
  return database(db).prepare('SELECT * FROM public_request_stays WHERE reservationId = ?').get(Number(reservationId)) || null;
}

/**
 * The fingerprint of the request that just wrote the devis; the created client is kept once set;
 * `appended` counts one more message appended to its notes (rule 22).
 */
function recordStay(reservationId, fingerprint, { createdClientId = null, appended = false, db, now = Date.now() } = {}) {
  const at = new Date(now).toISOString().slice(0, 19).replace('T', ' ');
  database(db).prepare(`
    INSERT INTO public_request_stays (reservationId, fingerprint, createdClientId, appendCount, lastRequestAt) VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(reservationId) DO UPDATE SET fingerprint = excluded.fingerprint,
      appendCount = appendCount + ?, lastRequestAt = excluded.lastRequestAt
  `).run(Number(reservationId), String(fingerprint), createdClientId == null ? null : Number(createdClientId), at, appended ? 1 : 0);
}

module.exports = {
  TABLES_SQL, TABLES, migrateV2, migrateV3, ensureTables: (db) => database(db),
  spendChallenge, logRequest, countRecent, getStay, recordStay,
};
