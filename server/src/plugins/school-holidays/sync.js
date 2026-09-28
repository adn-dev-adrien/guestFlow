/**
 * School holidays sync engine.
 *
 * runSync({ model, fetchFn, horizonMonths, now }) — fetches official holidays from
 * data.education.gouv.fr, groups them per (annee_scolaire, description), then for each
 * group calls model.upsertByExternalRef. Locked rows are skipped. Stale auto rows whose
 * end-date is in the past are deleted.
 *
 * To smooth the seed → sync transition, manual rows (externalRef IS NULL, isLocked = 0)
 * whose normalized label — or else whose season word and dates — match an incoming group are
 * *adopted* (their externalRef is backfilled, their dates replaced by the official ones) instead of
 * duplicated.
 */

const { fetchOfficialHolidays } = require('./educationGouvClient');

const ZONE_FIELD = {
  'Zone A': ['zoneA_start', 'zoneA_end'],
  'Zone B': ['zoneB_start', 'zoneB_end'],
  'Zone C': ['zoneC_start', 'zoneC_end'],
};

function normalize(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// The dataset gives instants: a period starts at 00:00 Paris on its first day and `end_date` is 00:00
// Paris on the day classes resume. A period is stored as its first and last days off, in Paris time
// (the UTC date of `2026-10-16T22:00:00+00:00` is the Friday before the holidays). A bare date is
// already a day and is kept as it is.
const parisDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

function toDay(value, { resumption = false } = {}) {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.length === 10) return raw;
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return raw.slice(0, 10);
  if (!resumption) return parisDay.format(instant);
  const day = new Date(`${parisDay.format(instant)}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

const SEASON_WORDS = ['toussaint', 'noel', 'hiver', 'printemps', 'paques', 'ascension', 'ete'];
function seasonWord(label) {
  const words = normalize(label).split(/[^a-z]+/);
  return SEASON_WORDS.find((w) => words.includes(w)) || null;
}

function makeExternalRef({ annee_scolaire, description }) {
  return `${annee_scolaire || ''}|${normalize(description)}`;
}

/**
 * Group API records into per-period payloads.
 * Each group key = (annee_scolaire, normalized description).
 * Each group yields { externalRef, label, zoneA_start/end, zoneB_start/end, zoneC_start/end }.
 */
function groupRecords(records) {
  const groups = new Map();
  for (const rec of records) {
    const zone = rec.zones;
    const fields = ZONE_FIELD[zone];
    if (!fields) continue; // ignore Corse, DOM-TOM, etc.
    const start = toDay(rec.start_date);
    // A single-day entry (a bridge, « Début des vacances d'été ») has `end_date` = `start_date`.
    const end = rec.end_date === rec.start_date ? start : toDay(rec.end_date, { resumption: true });
    if (!start || !end) continue;
    const externalRef = makeExternalRef(rec);
    let group = groups.get(externalRef);
    if (!group) {
      group = {
        externalRef,
        label: rec.description || 'Vacances',
        zoneA_start: null, zoneA_end: null,
        zoneB_start: null, zoneB_end: null,
        zoneC_start: null, zoneC_end: null,
      };
      groups.set(externalRef, group);
    }
    const [startKey, endKey] = fields;
    group[startKey] = start;
    group[endKey] = end;
  }
  return [...groups.values()];
}

function todayIso(now) {
  return now.toISOString().slice(0, 10);
}

async function runSync({ model, fetchFn = fetch, horizonMonths, now = new Date() }) {
  const startTime = Date.now();
  let records;
  try {
    records = await fetchOfficialHolidays({ horizonMonths, fetchFn, now });
  } catch (err) {
    const msg = String(err?.message || 'Erreur réseau');
    model.setSyncResult({
      lastSyncAt: now.toISOString(),
      lastSyncStatus: 'error',
      lastSyncMessage: msg,
      lastImportedCount: 0,
    });
    return { ok: false, error: msg, durationMs: Date.now() - startTime };
  }

  const groups = groupRecords(records);
  const nowIso = now.toISOString();

  // Build a quick lookup of adoptable manual rows by normalized label.
  // Multiple manual rows could share a label (unlikely); first match wins.
  const adoptableRows = model.listAdoptableRows();
  const adoptableByLabel = new Map();
  for (const row of adoptableRows) {
    const key = normalize(row.label);
    if (!adoptableByLabel.has(key)) adoptableByLabel.set(key, row.id);
  }
  const consumed = new Set();
  const adoptedIds = new Set();
  // A hand-typed « Toussaint 2026 » and the official « Vacances de la Toussaint » are the same period
  // when they name the same season and their dates overlap in at least one zone.
  const overlaps = (row, group) => ['A', 'B', 'C'].some((z) => {
    const [rs, re, gs, ge] = [row[`zone${z}_start`], row[`zone${z}_end`], group[`zone${z}_start`], group[`zone${z}_end`]];
    return rs && re && gs && ge && rs <= ge && gs <= re;
  });
  const sameSeason = (row, group) => {
    const word = seasonWord(group.label);
    return Boolean(word) && word === seasonWord(row.label);
  };

  let createdCount = 0;
  let updatedCount = 0;
  let skippedLockedCount = 0;
  const keepRefSet = new Set();

  for (const group of groups) {
    keepRefSet.add(group.externalRef);

    // A period already imported is updated in place; only a new one may adopt a manual row.
    const alreadyImported = model.findByExternalRef(group.externalRef);

    // First try to adopt a manual row with the same normalized label.
    const labelKey = normalize(group.label);
    if (!alreadyImported && adoptableByLabel.has(labelKey) && !consumed.has(labelKey)) {
      const id = adoptableByLabel.get(labelKey);
      const adopted = model.adoptManualRow(id, group, nowIso);
      if (adopted) {
        consumed.add(labelKey);
        adoptedIds.add(id);
        updatedCount += 1;
        continue;
      }
    }
    const twin = !alreadyImported
      && adoptableRows.find((row) => !adoptedIds.has(row.id) && sameSeason(row, group) && overlaps(row, group));
    if (twin && model.adoptManualRow(twin.id, group, nowIso)) {
      adoptedIds.add(twin.id);
      updatedCount += 1;
      continue;
    }

    const result = model.upsertByExternalRef(group, nowIso);
    if (result.action === 'created') createdCount += 1;
    else if (result.action === 'updated') updatedCount += 1;
    else if (result.action === 'skippedLocked') skippedLockedCount += 1;
  }

  const deletedStaleCount = model.deleteStaleAutoRows(keepRefSet, todayIso(now));

  const importedCount = createdCount + updatedCount;
  const message = `${createdCount} créé(s), ${updatedCount} mis à jour, ${skippedLockedCount} verrouillé(s), ${deletedStaleCount} supprimé(s).`;

  model.setSyncResult({
    lastSyncAt: now.toISOString(),
    lastSyncStatus: 'success',
    lastSyncMessage: message,
    lastImportedCount: importedCount,
  });

  return {
    ok: true,
    createdCount,
    updatedCount,
    skippedLockedCount,
    deletedStaleCount,
    durationMs: Date.now() - startTime,
  };
}

module.exports = { runSync, groupRecords, normalize, makeExternalRef, toDay };
