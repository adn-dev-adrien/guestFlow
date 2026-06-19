/**
 * Platforms model — CRUD on the deduped per-platform commission config.
 *
 * The `platforms` table holds ONE row per unique platform name across the whole app — seeded
 * once at boot from `DISTINCT ical_sources.platformLabel` and topped up on every iCal source
 * create/update through `upsertByName`. The Direct row (id 1, name 'direct') is always
 * present and never editable.
 *
 * Spec: specs/accounting-platform-commission-and-no-deposit.md §3.1.
 *
 * Factory `create(db)` (+ a default bound to the production DB), mirroring the other models.
 */

const db = require('../database');
const { formatPlatformName } = require('../utils/platformNameFormat');
const { KNOWN_PLATFORM_COLORS, DEFAULT_PLATFORM_COLOR } = require('../constants/platformColors');

const DIRECT_NAME = 'direct';

// Reduce any platform name/key shape to its slug (lowercase, alphanumeric only) — the key used by
// KNOWN_PLATFORM_COLORS and by the client colour map. Mirrors client constants/platforms.js.
function platformSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Resolve a platform's display colour from its (optional) custom override → built-in brand colour →
// the grey default. `customColor` is `platforms.color` (NULL/'' when unset).
function resolveColor(name, customColor) {
  const custom = String(customColor || '').trim();
  if (custom) return custom;
  return KNOWN_PLATFORM_COLORS[platformSlug(name)] || DEFAULT_PLATFORM_COLOR;
}

// Canonical display names of the built-in well-known platforms ('Airbnb', 'Booking', …) derived
// from the shared colour map so they stay in sync. These are always offered in the dropdowns even
// before any reservation or iCal source has used them.
const KNOWN_PLATFORM_NAMES = Object.keys(KNOWN_PLATFORM_COLORS)
  .map((slug) => formatPlatformName(slug))
  .filter(Boolean);

function createPlatformsModel(database) {
  const stmts = {
    listAll: database.prepare(`
      SELECT id, name, commissionAccountNumber, hasVatOnCommission, COALESCE(commissionPercent, 0) AS commissionPercent, color
      FROM platforms
      ORDER BY (name = '${DIRECT_NAME}') DESC, name COLLATE NOCASE ASC
    `),
    findByName: database.prepare(`
      SELECT id, name, commissionAccountNumber, hasVatOnCommission, COALESCE(commissionPercent, 0) AS commissionPercent, color
      FROM platforms WHERE name = ?
    `),
    findById: database.prepare(`
      SELECT id, name, commissionAccountNumber, hasVatOnCommission, COALESCE(commissionPercent, 0) AS commissionPercent, color
      FROM platforms WHERE id = ?
    `),
    upsert: database.prepare("INSERT OR IGNORE INTO platforms (name) VALUES (?)"),
    update: database.prepare(`
      UPDATE platforms
         SET commissionAccountNumber = ?,
             hasVatOnCommission = ?
       WHERE id = ?
    `),
    updateCommissionPercent: database.prepare("UPDATE platforms SET commissionPercent = ? WHERE id = ?"),
    updateColor: database.prepare("UPDATE platforms SET color = ? WHERE id = ?"),
  };

  return {
    listAll() {
      return stmts.listAll.all();
    },
    // Canonical, deduped list of platform NAMES for the UI dropdowns (reservation form + iCal
    // source form). Union of the built-in well-known platforms and every name stored in the
    // `platforms` table — which is itself topped up from `ical_sources.platformLabel` +
    // `reservations.platform` (see rescan/upsertByName). This is what makes a platform added in a
    // logement's iCal imports show up in the dropdowns. 'direct' is forced first, then alphabetical
    // (case-insensitive). Deduped on the canonical form so 'Airbnb'/'airbnb' collapse to one entry.
    listNames() {
      const byCanonical = new Map(); // lowercased canonical → canonical display name
      for (const raw of [...KNOWN_PLATFORM_NAMES, ...stmts.listAll.all().map((r) => r.name)]) {
        const canonical = formatPlatformName(raw);
        if (!canonical) continue;
        const key = canonical.toLowerCase();
        if (!byCanonical.has(key)) byCanonical.set(key, canonical);
      }
      return [...byCanonical.values()].sort((a, b) => {
        if (a.toLowerCase() === DIRECT_NAME) return -1;
        if (b.toLowerCase() === DIRECT_NAME) return 1;
        return a.localeCompare(b, 'fr', { sensitivity: 'base' });
      });
    },
    findByName(name) {
      if (name == null || name === '') return null;
      return stmts.findByName.get(String(name)) || null;
    },
    findById(id) {
      if (id == null) return null;
      return stmts.findById.get(Number(id)) || null;
    },
    // specs/normalize-platform-names.md §3.2 rule 10 — belt-and-suspenders: format the input
    // even though the model's callers (propertyIcalModel + reservationsModel) already feed a
    // canonical string. Guards against a future caller that bypasses those hooks.
    upsertByName(name) {
      const canonical = formatPlatformName(name);
      if (canonical == null || canonical === '') return null;
      stmts.upsert.run(canonical);
      return stmts.findByName.get(canonical) || null;
    },
    // Re-run the union INSERT OR IGNORE from `ical_sources.platformLabel` +
    // `reservations.platform` so any platform that appeared since the last boot/upsert lands on
    // the dedicated config page. Idempotent: existing rows are untouched. Returns the number
    // of new platforms inserted so the UI can flash a friendly "+N nouvelles plateformes"
    // toast on the operator's refresh click.
    rescan() {
      const before = database.prepare('SELECT COUNT(*) AS c FROM platforms').get().c;
      database.exec(`
        INSERT OR IGNORE INTO platforms (name)
        SELECT DISTINCT platformLabel FROM ical_sources
         WHERE platformLabel IS NOT NULL AND platformLabel != ''
      `);
      database.exec(`
        INSERT OR IGNORE INTO platforms (name)
        SELECT DISTINCT platform FROM reservations
         WHERE platform IS NOT NULL AND platform != '' AND LOWER(platform) != 'direct'
      `);
      const after = database.prepare('SELECT COUNT(*) AS c FROM platforms').get().c;
      return Math.max(0, after - before);
    },
    // Guard against editing the Direct row. The spec says Direct fields are server-side
    // ignored — never written. Returns the unchanged row, mirroring update()'s contract.
    update({ id, commissionAccountNumber, hasVatOnCommission }) {
      const row = stmts.findById.get(Number(id));
      if (!row) return null;
      if (row.name === DIRECT_NAME) return row;
      const account = commissionAccountNumber == null || commissionAccountNumber === ''
        ? null
        : String(commissionAccountNumber);
      const hasVat = hasVatOnCommission === true || Number(hasVatOnCommission) === 1 ? 1 : 0;
      stmts.update.run(account, hasVat, Number(id));
      return stmts.findById.get(Number(id));
    },

    // Non-direct platforms with their commission % (specs/platform-price-from-commission.md §3.1).
    listWithCommission() {
      return stmts.listAll.all()
        .filter((p) => p.name !== DIRECT_NAME)
        .map((p) => ({ id: p.id, name: p.name, commissionPercent: Number(p.commissionPercent) || 0 }));
    },

    // Set a platform's global commission % (clamped to [0, 99.99]). The Direct row is never editable.
    setCommissionPercent(id, commissionPercent) {
      const row = stmts.findById.get(Number(id));
      if (!row || row.name === DIRECT_NAME) return null;
      const c = Math.max(0, Math.min(99.99, Number(commissionPercent) || 0));
      stmts.updateCommissionPercent.run(c, Number(id));
      return stmts.findById.get(Number(id));
    },

    // ── Global per-platform colour (specs/platforms-and-ical-rework.md §3 rules 5-6) ─────────────
    // Resolution everywhere: custom `platforms.color` → built-in `KNOWN_PLATFORM_COLORS[slug]` → grey.

    // Resolved display colour for a platform name/key.
    getColor(name) {
      const slug = platformSlug(name);
      const row = stmts.listAll.all().find((p) => platformSlug(p.name) === slug);
      return resolveColor(name, row && row.color);
    },

    // Set (or clear) a platform's global colour. Upserts the platform row by canonical name so a
    // never-used built-in can still be recoloured. A colour equal to the built-in brand colour (or
    // empty) clears the override (stored NULL) so the platform tracks the built-in default again.
    setColor(name, hex) {
      const slug = platformSlug(name);
      if (!slug) return null;
      let row = stmts.listAll.all().find((p) => platformSlug(p.name) === slug);
      if (!row) {
        const canonical = slug === DIRECT_NAME ? DIRECT_NAME : (formatPlatformName(name) || String(name).trim());
        if (!canonical) return null;
        stmts.upsert.run(canonical);
        row = stmts.findByName.get(canonical);
        if (!row) return null;
      }
      const chosen = String(hex || '').trim();
      const builtin = KNOWN_PLATFORM_COLORS[slug] || '';
      const store = !chosen || chosen.toLowerCase() === builtin.toLowerCase() ? null : chosen;
      stmts.updateColor.run(store, row.id);
      return { id: row.id, name: row.name, color: resolveColor(row.name, store) };
    },

    // Custom colour OVERRIDES only (platforms with a non-NULL `color`), keyed by slug. Consumed by the
    // calendar colour endpoint as `customColors` (the client already knows the built-in defaults).
    colorMap() {
      const map = {};
      for (const p of stmts.listAll.all()) {
        const color = String(p.color || '').trim();
        if (!color) continue;
        const slug = platformSlug(p.name);
        if (slug) map[slug] = color;
      }
      return map;
    },

    // Merged per-property platform list (specs/platforms-and-ical-rework.md §3 rule 2 + §4.3). Every
    // platform (built-ins ∪ DB registry, incl. `direct`) joined with THIS property's `ical_sources`
    // config (matched by slug on platformKey/platformLabel/name). A platform with no source row still
    // appears: empty URL, no sync, tax = default (platform collects), not disabled.
    listForProperty(propertyId) {
      const names = this.listNames();
      const platformRows = stmts.listAll.all();
      const colorBySlug = new Map(platformRows.map((p) => [platformSlug(p.name), p.color]));
      // Prepared lazily: this model is constructed on minimal test DBs that have no `ical_sources`
      // table; only this per-property merge actually needs it.
      const sources = database.prepare(`
        SELECT id AS sourceId, propertyId, name, url, platformKey, platformLabel, platformColor,
               isActive, collectsTouristTax, disabled,
               lastSyncAt, lastSyncStatus, lastSyncMessage, lastImportedCount
          FROM ical_sources
         WHERE propertyId = ?
         ORDER BY id DESC
      `).all(Number(propertyId));
      // Most-recent source wins when a property somehow has duplicate rows for one platform.
      const sourceBySlug = new Map();
      for (const s of sources) {
        for (const candidate of [s.platformKey, s.platformLabel, s.name]) {
          const slug = platformSlug(candidate);
          if (slug && !sourceBySlug.has(slug)) sourceBySlug.set(slug, s);
        }
      }
      return names.map((name) => {
        const slug = platformSlug(name);
        const source = sourceBySlug.get(slug) || null;
        return {
          platformKey: source ? source.platformKey : slug,
          platformLabel: name,
          color: resolveColor(name, colorBySlug.get(slug)),
          isDirect: slug === DIRECT_NAME,
          url: source ? (source.url || '') : '',
          collectsTouristTax: source ? Number(source.collectsTouristTax) : 1,
          disabled: source ? Number(source.disabled) : 0,
          sourceId: source ? source.sourceId : null,
          lastSyncAt: source ? source.lastSyncAt : null,
          lastSyncStatus: source ? source.lastSyncStatus : null,
          lastSyncMessage: source ? source.lastSyncMessage : null,
        };
      });
    },
  };
}

const defaultModel = createPlatformsModel(db);
defaultModel.create = createPlatformsModel;
defaultModel.DIRECT_NAME = DIRECT_NAME;

module.exports = defaultModel;
