/**
 * Tells the open fiche which stays a write moved, for the writes that reach a stay from outside
 * `/api/reservations/:id` — a bank reconciliation, a payment poll (specs/reservation-fiche-concurrency.md
 * rule 8).
 *
 * The answer carries `X-Stay-Versions`: a JSON list of `{ id, before, after }`, one per stay THIS request
 * wrote (recorded where `reservations.updatedAt` changes, see `utils/stayWriteTrail`). A foreign write that
 * lands while the handler awaits the network is not in it. The fiche adopts `after` only when `before` is the
 * version it holds (same chain as rule 4).
 */
const db = require('../database');
const { install, collect } = require('../utils/stayWriteTrail');

const HEADER = 'X-Stay-Versions';
const MAX_STAYS = 50;

function stayVersionsTrail(database = db) {
  install(database);
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    collect((store) => {
      const json = res.json.bind(res);
      res.json = (body) => {
        if (!res.headersSent) {
          const moved = [...store.moved.values()].filter((s) => !s.broken && s.before !== s.after).map(({ id, before, after }) => ({ id, before, after }));
          if (moved.length > 0 && moved.length <= MAX_STAYS) res.set(HEADER, JSON.stringify(moved));
        }
        return json(body);
      };
      next();
    });
    return undefined;
  };
}

module.exports = { stayVersionsTrail, HEADER };
