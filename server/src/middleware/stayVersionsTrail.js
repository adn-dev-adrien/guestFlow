/**
 * Tells the open fiche which stays a write moved, for the writes that reach a stay from outside
 * `/api/reservations/:id` — a bank reconciliation, a payment poll (specs/reservation-fiche-concurrency.md
 * rule 6).
 *
 * The answer carries `X-Stay-Versions`: a JSON list of `{ id, before, after }`, one per stay whose
 * `updatedAt` changed between the start of the request and the answer. The fiche adopts `after` only when
 * `before` is the version it holds (same chain as rule 4), so a foreign write is still detected.
 */
const db = require('../database');

const HEADER = 'X-Stay-Versions';
const MAX_STAYS = 50;

function snapshot(database) {
  const versions = new Map();
  database.prepare('SELECT id, updatedAt FROM reservations').all()
    .forEach((row) => versions.set(row.id, String(row.updatedAt || '')));
  return versions;
}

function stayVersionsTrail(database = db) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const before = snapshot(database);
    const json = res.json.bind(res);
    res.json = (body) => {
      if (!res.headersSent) {
        const moved = [];
        snapshot(database).forEach((after, id) => {
          if (before.has(id) && before.get(id) !== after) moved.push({ id, before: before.get(id), after });
        });
        if (moved.length > 0 && moved.length <= MAX_STAYS) res.set(HEADER, JSON.stringify(moved));
      }
      return json(body);
    };
    return next();
  };
}

module.exports = { stayVersionsTrail, HEADER };
