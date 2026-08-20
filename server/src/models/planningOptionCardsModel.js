/**
 * Option-driven planning cards model — per-day cards for the Planning page.
 * Spec: specs/option-planning-card.md §3.3 + §4.1.
 *
 * Returns a `{ 'YYYY-MM-DD': { items: [{ reservationId, optionId, title, clientName,
 * propertyName, date, time }] } }` map for the requested `[from, to]` window.
 *
 * A card-option (`options.showsPlanningCard = 1`) carrying its per-reservation SELECTED
 * occurrences (`reservation_options.cardOccurrences`, a JSON array of `{ date, time }`)
 * produces one card per stored occurrence whose `date` ∈ `[from, to]`. The occurrences are
 * already materialised on the reservation (the fiche is the source of truth, §3.2) — there is
 * NO server-side expansion here; we simply filter the stored list by the window.
 *
 * Only `kind = 'reservation'` rows are considered (devis excluded, §3.3). Mirrors the factory
 * pattern of `breakfastModel.js`.
 */

const { formatTimeShort } = require('../utils/dateFr');

function buildModel(database) {
  // Card-options on real reservations, with their stored occurrences. Guarded by the column's
  // existence so a minimal test schema without `cardOccurrences` / `showsPlanningCard` degrades
  // to "no cards" rather than throwing.
  // Breakfast (autoOptionType='breakfast') has its OWN dedicated planning card (breakfastModel) driven
  // by the same cardOccurrences — exclude it here so it never gets a second, generic card (§5).
  const hasAutoOptionType = (() => {
    try { return database.prepare('PRAGMA table_info(options)').all().some((c) => c.name === 'autoOptionType'); }
    catch { return false; }
  })();
  const EXCLUDE_BREAKFAST = hasAutoOptionType ? "AND (o.autoOptionType IS NULL OR o.autoOptionType != 'breakfast')" : '';
  // Covers actually served on each moment, when the operator reduced them
  // (specs/card-option-served-persons.md §3.4 rule 18): the cook must read the real number, not the
  // party. Guarded like every other optional column.
  const HAS_CARD_PERSONS = (() => {
    try { return database.prepare('PRAGMA table_info(reservation_options)').all().some((c) => c.name === 'cardPersons'); }
    catch { return false; }
  })();
  const stmt = (() => {
    try {
      return database.prepare(`
        SELECT
          ro.reservationId AS reservationId,
          ro.optionId AS optionId,
          ro.cardOccurrences AS cardOccurrences,
          ${HAS_CARD_PERSONS ? 'ro.cardPersons' : 'NULL'} AS cardPersons,
          o.title AS title,
          COALESCE(cli.firstName, '') AS firstName,
          COALESCE(cli.lastName,  '') AS lastName,
          res.icalOriginalSummary AS icalOriginalSummary,
          COALESCE(prop.name, '') AS propertyName,
          COALESCE(res.adults, 0)   AS adults,
          COALESCE(res.children, 0) AS children,
          COALESCE(res.teens, 0)    AS teens,
          COALESCE(res.babies, 0)   AS babies
        FROM reservation_options ro
        JOIN options o ON o.id = ro.optionId
        JOIN reservations res ON res.id = ro.reservationId
        LEFT JOIN clients cli ON cli.id = res.clientId
        LEFT JOIN properties prop ON prop.id = res.propertyId
        WHERE o.showsPlanningCard = 1
          AND res.kind = 'reservation'
          AND ro.cardOccurrences IS NOT NULL
          AND TRIM(ro.cardOccurrences) != ''
          ${EXCLUDE_BREAKFAST}
      `);
    } catch { return null; }
  })();

  function parseOccurrences(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return [];
    let list;
    try { list = JSON.parse(raw); } catch { return []; }
    if (!Array.isArray(list)) return [];
    return list
      .map((o) => ({ date: String(o?.date || '').slice(0, 10), time: formatTimeShort(o?.time) || '', done: Boolean(o?.done) }))
      .filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.date));
  }

  // Toggle the « préparé » flag of a single occurrence (specs/option-planning-card.md §3.5), matched by
  // (reservationId, optionId, date, time). Returns { ok, done } or { error }. Guarded for minimal schemas.
  const HAS_CARD_OCCURRENCES = (() => {
    try { return database.prepare("PRAGMA table_info(reservation_options)").all().some((c) => c.name === 'cardOccurrences'); }
    catch { return false; }
  })();
  function setOccurrenceDone({ reservationId, optionId, date, time, done } = {}) {
    if (!HAS_CARD_OCCURRENCES) return { error: 'NO_COLUMN' };
    const row = database.prepare('SELECT cardOccurrences FROM reservation_options WHERE reservationId = ? AND optionId = ?')
      .get(Number(reservationId), Number(optionId));
    if (!row) return { error: 'NOT_FOUND' };
    let list;
    try { list = JSON.parse(row.cardOccurrences || '[]'); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    const wantTime = formatTimeShort(time) || String(time || '');
    let matched = false;
    const next = list.map((o) => {
      if (!matched && String(o?.date || '') === String(date) && (formatTimeShort(o?.time) || String(o?.time || '')) === wantTime) {
        matched = true;
        return { ...o, done: Boolean(done) };
      }
      return o;
    });
    if (!matched) return { error: 'OCCURRENCE_NOT_FOUND' };
    database.prepare('UPDATE reservation_options SET cardOccurrences = ? WHERE reservationId = ? AND optionId = ?')
      .run(JSON.stringify(next), Number(reservationId), Number(optionId));
    return { ok: true, done: Boolean(done) };
  }

  return {
    /**
     * Returns `{ 'YYYY-MM-DD': { items: [...] } }` for every option card whose occurrence date
     * falls in `[from, to]`. Empty object when nothing contributes.
     */
    cardsInRange({ from, to } = {}) {
      if (!stmt) return {};
      const lo = String(from || '');
      const hi = String(to || '');
      const rows = stmt.all();
      const result = {};
      for (const r of rows) {
        const name = `${r.firstName || ''} ${r.lastName || ''}`.trim();
        const clientName = name || (r.icalOriginalSummary && String(r.icalOriginalSummary).trim()) || `Réservation #${r.reservationId}`;
        for (const occ of parseOccurrences(r.cardOccurrences)) {
          if (lo && occ.date < lo) continue;
          if (hi && occ.date > hi) continue;
          if (!result[occ.date]) result[occ.date] = { items: [] };
          result[occ.date].items.push({
            reservationId: r.reservationId,
            optionId: r.optionId,
            title: r.title || 'Option',
            clientName,
            propertyName: r.propertyName || '',
            adults: Number(r.adults) || 0,
            children: Number(r.children) || 0,
            teens: Number(r.teens) || 0,
            babies: Number(r.babies) || 0,
            // `null` = served to the whole party (the card then reads as it always did).
            servedPersons: Number(r.cardPersons) > 0 ? Math.floor(Number(r.cardPersons)) : null,
            date: occ.date,
            time: occ.time,
            done: Boolean(occ.done),
          });
        }
      }
      // Deterministic order: earliest time first, then title, then client, then reservation id.
      for (const date of Object.keys(result)) {
        result[date].items.sort((a, b) =>
          (a.time || '').localeCompare(b.time || '')
          || (a.title || '').localeCompare(b.title || '', 'fr')
          || a.clientName.localeCompare(b.clientName, 'fr')
          || a.reservationId - b.reservationId);
      }
      return result;
    },

    setOccurrenceDone,
  };
}

const db = require('../database');
const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
