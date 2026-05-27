/**
 * School holidays sync engine.
 *
 * runSync({ model, fetchFn, horizonMonths, now }) — fetches official holidays from
 * data.education.gouv.fr, groups them per (annee_scolaire, description), then for each
 * group calls model.upsertByExternalRef. Locked rows are skipped. Stale auto rows whose
 * end-date is in the past are deleted.
 *
 * To smooth the seed → sync transition, manual rows (externalRef IS NULL, isLocked = 0)
 * whose normalized label matches an incoming group are *adopted* (their externalRef is
 * backfilled) instead of duplicated.
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
    const start = (rec.start_date || '').slice(0, 10);
    const end = (rec.end_date || '').slice(0, 10);
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
  const adoptableByLabel = new Map();
  for (const row of model.listAdoptableRows()) {
    const key = normalize(row.label);
    if (!adoptableByLabel.has(key)) adoptableByLabel.set(key, row.id);
  }
  const consumed = new Set();

  let createdCount = 0;
  let updatedCount = 0;
  let skippedLockedCount = 0;
  const keepRefSet = new Set();

  for (const group of groups) {
    keepRefSet.add(group.externalRef);

    // First try to adopt a manual row with the same normalized label.
    const labelKey = normalize(group.label);
    if (adoptableByLabel.has(labelKey) && !consumed.has(labelKey)) {
      const id = adoptableByLabel.get(labelKey);
      const adopted = model.adoptManualRow(id, group, nowIso);
      if (adopted) {
        consumed.add(labelKey);
        updatedCount += 1;
        continue;
      }
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

module.exports = { runSync, groupRecords, normalize, makeExternalRef };
