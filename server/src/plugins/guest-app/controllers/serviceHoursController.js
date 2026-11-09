/**
 * `GET/PUT /api/guest-app/service-hours[?propertyId=]` — the service hours (specs/guest-app.md rule 40): the
 * shared ones, or one lodging's own. Admin only: the guard refuses every role but admin on a path no role has
 * listed. The boundary validates everything; French messages reach the operator as they are.
 */

const sdk = require('../../sdk');

const { entryDateMessage } = sdk.coreModule('stayDates');

const MAX_RANGES = 3;
const MAX_EXCEPTIONS = 366;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAY_KEYS = Object.freeze(['0', '1', '2', '3', '4', '5', '6']);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** → an error message or null: at most three ranges, `HH:MM`, each starting before it ends, none overlapping. */
function rangesError(ranges, where) {
  if (!Array.isArray(ranges)) return `Les horaires ${where} sont une liste de plages.`;
  if (ranges.length > MAX_RANGES) return `${MAX_RANGES} plages au plus ${where}.`;
  for (const range of ranges) {
    if (!isPlainObject(range) || Object.keys(range).some((k) => k !== 'from' && k !== 'to')) return `Une plage ${where} est invalide.`;
    if (typeof range.from !== 'string' || typeof range.to !== 'string' || !TIME.test(range.from) || !TIME.test(range.to)) {
      return `Une heure ${where} s’écrit HH:MM.`;
    }
    if (range.from >= range.to) return `Une plage ${where} commence avant de finir.`;
  }
  const sorted = ranges.slice().sort((a, b) => a.from.localeCompare(b.from));
  if (sorted.some((r, i) => i > 0 && r.from < sorted[i - 1].to)) return `Deux plages ${where} se chevauchent.`;
  return null;
}

const WEEKDAY_NAMES = Object.freeze(['le dimanche', 'le lundi', 'le mardi', 'le mercredi', 'le jeudi', 'le vendredi', 'le samedi']);

/** → an error message or null. `storedDates` are the exception dates already saved, never judged again. */
function serviceHoursInputError(body, storedDates = new Set()) {
  if (!isPlainObject(body) || Object.keys(body).some((k) => k !== 'weekly' && k !== 'exceptions')) return 'Requête invalide.';
  if (!isPlainObject(body.weekly) || Object.keys(body.weekly).some((k) => !WEEKDAY_KEYS.includes(k))) {
    return 'Les horaires de la semaine sont donnés par jour, de 0 (dimanche) à 6 (samedi).';
  }
  for (const [weekday, ranges] of Object.entries(body.weekly)) {
    const error = rangesError(ranges, WEEKDAY_NAMES[Number(weekday)]);
    if (error) return error;
  }
  if (!Array.isArray(body.exceptions)) return 'Les exceptions sont une liste de dates.';
  if (body.exceptions.length > MAX_EXCEPTIONS) return `${MAX_EXCEPTIONS} exceptions au plus.`;
  const seen = new Set();
  for (const exception of body.exceptions) {
    if (!isPlainObject(exception) || Object.keys(exception).some((k) => !['date', 'closed', 'ranges'].includes(k))) return 'Une exception est invalide.';
    const dateError = storedDates.has(exception.date) ? null : entryDateMessage(exception.date);
    if (dateError) return `Exception : ${dateError}`;
    if (seen.has(exception.date)) return `La date ${exception.date} a deux exceptions.`;
    seen.add(exception.date);
    if (exception.closed !== undefined && typeof exception.closed !== 'boolean') return 'Indiquez si le service est fermé ce jour-là.';
    if (exception.closed === true && exception.ranges !== undefined) return `Le ${exception.date} est fermé ou a ses horaires, pas les deux.`;
    if (exception.closed !== true) {
      if (exception.ranges === undefined) return `Le ${exception.date} est fermé ou a ses horaires.`;
      const error = rangesError(exception.ranges, `du ${exception.date}`);
      if (error) return error;
    }
  }
  return null;
}

/** The stored shape: every weekday present, the exceptions closed or with their ranges in time order. */
function toConfig(body) {
  const byStart = (ranges) => ranges.slice().sort((a, b) => a.from.localeCompare(b.from)).map(({ from, to }) => ({ from, to }));
  return {
    weekly: Object.fromEntries(WEEKDAY_KEYS.map((d) => [d, byStart(body.weekly[d] || [])])),
    exceptions: body.exceptions.map((e) => (e.closed === true ? { date: e.date, closed: true } : { date: e.date, closed: false, ranges: byStart(e.ranges) })),
  };
}

function buildServiceHoursController({ serviceHours }) {
  /** → `{ propertyId }` (null for the shared hours), or the 400 / 404 to answer. */
  function scope(req) {
    const raw = req.query.propertyId;
    if (raw === undefined) return { propertyId: null };
    const id = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(id) || id <= 0) return { status: 400, error: 'Identifiant de logement invalide' };
    if (!serviceHours().propertyExists(id)) return { status: 404, error: 'Logement introuvable' };
    return { propertyId: id };
  }

  function read(req, res) {
    const at = scope(req);
    if (at.error) return res.status(at.status).json({ error: at.error });
    return res.json(serviceHours().read(at.propertyId));
  }

  function write(req, res) {
    const at = scope(req);
    if (at.error) return res.status(at.status).json({ error: at.error });
    const error = serviceHoursInputError(req.body, serviceHours().storedExceptionDates(at.propertyId));
    if (error) return res.status(400).json({ error });
    return res.json(serviceHours().save(at.propertyId, toConfig(req.body)));
  }

  return { read, write };
}

module.exports = { buildServiceHoursController };
