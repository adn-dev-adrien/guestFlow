/**
 * Platform-duplicate merge — fold several platform-name spellings into one canonical platform.
 *
 * Motivating case (specs/platforms-and-ical-rework.md): production drifted to TWO "Gîtes de France"
 * platforms — the legacy singular "Gîte de France" (slug `gitedefrance`) and the plural
 * "Gîtes de France" (slug `gitesdefrance`). They are the same real-world brand and must show as one,
 * named "GitesDeFrance".
 *
 * Slug-based (case/space/accent-insensitive) so it catches every variant. Idempotent: a second run on
 * already-merged data is a no-op. Safe — it relabels rather than deletes, and only drops EMPTY-URL
 * duplicate `ical_sources` placeholders (a real feed's row, its imported reservations and its
 * `ical_import_events` are never touched).
 *
 * Returns a small counters object for logging.
 */

function slugOf(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function mergePlatformDuplicates(db, { slugs, targetName }) {
  const targetSlug = slugOf(targetName);
  const mergeSet = new Set([...(slugs || []).map(slugOf), targetSlug].filter(Boolean));
  const matches = (value) => {
    const s = slugOf(value);
    return Boolean(s) && mergeSet.has(s);
  };
  const changed = { reservations: 0, sources: 0, sourcesDeleted: 0, platforms: 0 };

  // 1. reservations.platform → canonical.
  const resPlatforms = db.prepare("SELECT DISTINCT platform FROM reservations WHERE platform IS NOT NULL AND platform != ''").all();
  for (const { platform } of resPlatforms) {
    if (matches(platform) && platform !== targetName) {
      changed.reservations += db.prepare('UPDATE reservations SET platform = ? WHERE platform = ?').run(targetName, platform).changes;
    }
  }

  // 2. ical_sources → collapse the matching rows of each property to ONE (a UNIQUE(propertyId,
  //    platformKey) index forbids two rows sharing the canonical key), then relabel the survivor.
  //    Survivor = a row with a URL (a real feed) wins, else the most recent. Victims' imported
  //    reservations + import-events are re-pointed to the survivor before deletion (no orphans).
  const propIds = db.prepare('SELECT DISTINCT propertyId FROM ical_sources').all().map((r) => r.propertyId);
  for (const propertyId of propIds) {
    const rows = db.prepare('SELECT id, url, platformKey, platformLabel, name FROM ical_sources WHERE propertyId = ?')
      .all(propertyId)
      .filter((r) => matches(r.platformKey) || matches(r.platformLabel) || matches(r.name));
    if (!rows.length) continue;
    rows.sort((a, b) => {
      const au = (a.url && String(a.url).trim()) ? 1 : 0;
      const bu = (b.url && String(b.url).trim()) ? 1 : 0;
      if (au !== bu) return bu - au; // a URL'd feed wins
      return b.id - a.id;            // else the most recent
    });
    const survivor = rows[0];
    for (const victim of rows.slice(1)) {
      db.prepare('UPDATE reservations SET sourceIcalSourceId = ? WHERE sourceIcalSourceId = ?').run(survivor.id, victim.id);
      db.prepare('UPDATE OR IGNORE ical_import_events SET sourceId = ? WHERE sourceId = ?').run(survivor.id, victim.id);
      db.prepare('DELETE FROM ical_import_events WHERE sourceId = ?').run(victim.id);
      db.prepare('DELETE FROM ical_sources WHERE id = ?').run(victim.id);
      changed.sourcesDeleted += 1;
    }
    if (survivor.platformKey !== targetSlug || survivor.platformLabel !== targetName || survivor.name !== targetName) {
      changed.sources += db.prepare('UPDATE ical_sources SET name = ?, platformKey = ?, platformLabel = ? WHERE id = ?')
        .run(targetName, targetSlug, targetName, survivor.id).changes;
    }
  }

  // 3. platforms registry → ensure the target exists, carry over a custom colour, delete the variants.
  const hasColor = db.prepare('PRAGMA table_info(platforms)').all().some((c) => c.name === 'color');
  db.prepare('INSERT OR IGNORE INTO platforms (name) VALUES (?)').run(targetName);
  const variants = db.prepare('SELECT * FROM platforms').all().filter((p) => matches(p.name) && p.name !== targetName);
  for (const v of variants) {
    if (hasColor && v.color) {
      const tgt = db.prepare('SELECT color FROM platforms WHERE name = ?').get(targetName);
      if (tgt && !tgt.color) db.prepare('UPDATE platforms SET color = ? WHERE name = ?').run(v.color, targetName);
    }
    db.prepare('DELETE FROM platforms WHERE id = ?').run(v.id);
    changed.platforms += 1;
  }

  return changed;
}

module.exports = { mergePlatformDuplicates, slugOf };
