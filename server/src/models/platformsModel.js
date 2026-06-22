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

// Parse the persisted JSON sync-counts blob into a plain object (null when absent / unparsable, e.g.
// rows synced before the column existed). Shape: { created, updated, removed, unchanged, locked, skippedClosure }.
function parseSyncCounts(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

// Resolve a platform's display colour from its (optional) custom override → built-in brand colour →
// the grey default. `customColor` is `platforms.color` (NULL/'' when unset).
function resolveColor(name, customColor) {
  const custom = String(customColor || '').trim();
  if (custom) return custom;
  return KNOWN_PLATFORM_COLORS[platformSlug(name)] || DEFAULT_PLATFORM_COLOR;
}

// specs/per-platform-tourist-tax-three-way.md — the GLOBAL 3-way tourist-tax mode ⇄ the two stored
// booleans. 'platform' = collects + remits to commune (1,1); 'platform_reversed' = collects, reverses
// to us (1,0); 'owner' = we collect at arrival (0,0). Invalid combo (collects=0 + remitted=1) is
// normalised away (we-collect always means we remit).
function touristTaxCollectionToFlags(mode) {
  if (mode === 'owner') return { collectsTouristTax: 0, touristTaxRemittedByPlatform: 0 };
  if (mode === 'platform_reversed') return { collectsTouristTax: 1, touristTaxRemittedByPlatform: 0 };
  return { collectsTouristTax: 1, touristTaxRemittedByPlatform: 1 }; // 'platform' (default)
}
function flagsToTouristTaxCollection(collects, remitted) {
  if (Number(collects) === 0) return 'owner';
  return Number(remitted) === 0 ? 'platform_reversed' : 'platform';
}

// Colour-only slugs: kept in KNOWN_PLATFORM_COLORS so legacy data still resolves to the brand colour,
// but NOT offered as their own dropdown entry — they fold into another platform's canonical name.
// `gitedefrance` (legacy singular "Gîte de France") folds into the plural "Gîtes de France".
const COLOR_ONLY_SLUGS = new Set(['gitedefrance']);
// Curated display names where the slug → formatPlatformName derivation isn't the nice multi-word form
// ('gitesdefrance' → "Gitesdefrance" would lose the word boundaries; we want "GitesDeFrance").
const BUILTIN_NAME_OVERRIDES = { gitesdefrance: 'GitesDeFrance' };

// Canonical display names of the built-in well-known platforms ('Airbnb', 'Booking', …) derived
// from the shared colour map so they stay in sync. These are always offered in the dropdowns even
// before any reservation or iCal source has used them.
const KNOWN_PLATFORM_NAMES = Object.keys(KNOWN_PLATFORM_COLORS)
  .filter((slug) => !COLOR_ONLY_SLUGS.has(slug))
  .map((slug) => BUILTIN_NAME_OVERRIDES[slug] || formatPlatformName(slug))
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
    // `updateTouristTax` is prepared lazily (inside setTouristTaxCollection) — the tax columns are
    // absent on minimal test DBs that pre-date the migration, and an eager prepare would throw at
    // model construction and break every platforms-model consumer.
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

    // The platform's GLOBAL tourist-tax 3-way mode ('platform' | 'platform_reversed' | 'owner').
    getTouristTaxCollection(name) {
      const slug = platformSlug(name);
      if (slug === DIRECT_NAME) return 'owner'; // direct: we collect + remit (no platform notion)
      const row = stmts.listAll.all().find((p) => platformSlug(p.name) === slug);
      if (!row) return 'platform';
      return flagsToTouristTaxCollection(row.collectsTouristTax, row.touristTaxRemittedByPlatform);
    },

    // Set the platform's GLOBAL tourist-tax mode. Upserts the platform row by canonical name (so a
    // never-synced built-in can still be configured) and applies to every property at once.
    setTouristTaxCollection(name, mode) {
      const slug = platformSlug(name);
      if (!slug || slug === DIRECT_NAME) return null; // direct has no platform-tax notion
      let row = stmts.listAll.all().find((p) => platformSlug(p.name) === slug);
      if (!row) {
        const canonical = formatPlatformName(name) || String(name).trim();
        if (!canonical) return null;
        stmts.upsert.run(canonical);
        row = stmts.findByName.get(canonical);
        if (!row) return null;
      }
      const flags = touristTaxCollectionToFlags(mode);
      database.prepare('UPDATE platforms SET collectsTouristTax = ?, touristTaxRemittedByPlatform = ? WHERE id = ?')
        .run(flags.collectsTouristTax, flags.touristTaxRemittedByPlatform, row.id);
      return { id: row.id, name: row.name, touristTaxCollection: flagsToTouristTaxCollection(flags.collectsTouristTax, flags.touristTaxRemittedByPlatform) };
    },

    // specs/platform-deposit-toggle.md — GLOBAL per-platform "takes an acompte?" flag. Read defensively
    // (column absent on minimal test DBs → 0). `direct` always returns 0 (it has its own deposit flow).
    getDepositMode(name) {
      const slug = platformSlug(name);
      if (slug === DIRECT_NAME) return 0;
      try {
        const row = database.prepare('SELECT platformTakesDeposit AS d FROM platforms WHERE name = ? COLLATE NOCASE').get(String(name));
        return row && Number(row.d) === 1 ? 1 : 0;
      } catch (_) {
        return 0;
      }
    },

    // Set the platform's GLOBAL acompte flag. Upserts the platform row by canonical name (mirrors
    // setTouristTaxCollection) so a never-synced built-in can be configured. `direct` is rejected.
    setDepositMode(name, takesDeposit) {
      const slug = platformSlug(name);
      if (!slug || slug === DIRECT_NAME) return null;
      let row = stmts.listAll.all().find((p) => platformSlug(p.name) === slug);
      if (!row) {
        const canonical = formatPlatformName(name) || String(name).trim();
        if (!canonical) return null;
        stmts.upsert.run(canonical);
        row = stmts.findByName.get(canonical);
        if (!row) return null;
      }
      const value = takesDeposit === true || Number(takesDeposit) === 1 ? 1 : 0;
      database.prepare('UPDATE platforms SET platformTakesDeposit = ? WHERE id = ?').run(value, row.id);
      return { id: row.id, name: row.name, platformTakesDeposit: value };
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
      // GLOBAL tourist-tax mode per platform (specs/per-platform-tourist-tax-three-way.md). Read
      // defensively — the columns are absent on minimal test DBs that pre-date the migration.
      const taxBySlug = new Map();
      try {
        for (const r of database.prepare('SELECT name, collectsTouristTax AS c, touristTaxRemittedByPlatform AS r FROM platforms').all()) {
          taxBySlug.set(platformSlug(r.name), r);
        }
      } catch (_) { /* tax columns missing → every platform falls back to the 'platform' default */ }
      // specs/platform-deposit-toggle.md — GLOBAL per-platform "takes an acompte?" flag. Read
      // defensively (column absent on minimal/pre-migration test DBs → default 0 = no acompte).
      const depositBySlug = new Map();
      try {
        for (const r of database.prepare('SELECT name, platformTakesDeposit AS d FROM platforms').all()) {
          depositBySlug.set(platformSlug(r.name), Number(r.d) === 1 ? 1 : 0);
        }
      } catch (_) { /* column missing → every platform falls back to 0 (no acompte) */ }
      // Prepared lazily: this model is constructed on minimal test DBs that have no `ical_sources`
      // table; only this per-property merge actually needs it.
      const sources = database.prepare(`
        SELECT id AS sourceId, propertyId, name, url, platformKey, platformLabel, platformColor,
               isActive, collectsTouristTax, touristTaxRemittedByPlatform, disabled,
               lastSyncAt, lastSyncStatus, lastSyncMessage, lastSyncCounts, lastImportedCount
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
          // Built-in (default) platform — present out of the box, can't be removed from the list. Only
          // custom-added platforms expose the "réinitialiser la configuration" (delete) action.
          isBuiltIn: Boolean(KNOWN_PLATFORM_COLORS[slug]),
          url: source ? (source.url || '') : '',
          // specs/per-platform-tourist-tax-three-way.md — the tourist-tax mode is GLOBAL per platform
          // (read from `platforms`, not the per-property source). The 3-way string the UI Select binds
          // to; no platform row / missing columns → 'platform' (the platform collects + remits itself).
          touristTaxCollection: (() => {
            const t = taxBySlug.get(slug);
            return t ? flagsToTouristTaxCollection(t.c, t.r) : 'platform';
          })(),
          collectsTouristTax: (() => {
            const t = taxBySlug.get(slug);
            return t ? Number(t.c) : 1;
          })(),
          // specs/platform-deposit-toggle.md — GLOBAL per-platform acompte flag (0 = no acompte, default).
          platformTakesDeposit: slug === DIRECT_NAME ? 0 : (depositBySlug.get(slug) || 0),
          disabled: source ? Number(source.disabled) : 0,
          sourceId: source ? source.sourceId : null,
          lastSyncAt: source ? source.lastSyncAt : null,
          lastSyncStatus: source ? source.lastSyncStatus : null,
          lastSyncMessage: source ? source.lastSyncMessage : null,
          // Per-category counts for the visual "État" cell (null when never synced / pre-migration).
          syncCounts: source ? parseSyncCounts(source.lastSyncCounts) : null,
        };
      });
    },
  };
}

const defaultModel = createPlatformsModel(db);
defaultModel.create = createPlatformsModel;
defaultModel.DIRECT_NAME = DIRECT_NAME;

module.exports = defaultModel;
