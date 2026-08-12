/**
 * Tariff recipes — loading, validation, source resolution (specs/tariff-recipes/spec.md §3.1, §3.5).
 *
 * A recipe is a declarative JSON document describing a whole tariff model: an open list of ranked
 * seasons (prices, discount curve, minimum nights, changeover), how the year is carved into them,
 * and the recurring closures. Two sources, read in order:
 *   1. bundled  — `server/src/recipes/*.json`, shipped with GuestFlow;
 *   2. local    — `<data dir>/recipes/*.json` on the host; a local recipe with an existing `id`
 *                 REPLACES the bundled one entirely (no field merging), so updating a recipe is a
 *                 file drop + restart, no release.
 *
 * Failure isolation (rule 27): each file is parsed and validated on its own. A broken one lands in
 * `listInvalidRecipes()` — it never throws, never blocks the others, never stops the boot.
 *
 * `createRecipeStore({ bundledDir, localDir })` is the unit-testable factory; the module-level
 * singleton lazily resolves the real directories (the local one beside the SQLite file, overridable
 * via GUESTFLOW_RECIPES_DIR) on first use.
 */

const fs = require('fs');
const path = require('path');

const VALID_PRICING_MODES = ['fixed', 'progressive'];
const VALID_ANCHOR_TYPES = ['fixed_dates', 'nth_weekday_of_month', 'last_full_week_of_month', 'between'];
const VALID_MODIFIER_TYPES = ['public_holiday_bridge'];
const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

function fail(pathStr, message) {
  return { valid: false, error: `${pathStr}: ${message}` };
}

function isFiniteNonNegative(v) {
  return Number.isFinite(Number(v)) && Number(v) >= 0;
}

function isWeekday(v) {
  return Number.isInteger(v) && v >= 0 && v <= 6;
}

/**
 * The source document expresses degressivity as a CUMULATIVE discount table ("3 nuits → −33 %"),
 * while the engine bills marginal night prices. This converts one into the other: each night's
 * marginal price is the difference between two cumulative totals, both rounded to the cent, so the
 * totals the operator reads in the document are reproduced exactly.
 *
 * Nights past the last declared one are left to the engine's carry-forward (the last tier repeats),
 * which keeps a further night from ever costing more than the one before it — the literal reading of
 * a flat "7 nights and beyond" would make night 8 dearer than night 7.
 */
function tiersFromDiscountTable(pricePerNight, table) {
  const base = Number(pricePerNight);
  const round2 = (v) => Math.round(v * 100) / 100;
  const totalAt = (nights, discountPct) => round2(base * nights * (1 - Number(discountPct) / 100));
  const sorted = [...table].sort((a, b) => a.nights - b.nights);
  const byNight = new Map(sorted.map((row) => [Number(row.nights), Number(row.discountPct)]));
  const maxNight = sorted[sorted.length - 1].nights;

  const tiers = [];
  let previousTotal = base; // night 1 is always the full rate
  for (let night = 2; night <= maxNight; night += 1) {
    // A night absent from the table keeps the previous night's cumulative discount.
    const discountPct = byNight.has(night)
      ? byNight.get(night)
      : [...byNight.entries()].filter(([n]) => n < night).map(([, d]) => d).pop() || 0;
    const total = totalAt(night, discountPct);
    tiers.push({ nightNumber: night, extraNightPrice: round2(total - previousTotal) });
    previousTotal = total;
  }
  return tiers;
}

function validateDiscountTable(table, where) {
  if (!Array.isArray(table) || table.length === 0) return fail(where, 'doit être un tableau non vide');
  let previousNights = 1;
  let previousDiscount = 0;
  for (let i = 0; i < table.length; i += 1) {
    const row = table[i];
    const rowWhere = `${where}[${i}]`;
    if (!row || typeof row !== 'object') return fail(rowWhere, 'doit être un objet { nights, discountPct }');
    if (!Number.isInteger(row.nights) || row.nights < 2) return fail(`${rowWhere}.nights`, 'entier ≥ 2');
    if (row.nights <= previousNights) return fail(`${rowWhere}.nights`, 'les nuits doivent être strictement croissantes');
    const pct = Number(row.discountPct);
    if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return fail(`${rowWhere}.discountPct`, 'nombre dans [0, 100[');
    // A longer stay is never LESS discounted — that would make a further night cost more.
    if (pct < previousDiscount) return fail(`${rowWhere}.discountPct`, `ne peut pas être inférieur à ${previousDiscount} % (séjour plus long)`);
    previousNights = row.nights;
    previousDiscount = pct;
  }
  return null;
}

function validateChangeover(value, where) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return fail(where, 'doit être null ou un objet { arrival, departure }');
  for (const side of ['arrival', 'departure']) {
    const v = value[side];
    if (v !== null && v !== undefined && !isWeekday(v)) {
      return fail(`${where}.${side}`, 'doit être null ou un entier 0-6 (0 = dimanche)');
    }
  }
  return null;
}

/**
 * Structural validation. Returns { valid: true, recipe } (the recipe with each progressive season's
 * `progressiveTiers` resolved — the `extraNightRatio` sugar is expanded into the single night-2 tier
 * the engine's carry-forward extends) or { valid: false, error } with the FIRST error and its path.
 */
function validateRecipe(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return fail('recipe', 'doit être un objet JSON');
  if (!json.id || typeof json.id !== 'string' || !json.id.trim()) return fail('id', 'requis (chaîne non vide)');
  if (!VERSION_RE.test(String(json.version || ''))) return fail('version', 'doit être du semver X.Y.Z');
  if (!json.label || typeof json.label !== 'string') return fail('label', 'requis');
  const horizonYears = json.horizonYears === undefined ? 2 : json.horizonYears;
  if (!Number.isInteger(horizonYears) || horizonYears < 1 || horizonYears > 5) return fail('horizonYears', 'entier 1-5');

  // Recipe-level degressivity table, shared by every progressive season (the source document states
  // one set of percentages for all three seasons). A season may declare its own.
  if (json.lengthOfStayDiscounts !== undefined) {
    const err = validateDiscountTable(json.lengthOfStayDiscounts, 'lengthOfStayDiscounts');
    if (err) return err;
  }

  // ── seasons ────────────────────────────────────────────────────────────────
  if (!Array.isArray(json.seasons) || json.seasons.length === 0) return fail('seasons', 'au moins une saison');
  const keys = new Set();
  const ranks = new Set();
  const resolvedSeasons = [];
  for (let i = 0; i < json.seasons.length; i += 1) {
    const s = json.seasons[i];
    const where = `seasons[${i}]`;
    if (!s || typeof s !== 'object') return fail(where, 'doit être un objet');
    if (!s.key || typeof s.key !== 'string' || !s.key.trim()) return fail(`${where}.key`, 'requis');
    if (keys.has(s.key)) return fail(`${where}.key`, `clé « ${s.key} » en double`);
    keys.add(s.key);
    if (!s.label || typeof s.label !== 'string') return fail(`${where}.label`, 'requis');
    if (!Number.isInteger(s.rank) || s.rank < 1) return fail(`${where}.rank`, 'doit être un entier ≥ 1');
    if (ranks.has(s.rank)) return fail(`${where}.rank`, `rang ${s.rank} en double`);
    ranks.add(s.rank);
    if (!s.color || typeof s.color !== 'string') return fail(`${where}.color`, 'requis');
    if (!isFiniteNonNegative(s.pricePerNight)) return fail(`${where}.pricePerNight`, 'nombre ≥ 0 requis');
    for (const opt of ['netTargetPerNight', 'extraGuestPrice', 'extraGuestNetTarget']) {
      if (s[opt] !== undefined && s[opt] !== null && !isFiniteNonNegative(s[opt])) {
        return fail(`${where}.${opt}`, 'doit être un nombre ≥ 0 (ou absent)');
      }
    }
    const mode = s.pricingMode || 'fixed';
    if (!VALID_PRICING_MODES.includes(mode)) return fail(`${where}.pricingMode`, `doit être ${VALID_PRICING_MODES.join(' | ')}`);
    const minNights = s.minNights === undefined ? 1 : s.minNights;
    if (!Number.isInteger(minNights) || minNights < 1) return fail(`${where}.minNights`, 'entier ≥ 1');
    const chErr = validateChangeover(s.changeover, `${where}.changeover`);
    if (chErr) return chErr;

    // Three mutually exclusive ways to declare the curve, all resolved here into the marginal tiers
    // the engine bills: a cumulative discount TABLE (the source-document form), a flat RATIO for
    // every night after the first, or explicit tiers.
    const seasonTable = s.lengthOfStayDiscounts !== undefined ? s.lengthOfStayDiscounts : json.lengthOfStayDiscounts;
    if (s.lengthOfStayDiscounts !== undefined) {
      const err = validateDiscountTable(s.lengthOfStayDiscounts, `${where}.lengthOfStayDiscounts`);
      if (err) return err;
    }
    const hasTable = seasonTable !== undefined;
    const hasRatio = s.extraNightRatio !== undefined && s.extraNightRatio !== null;
    const hasTiers = Array.isArray(s.progressiveTiers) && s.progressiveTiers.length > 0;
    if ([hasTable && s.lengthOfStayDiscounts !== undefined, hasRatio, hasTiers].filter(Boolean).length > 1) {
      return fail(`${where}`, 'lengthOfStayDiscounts, extraNightRatio et progressiveTiers sont mutuellement exclusifs');
    }
    if (hasRatio && mode !== 'progressive') return fail(`${where}.extraNightRatio`, 'réservé au mode progressive');
    if (hasRatio && !(Number(s.extraNightRatio) > 0 && Number(s.extraNightRatio) <= 1)) {
      return fail(`${where}.extraNightRatio`, 'doit être dans (0, 1]');
    }
    let progressiveTiers = [];
    if (mode === 'progressive') {
      if (hasTiers) progressiveTiers = s.progressiveTiers;
      // The single night-2 tier the engine's carry-forward extends to every later night.
      else if (hasRatio) progressiveTiers = [{ nightNumber: 2, extraNightPrice: Math.round(Number(s.pricePerNight) * Number(s.extraNightRatio) * 100) / 100 }];
      else if (hasTable) progressiveTiers = tiersFromDiscountTable(s.pricePerNight, seasonTable);
    }
    // The sugar is consumed here — dropped from the resolved season so a resolved recipe
    // re-validates cleanly (validation is idempotent).
    const { extraNightRatio, lengthOfStayDiscounts, ...rest } = s;
    void extraNightRatio; void lengthOfStayDiscounts;
    resolvedSeasons.push({ ...rest, pricingMode: mode, minNights, changeover: s.changeover ?? null, progressiveTiers });
  }
  const sortedRanks = [...ranks].sort((a, b) => a - b);
  for (let i = 0; i < sortedRanks.length; i += 1) {
    if (sortedRanks[i] !== i + 1) return fail('seasons', `les rangs doivent former 1..${sortedRanks.length} sans trou`);
  }

  // ── calendar ───────────────────────────────────────────────────────────────
  const cal = json.calendar;
  if (!cal || typeof cal !== 'object') return fail('calendar', 'requis');
  if (!keys.has(cal.baseSeason)) return fail('calendar.baseSeason', `doit être une clé de saison déclarée`);
  const periods = Array.isArray(cal.periods) ? cal.periods : [];
  const periodIds = new Set();
  for (let i = 0; i < periods.length; i += 1) {
    const p = periods[i];
    const where = `calendar.periods[${i}]`;
    if (!p || typeof p !== 'object') return fail(where, 'doit être un objet');
    if (!p.id || typeof p.id !== 'string') return fail(`${where}.id`, 'requis');
    if (periodIds.has(p.id)) return fail(`${where}.id`, `id « ${p.id} » en double`);
    if (!keys.has(p.season)) return fail(`${where}.season`, 'doit être une clé de saison déclarée');
    const a = p.anchor;
    if (!a || !VALID_ANCHOR_TYPES.includes(a.type)) return fail(`${where}.anchor.type`, `doit être ${VALID_ANCHOR_TYPES.join(' | ')}`);
    if (a.type === 'fixed_dates') {
      if (!MONTH_DAY_RE.test(String(a.from || ''))) return fail(`${where}.anchor.from`, 'format MM-DD requis');
      if (!MONTH_DAY_RE.test(String(a.to || ''))) return fail(`${where}.anchor.to`, 'format MM-DD requis');
    } else if (a.type === 'nth_weekday_of_month') {
      if (!Number.isInteger(a.month) || a.month < 1 || a.month > 12) return fail(`${where}.anchor.month`, 'entier 1-12');
      if (!isWeekday(a.weekday)) return fail(`${where}.anchor.weekday`, 'entier 0-6');
      if (!Number.isInteger(a.occurrence) || a.occurrence < 1) return fail(`${where}.anchor.occurrence`, 'entier ≥ 1');
      if (!Number.isInteger(p.nights) || p.nights < 1) return fail(`${where}.nights`, 'entier ≥ 1 requis pour cet ancrage');
    } else if (a.type === 'last_full_week_of_month') {
      if (!Number.isInteger(a.month) || a.month < 1 || a.month > 12) return fail(`${where}.anchor.month`, 'entier 1-12');
      if (!isWeekday(a.weekday)) return fail(`${where}.anchor.weekday`, 'entier 0-6');
      if (!Number.isInteger(p.nights) || p.nights < 1) return fail(`${where}.nights`, 'entier ≥ 1 requis pour cet ancrage');
    } else if (a.type === 'between') {
      // `between` may only reference EARLIER periods — they resolve in declaration order.
      if (!periodIds.has(a.after)) return fail(`${where}.anchor.after`, 'doit référencer une période déclarée AVANT celle-ci');
      if (!periodIds.has(a.before)) return fail(`${where}.anchor.before`, 'doit référencer une période déclarée AVANT celle-ci');
    }
    const pChErr = validateChangeover(p.changeover, `${where}.changeover`);
    if (pChErr) return pChErr;
    if (p.minNights !== undefined && (!Number.isInteger(p.minNights) || p.minNights < 1)) {
      return fail(`${where}.minNights`, 'entier ≥ 1 (ou absent)');
    }
    periodIds.add(p.id);
  }
  const modifiers = Array.isArray(cal.modifiers) ? cal.modifiers : [];
  for (let i = 0; i < modifiers.length; i += 1) {
    const m = modifiers[i];
    const where = `calendar.modifiers[${i}]`;
    if (!m || !VALID_MODIFIER_TYPES.includes(m.type)) return fail(`${where}.type`, `doit être ${VALID_MODIFIER_TYPES.join(' | ')}`);
    if (m.effect !== 'raise_rank') return fail(`${where}.effect`, 'doit être raise_rank');
    const amount = m.amount === undefined ? 1 : m.amount;
    if (!Number.isInteger(amount) || amount < 1) return fail(`${where}.amount`, 'entier ≥ 1');
    // Minimum nights imposed on the holiday block: "block" = the block's own length, an integer =
    // that value, absent = no minimum (backward compatible).
    if (m.minNights !== undefined && m.minNights !== 'block'
      && !(Number.isInteger(m.minNights) && m.minNights >= 1)) {
      return fail(`${where}.minNights`, '"block" ou un entier ≥ 1 (ou absent)');
    }
  }

  // ── closures ───────────────────────────────────────────────────────────────
  const closures = Array.isArray(json.closures) ? json.closures : [];
  for (let i = 0; i < closures.length; i += 1) {
    const c = closures[i];
    const where = `closures[${i}]`;
    if (!c || typeof c !== 'object') return fail(where, 'doit être un objet');
    if (!c.label || typeof c.label !== 'string') return fail(`${where}.label`, 'requis');
    if (!MONTH_DAY_RE.test(String(c.from || ''))) return fail(`${where}.from`, 'format MM-DD requis');
    if (!MONTH_DAY_RE.test(String(c.to || ''))) return fail(`${where}.to`, 'format MM-DD requis');
  }

  // ── extraGuest (informational + property config) ───────────────────────────
  if (json.extraGuest !== undefined && json.extraGuest !== null) {
    const eg = json.extraGuest;
    if (typeof eg !== 'object') return fail('extraGuest', 'doit être un objet');
    if (eg.unit !== undefined && !['per_stay', 'per_night'].includes(eg.unit)) return fail('extraGuest.unit', 'per_stay | per_night');
    if (eg.appliesAbove !== undefined && (!Number.isInteger(eg.appliesAbove) || eg.appliesAbove < 0)) {
      return fail('extraGuest.appliesAbove', 'entier ≥ 0');
    }
  }

  return {
    valid: true,
    recipe: {
      ...json,
      horizonYears,
      seasons: resolvedSeasons,
      calendar: { ...cal, periods, modifiers },
      closures,
    },
  };
}

function readRecipeFiles(dir, source) {
  const valid = [];
  const invalid = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'));
  } catch {
    return { valid, invalid }; // a missing directory is not an error (rule 26)
  }
  for (const file of entries.sort()) {
    const fullPath = path.join(dir, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const result = validateRecipe(parsed);
      if (result.valid) valid.push({ recipe: result.recipe, source, file });
      else invalid.push({ file, source, error: result.error });
    } catch (err) {
      invalid.push({ file, source, error: `JSON invalide — ${err.message}` });
    }
  }
  return { valid, invalid };
}

function createRecipeStore({ bundledDir, localDir } = {}) {
  let cache = null;

  function loadAll() {
    const bundled = bundledDir ? readRecipeFiles(bundledDir, 'bundled') : { valid: [], invalid: [] };
    const local = localDir ? readRecipeFiles(localDir, 'local') : { valid: [], invalid: [] };
    const byId = new Map();
    for (const entry of bundled.valid) {
      byId.set(entry.recipe.id, { ...entry, overridesBundled: false });
    }
    for (const entry of local.valid) {
      const overridesBundled = byId.has(entry.recipe.id) && byId.get(entry.recipe.id).source === 'bundled';
      byId.set(entry.recipe.id, { ...entry, overridesBundled });
    }
    cache = {
      recipes: [...byId.values()].sort((a, b) => a.recipe.id.localeCompare(b.recipe.id)),
      invalid: [...bundled.invalid, ...local.invalid],
    };
    return cache;
  }

  function ensure() { return cache || loadAll(); }

  return {
    listRecipes() {
      return ensure().recipes.map(({ recipe, source, file, overridesBundled }) => ({
        id: recipe.id, version: recipe.version, label: recipe.label,
        description: recipe.description || '', source, file, overridesBundled,
      }));
    },
    getRecipe(id) {
      const entry = ensure().recipes.find((r) => r.recipe.id === id);
      return entry ? entry.recipe : null;
    },
    getRecipeMeta(id) {
      const entry = ensure().recipes.find((r) => r.recipe.id === id);
      return entry ? { source: entry.source, file: entry.file, overridesBundled: entry.overridesBundled } : null;
    },
    listInvalidRecipes() { return ensure().invalid; },
    reload() { return loadAll(); },
  };
}

// ── Default singleton — real directories, resolved lazily ───────────────────
let defaultStore = null;
function getDefaultStore() {
  if (!defaultStore) {
    // The local dir lives beside the SQLite file (`<data dir>/recipes`) so the Pi's persistent
    // data directory hosts it; overridable via env. Lazy so pure-validation tests never touch it.
    const db = require('../database');
    const localDir = process.env.GUESTFLOW_RECIPES_DIR
      || path.join(path.dirname(db.dbPath), 'recipes');
    defaultStore = createRecipeStore({
      bundledDir: path.join(__dirname, '..', 'recipes'),
      localDir,
    });
  }
  return defaultStore;
}

module.exports = { validateRecipe, createRecipeStore, getDefaultStore };
