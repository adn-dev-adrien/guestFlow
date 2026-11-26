/**
 * What the proof of work remembers (specs/public-request-abuse-and-grouping.md rules 3, 4, 5b): the challenges already spent, and one line per request that passed the proof, kept 24 h,
 * which the per-address difficulty and the flood surcharge count. It is the one memory of every public form — the lodging request, the gift voucher calls, the session confirmation —
 * so a solved challenge is spent once across all of them. The tables are created by the website-booking plugin's migration and, for anyone who gets here first, on first use.
 */

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
`;

const LOG_KEPT_MS = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const ready = new WeakSet();
function database(db) {
  const handle = db || require('../database');
  if (!ready.has(handle)) {
    handle.exec(TABLES_SQL);
    ready.add(handle);
  }
  return handle;
}

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
function countRecent({
  ipKey = null, windowMs = 60 * 60 * 1000, db, now = Date.now(),
} = {}) {
  const d = database(db);
  const since = iso(now - windowMs);
  const row = ipKey === null
    ? d.prepare('SELECT COUNT(*) AS n FROM public_request_log WHERE at >= ?').get(since)
    : d.prepare('SELECT COUNT(*) AS n FROM public_request_log WHERE ipKey = ? AND at >= ?').get(String(ipKey), since);
  return Number(row.n || 0);
}

module.exports = {
  TABLES_SQL, spendChallenge, logRequest, countRecent, ensureTables: database,
};
