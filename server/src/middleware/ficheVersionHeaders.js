/**
 * Tells the fiche which writes are its own (specs/reservation-fiche-concurrency.md rule 4).
 *
 * On every write to `/api/reservations/:id/...` the response carries the stay's `updatedAt` as it was
 * before THIS request's first write to the stay and as it is after its last one (recorded where
 * `reservations.updatedAt` changes, see `utils/stayWriteTrail`), never a snapshot around the handler: a
 * foreign write that lands while the handler awaits the payment provider is not adopted (rule 10). The open
 * fiche adopts the new version only when the « before » is the version it holds. A request that did not write
 * the stay, or whose chain a foreign write broke, carries no header and the fiche keeps its version.
 */
const db = require('../database');
const { install, collect } = require('../utils/stayWriteTrail');

const BEFORE = 'X-Fiche-Version-Before';
const AFTER = 'X-Fiche-Version-After';

function ficheVersionHeaders(database = db) {
  install(database);
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return next();
    collect((store) => {
      const json = res.json.bind(res);
      res.json = (body) => {
        const own = store.moved.get(id);
        if (!res.headersSent && own && !own.broken && own.before !== own.after) {
          res.set(BEFORE, own.before);
          res.set(AFTER, own.after);
        }
        return json(body);
      };
      next();
    });
    return undefined;
  };
}

module.exports = { ficheVersionHeaders, BEFORE, AFTER };
