/**
 * What the house sends for the guests' « Domotique » page, and the light commands waiting for it
 * (specs/guest-app-home-automation.md §3.A-§3.B, §5). Four tables, all overwritten in place: the latest catalogue,
 * the latest reading of each selected pair with ~45 min of samples for the trend, the latest 24 buckets of a series,
 * and the commands of the last 7 days.
 */

const SAMPLE_WINDOW_MS = 45 * 60 * 1000;
const COLLECT_WINDOW_MS = 30 * 1000;
const RESULT_WINDOW_MS = 60 * 1000;
const DEDUPE_MS = 2 * 1000;
const PURGE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const HOME_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS home_catalog (
    equipmentId     TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    zonePath        TEXT NOT NULL DEFAULT '',
    type            TEXT NOT NULL,
    guestSwitchable INTEGER NOT NULL DEFAULT 0,
    readingsJson    TEXT NOT NULL DEFAULT '[]',
    lastSeenAt      TEXT NOT NULL,
    goneAt          TEXT
  );
  CREATE TABLE IF NOT EXISTS home_readings (
    equipmentId TEXT NOT NULL,
    alias       TEXT NOT NULL,
    valueJson   TEXT,
    unit        TEXT,
    measuredAt  TEXT NOT NULL,
    receivedAt  TEXT NOT NULL,
    samplesJson TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (equipmentId, alias)
  );
  CREATE TABLE IF NOT EXISTS home_series (
    equipmentId TEXT NOT NULL,
    alias       TEXT NOT NULL,
    bucketsJson TEXT NOT NULL,
    updatedAt   TEXT NOT NULL,
    PRIMARY KEY (equipmentId, alias)
  );
  CREATE TABLE IF NOT EXISTS home_commands (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    stayId      INTEGER NOT NULL,
    propertyId  INTEGER NOT NULL,
    equipmentId TEXT NOT NULL,
    lightId     TEXT NOT NULL,
    value       TEXT NOT NULL CHECK (value IN ('on', 'off')),
    issuedAt    TEXT NOT NULL,
    collectedAt TEXT,
    state       TEXT NOT NULL DEFAULT 'pending',
    reason      TEXT,
    answeredAt  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_home_commands_state ON home_commands(state, issuedAt);
  CREATE TABLE IF NOT EXISTS home_connector_state (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    lastCatalogAt  TEXT,
    lastReadingsAt TEXT,
    lastSeriesAt   TEXT,
    lastPollAt     TEXT
  );
`;

const HOME_TABLES = Object.freeze(['home_catalog', 'home_readings', 'home_series', 'home_commands', 'home_connector_state']);

const parse = (json, fallback) => {
  try { return JSON.parse(json); } catch { return fallback; }
};
const pairKey = (equipmentId, alias) => `${equipmentId}\u0000${alias}`;

function createHomeModel(db) {
  const stamp = (column, at) => {
    db.prepare('INSERT OR IGNORE INTO home_connector_state (id) VALUES (1)').run();
    db.prepare(`UPDATE home_connector_state SET ${column} = ? WHERE id = 1`).run(at);
  };

  const catalogRow = (r) => ({
    id: r.equipmentId,
    name: r.name,
    zonePath: r.zonePath,
    type: r.type,
    guestSwitchable: Boolean(r.guestSwitchable),
    readings: parse(r.readingsJson, []),
    lastSeenAt: r.lastSeenAt,
    goneAt: r.goneAt || null,
  });

  const commandRow = (r) => (r ? {
    id: r.id,
    stayId: r.stayId,
    propertyId: r.propertyId,
    equipmentId: r.equipmentId,
    lightId: r.lightId,
    value: r.value,
    issuedAt: r.issuedAt,
    collectedAt: r.collectedAt,
    state: r.state,
    reason: r.reason,
    answeredAt: r.answeredAt,
  } : null);

  /** Rules 8 — a command nobody collected in 30 s, or whose result never came in 60 s, expires and stays expired. */
  const expire = (now) => {
    const nowMs = now.getTime();
    db.prepare("UPDATE home_commands SET state = 'expired' WHERE state = 'pending' AND issuedAt < ?")
      .run(new Date(nowMs - COLLECT_WINDOW_MS).toISOString());
    db.prepare("UPDATE home_commands SET state = 'expired' WHERE state = 'collected' AND collectedAt < ?")
      .run(new Date(nowMs - RESULT_WINDOW_MS).toISOString());
  };

  return {
    /** Rule 3 — the whole catalogue replaces the previous one; an equipment no longer listed is marked gone, not lost. */
    replaceCatalog(equipments, now) {
      const at = now.toISOString();
      const upsert = db.prepare(`
        INSERT INTO home_catalog (equipmentId, name, zonePath, type, guestSwitchable, readingsJson, lastSeenAt, goneAt)
        VALUES (@id, @name, @zonePath, @type, @guestSwitchable, @readingsJson, @at, NULL)
        ON CONFLICT(equipmentId) DO UPDATE SET name = excluded.name, zonePath = excluded.zonePath, type = excluded.type,
          guestSwitchable = excluded.guestSwitchable, readingsJson = excluded.readingsJson, lastSeenAt = excluded.lastSeenAt,
          goneAt = NULL
      `);
      db.transaction(() => {
        equipments.forEach((e) => upsert.run({
          id: e.id,
          name: e.name,
          zonePath: e.zonePath,
          type: e.type,
          guestSwitchable: e.guestSwitchable ? 1 : 0,
          readingsJson: JSON.stringify(e.readings),
          at,
        }));
        const ids = new Set(equipments.map((e) => e.id));
        db.prepare('SELECT equipmentId FROM home_catalog WHERE goneAt IS NULL').all()
          .filter((r) => !ids.has(r.equipmentId))
          .forEach((r) => db.prepare('UPDATE home_catalog SET goneAt = ? WHERE equipmentId = ?').run(at, r.equipmentId));
        stamp('lastCatalogAt', at);
      })();
    },

    catalog() {
      return db.prepare('SELECT * FROM home_catalog ORDER BY zonePath, name').all().map(catalogRow);
    },

    /** Rules 5-6 — only the selected pairs of a known, present equipment are kept; the rest is counted as dropped. */
    storeReadings(readings, selection, now) {
      const wanted = new Set(selection.map((p) => pairKey(p.equipmentId, p.alias)));
      const present = new Set(db.prepare('SELECT equipmentId FROM home_catalog WHERE goneAt IS NULL').all().map((r) => r.equipmentId));
      const at = now.toISOString();
      const read = db.prepare('SELECT samplesJson, measuredAt FROM home_readings WHERE equipmentId = ? AND alias = ?');
      const write = db.prepare(`
        INSERT INTO home_readings (equipmentId, alias, valueJson, unit, measuredAt, receivedAt, samplesJson)
        VALUES (@equipmentId, @alias, @valueJson, @unit, @measuredAt, @at, @samplesJson)
        ON CONFLICT(equipmentId, alias) DO UPDATE SET valueJson = excluded.valueJson, unit = excluded.unit,
          measuredAt = excluded.measuredAt, receivedAt = excluded.receivedAt, samplesJson = excluded.samplesJson
      `);
      let stored = 0;
      db.transaction(() => {
        readings.forEach((r) => {
          if (!wanted.has(pairKey(r.equipmentId, r.alias)) || !present.has(r.equipmentId)) return;
          const previous = read.get(r.equipmentId, r.alias);
          // A house clock ahead of ours would keep a silent house « fresh »: no measure is later than its receipt.
          const measuredMs = Math.min(Date.parse(r.measuredAt), now.getTime());
          const measuredAt = new Date(measuredMs).toISOString();
          // A batch retried after a reconnection never replaces a newer value.
          if (previous && Date.parse(previous.measuredAt) >= measuredMs) return;
          const samples = (previous ? parse(previous.samplesJson, []) : [])
            .filter(([t]) => measuredMs - Date.parse(t) <= SAMPLE_WINDOW_MS && Date.parse(t) < measuredMs);
          if (typeof r.value === 'number') samples.push([measuredAt, r.value]);
          write.run({
            equipmentId: r.equipmentId,
            alias: r.alias,
            valueJson: JSON.stringify(r.value),
            unit: r.unit == null ? null : r.unit,
            measuredAt,
            at,
            samplesJson: JSON.stringify(samples),
          });
          stored += 1;
        });
        stamp('lastReadingsAt', at);
      })();
      return { stored, dropped: readings.length - stored };
    },

    readings(pairs) {
      const read = db.prepare('SELECT * FROM home_readings WHERE equipmentId = ? AND alias = ?');
      return pairs.map((p) => read.get(p.equipmentId, p.alias)).filter(Boolean).map((r) => ({
        equipmentId: r.equipmentId,
        alias: r.alias,
        value: parse(r.valueJson, null),
        unit: r.unit,
        measuredAt: r.measuredAt,
        receivedAt: r.receivedAt,
        samples: parse(r.samplesJson, []).map(([at, value]) => ({ at, value })),
      }));
    },

    storeSeries(series, selection, now) {
      const wanted = new Set(selection.map((p) => pairKey(p.equipmentId, p.alias)));
      const present = new Set(db.prepare('SELECT equipmentId FROM home_catalog WHERE goneAt IS NULL').all().map((r) => r.equipmentId));
      const at = now.toISOString();
      const write = db.prepare(`
        INSERT INTO home_series (equipmentId, alias, bucketsJson, updatedAt) VALUES (?, ?, ?, ?)
        ON CONFLICT(equipmentId, alias) DO UPDATE SET bucketsJson = excluded.bucketsJson, updatedAt = excluded.updatedAt
      `);
      let stored = 0;
      db.transaction(() => {
        series.forEach((s) => {
          if (!wanted.has(pairKey(s.equipmentId, s.alias)) || !present.has(s.equipmentId)) return;
          write.run(s.equipmentId, s.alias, JSON.stringify(s.buckets), at);
          stored += 1;
        });
        stamp('lastSeriesAt', at);
      })();
      return { stored, dropped: series.length - stored };
    },

    series(pairs) {
      const read = db.prepare('SELECT * FROM home_series WHERE equipmentId = ? AND alias = ?');
      return pairs.map((p) => read.get(p.equipmentId, p.alias)).filter(Boolean).map((r) => ({
        equipmentId: r.equipmentId,
        alias: r.alias,
        buckets: parse(r.bucketsJson, []),
        updatedAt: r.updatedAt,
      }));
    },

    /**
     * Rules 8, 10 — a light command waiting for the house. The same tap twice within 2 s (same stay, light and value)
     * is one command: the first is returned.
     */
    queueCommand({ stayId, propertyId, equipmentId, lightId, value }, now) {
      const recent = db.prepare(`
        SELECT * FROM home_commands WHERE stayId = ? AND lightId = ? AND value = ? AND issuedAt >= ?
        ORDER BY id DESC LIMIT 1
      `).get(stayId, lightId, value, new Date(now.getTime() - DEDUPE_MS).toISOString());
      if (recent) return { ...commandRow(recent), deduped: true };
      const id = Number(db.prepare(`
        INSERT INTO home_commands (stayId, propertyId, equipmentId, lightId, value, issuedAt) VALUES (?, ?, ?, ?, ?, ?)
      `).run(stayId, propertyId, equipmentId, lightId, value, now.toISOString()).lastInsertRowid);
      return commandRow(db.prepare('SELECT * FROM home_commands WHERE id = ?').get(id));
    },

    /** The commands the house has not collected yet, marked collected in the same transaction. */
    collect(now) {
      return db.transaction(() => {
        expire(now);
        const rows = db.prepare("SELECT * FROM home_commands WHERE state = 'pending' ORDER BY id").all();
        const at = now.toISOString();
        rows.forEach((r) => db.prepare("UPDATE home_commands SET state = 'collected', collectedAt = ? WHERE id = ?").run(at, r.id));
        stamp('lastPollAt', at);
        return rows.map(commandRow);
      })();
    },

    /** A result counts only for a command the house collected and that has not expired; anything else is ignored. */
    storeResults(results, now) {
      const at = now.toISOString();
      let stored = 0;
      db.transaction(() => {
        expire(now);
        results.forEach((r) => {
          const changes = db.prepare(`
            UPDATE home_commands SET state = ?, reason = ?, answeredAt = ? WHERE id = ? AND state = 'collected'
          `).run(r.ok ? 'done' : 'refused', r.ok ? null : (r.reason || 'refused'), at, r.id).changes;
          stored += changes;
        });
      })();
      return { stored };
    },

    /** Rule 23 — the last command the house confirmed, per light: newer than its last state reading, it is the state. */
    confirmed(equipmentIds) {
      if (!equipmentIds.length) return [];
      const read = db.prepare(`
        SELECT equipmentId, value, answeredAt FROM home_commands WHERE state = 'done' AND equipmentId = ?
        ORDER BY answeredAt DESC, id DESC LIMIT 1
      `);
      return [...new Set(equipmentIds)].map((id) => read.get(id)).filter(Boolean);
    },

    command(id, now) {
      expire(now);
      return commandRow(db.prepare('SELECT * FROM home_commands WHERE id = ?').get(Number(id)));
    },

    channel() {
      const state = db.prepare('SELECT * FROM home_connector_state WHERE id = 1').get() || {};
      const equipments = db.prepare('SELECT COUNT(*) AS n FROM home_catalog WHERE goneAt IS NULL').get().n;
      return {
        lastCatalogAt: state.lastCatalogAt || null,
        lastReadingsAt: state.lastReadingsAt || null,
        lastSeriesAt: state.lastSeriesAt || null,
        lastPollAt: state.lastPollAt || null,
        equipments,
      };
    },

    purge(now) {
      return db.prepare('DELETE FROM home_commands WHERE issuedAt < ?')
        .run(new Date(now.getTime() - PURGE_AFTER_MS).toISOString()).changes;
    },
  };
}

module.exports = { createHomeModel, HOME_TABLES_SQL, HOME_TABLES };
