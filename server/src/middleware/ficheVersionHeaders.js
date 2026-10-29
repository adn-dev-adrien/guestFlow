/**
 * Tells the fiche which writes are its own (specs/reservation-fiche-concurrency.md rule 4).
 *
 * On every write to `/api/reservations/:id/...` the response carries the stay's `updatedAt` as it was
 * before the handler ran and as it is when the answer leaves. The open fiche adopts the new version only
 * when the « before » is the version it holds: a foreign write that landed in between breaks the chain and
 * the next save is still refused as stale.
 */
const db = require('../database');

const BEFORE = 'X-Fiche-Version-Before';
const AFTER = 'X-Fiche-Version-After';

function versionOf(database, id) {
  const row = database.prepare('SELECT updatedAt FROM reservations WHERE id = ?').get(id);
  return row ? String(row.updatedAt || '') : null;
}

function ficheVersionHeaders(database = db) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return next();
    const before = versionOf(database, id);
    if (before === null) return next();
    const json = res.json.bind(res);
    res.json = (body) => {
      if (!res.headersSent) {
        res.set(BEFORE, before);
        const after = versionOf(database, id);
        if (after !== null) res.set(AFTER, after);
      }
      return json(body);
    };
    return next();
  };
}

module.exports = { ficheVersionHeaders, BEFORE, AFTER };
