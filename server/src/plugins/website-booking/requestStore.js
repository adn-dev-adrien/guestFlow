/**
 * The plugin's own memory of the website requests (specs/public-request-abuse-and-grouping.md §5):
 *
 * - `public_request_challenges_used` — a solved challenge is spent once (rule 3), remembered until it
 *   expires;
 * - `public_request_log` — one line per request that passed the proof, with the visitor's address key,
 *   kept 24 h: the per-address difficulty (rule 4), the flood surcharge (rule 5b) and the home's
 *   « trafic inhabituel » line (rule 11) count it;
 * - `public_request_stays` — per site devis, the fingerprint of the last request that wrote it (a
 *   double click finds the same stay unchanged, edge case of rule 13) and the client created for it,
 *   which the purge may delete with it (rule 10).
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

const TABLES = ['public_request_challenges_used', 'public_request_log', 'public_request_stays'];
const LOG_KEPT_MS = 24 * 60 * 60 * 1000;

const ready = new WeakSet();
function database(db) {
  const handle = db || sdk.coreModule('database');
  if (!ready.has(handle)) {
    handle.exec(TABLES_SQL);
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

/** The fingerprint of the request that just wrote the devis; the created client is kept once set. */
function recordStay(reservationId, fingerprint, { createdClientId = null, db } = {}) {
  database(db).prepare(`
    INSERT INTO public_request_stays (reservationId, fingerprint, createdClientId) VALUES (?, ?, ?)
    ON CONFLICT(reservationId) DO UPDATE SET fingerprint = excluded.fingerprint
  `).run(Number(reservationId), String(fingerprint), createdClientId == null ? null : Number(createdClientId));
}

module.exports = { TABLES_SQL, TABLES, ensureTables: (db) => database(db), spendChallenge, logRequest, countRecent, getStay, recordStay };
