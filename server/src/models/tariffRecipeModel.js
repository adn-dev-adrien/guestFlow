/**
 * Tariff recipe — diff and transactional apply against a property's pricing rules
 * (specs/tariff-recipes/spec.md §3.2 rules 7-12).
 *
 * Guarantees, each one a spec rule made mechanical:
 *  - rule 9  — a `pricing_rules` row with `seasonKey IS NULL` is manual: never a target, and its
 *              ranges are OBSTACLES the generated ranges must not overlap (blocking);
 *  - rule 10 — `apply` runs in ONE better-sqlite3 transaction and goes through propertiesModel's
 *              add/update (their overlap validation still runs on every write);
 *  - rule 11 — the diff compares normalized structures, so an unchanged property yields an empty
 *              diff and `apply` writes nothing;
 *  - rule 12 — ranges whose endDate precedes 1 January of the horizon are copied verbatim: past
 *              years are structurally out of reach.
 *
 * Factory `createTariffRecipeModel(database, recipeStore)` for testability; the default singleton
 * binds the real DB + the default recipe store.
 */

const { buildHorizonPlan, materializeClosures } = require('../utils/seasonPlan');

function roundOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function parseRanges(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// Stable signature of a range, override keys included — what "same range" means in the diff.
//
// `seasonMinNights` matters: the WRITE path drops a per-range `minNights` equal to the season default
// (a range that merely restates the default inherits instead — specs/pricing-min-nights-per-range.md).
// Comparing an unstripped desired range against a stripped stored one made the diff report the same
// dates as removed AND added on every run, so « re-applying without a change writes nothing »
// (specs/tariff-recipes/spec.md rule 11) quietly stopped holding. Normalising here keeps the diff
// comparing what will actually be stored.
function rangeSignature(range, seasonMinNights = null) {
  const min = range.minNights ?? '';
  const effectiveMin = seasonMinNights != null && Number(min) === Number(seasonMinNights) ? '' : min;
  return [range.startDate, range.endDate, effectiveMin, range.maxNights ?? '', range.changeoverArrival ?? '', range.changeoverDeparture ?? ''].join('|');
}

function rangesOverlap(a, b) {
  return a.startDate <= b.endDate && a.endDate >= b.startDate;
}

// `[{fromNight, price}]` × `[{fromNight, price:net}]` → `[{fromNight, price, netPrice}]`, the shape
// pricing_rules stores. Null netTiers → the displayed tiers stand alone (they gross up as their own
// net, the documented fallback).
function mergeTiersWithNet(perNightTiers, netTiers) {
  if (!Array.isArray(perNightTiers) || perNightTiers.length === 0) return null;
  const netByNight = new Map((netTiers || []).map((t) => [Number(t.fromNight), Number(t.price)]));
  return perNightTiers.map((t) => ({
    fromNight: Number(t.fromNight),
    price: Number(t.price),
    ...(netByNight.has(Number(t.fromNight)) ? { netPrice: netByNight.get(Number(t.fromNight)) } : {}),
  }));
}

function createTariffRecipeModel(database, recipeStore) {
  const propertiesModel = require('./propertiesModel').buildModel(database);
  const closuresModel = require('./establishmentClosuresModel').create(database);

  // Bound to the SAME database as this model, so a test on an in-memory schema journals in-memory
  // too. Lazy: a schema without `tariff_change_events` (an older test fixture) must still be able to
  // apply a recipe — the journal write is best-effort by design.
  let journalModel = null;
  const journal = () => {
    if (!journalModel) {
      journalModel = require('./tariffChangeJournalModel').createTariffChangeJournalModel(database);
    }
    return journalModel;
  };

  // The desired season payload (everything propertiesModel.add/updatePricingRule persists).
  function desiredSeasonPayload(recipe, season, dateRanges) {
    return {
      label: season.label,
      // A recipe label is authored and reviewed, not typed into a form, so it keeps its casing.
      // Without this, `sentenceCase` turns « Nouvel An » into « Nouvel an » on write, the next
      // preview sees a label change that can never be satisfied, and the apply is no longer
      // idempotent (spec §3.2 rule 11) — every horizon check would rewrite the seasons and stamp a
      // line in the tariff journal, which is the data a tariff change is measured against.
      labelFromRecipe: true,
      color: season.color,
      pricePerNight: Number(season.pricePerNight || 0),
      pricingMode: season.pricingMode || 'fixed',
      progressiveTiers: season.progressiveTiers || [],
      minNights: Number(season.minNights || 1),
      maxNights: season.maxNights ?? null,
      dateRanges,
      seasonKey: season.key,
      seasonRank: Number(season.rank),
      netTargetPerNight: roundOrNull(season.netTargetPerNight),
      extraGuestPrice: roundOrNull(season.extraGuestPrice),
      extraGuestNetTarget: roundOrNull(season.extraGuestNetTarget),
      // Per-night tiers are recipe-level, not per-season: the Aventura supplement is flat across
      // seasons (15/8 everywhere). A season declaring its own price still wins, because
      // `extraGuestPrice` and the tiers are read independently by the engine.
      // The recipe's netTiers (the per-band net pivots the platform grid grosses up) are merged
      // into the SAME stored rows as `netPrice` — the loader guarantees the night sequences match.
      // Without this merge the grid grosses up the DISPLAYED price as if it were net, overstating
      // every channel (direct 16/9 instead of 15/8).
      extraGuestTiers: mergeTiersWithNet(recipe.extraGuest?.perNightTiers, recipe.extraGuest?.netTiers),
      changeoverArrival: season.changeover?.arrival ?? null,
      changeoverDeparture: season.changeover?.departure ?? null,
    };
  }

  // Field-level diff between an existing rule row and the desired payload (ranges handled apart).
  function fieldChanges(existingRule, desired) {
    const changes = [];
    const compare = (field, from, to) => {
      const norm = (v) => (v === undefined || v === null || v === '' ? null : v);
      if (JSON.stringify(norm(from)) !== JSON.stringify(norm(to))) changes.push({ field, from: norm(from), to: norm(to) });
    };
    compare('label', existingRule.label, desired.label);
    compare('color', existingRule.color, desired.color);
    compare('pricePerNight', Number(existingRule.pricePerNight || 0), desired.pricePerNight);
    compare('pricingMode', existingRule.pricingMode || 'fixed', desired.pricingMode);
    compare('minNights', Number(existingRule.minNights || 1), desired.minNights);
    compare('maxNights', existingRule.maxNights ?? null, desired.maxNights);
    compare('seasonRank', existingRule.seasonRank, desired.seasonRank);
    compare('netTargetPerNight', roundOrNull(existingRule.netTargetPerNight), desired.netTargetPerNight);
    compare('extraGuestPrice', roundOrNull(existingRule.extraGuestPrice), desired.extraGuestPrice);
    compare('extraGuestNetTarget', roundOrNull(existingRule.extraGuestNetTarget), desired.extraGuestNetTarget);
    compare('extraGuestTiers', parseRanges(existingRule.extraGuestTiers), desired.extraGuestTiers || []);
    compare('changeoverArrival', existingRule.changeoverArrival, desired.changeoverArrival);
    compare('changeoverDeparture', existingRule.changeoverDeparture, desired.changeoverDeparture);
    // Stored tiers are the full normalized list while a recipe provides a single night-2 tier the
    // carry-forward extends — so compare curves by their EFFECT (the night-2..8 prices at the same
    // base), which distinguishes any real change without false positives on representation.
    const effect = (tiers, base) => {
      const list = parseRanges(tiers);
      const byNight = new Map(list.map((t) => [Number(t.nightNumber), Number(t.extraNightPrice)]));
      const out = [];
      for (let n = 2; n <= 8; n += 1) out.push(byNight.has(n) ? byNight.get(n) : null);
      return JSON.stringify(out) + `@${base}`;
    };
    if (desired.pricingMode === 'progressive' || (existingRule.pricingMode || 'fixed') === 'progressive') {
      const { normalizeProgressiveTiers } = require('../utils/pricing');
      const existingEffect = effect(
        normalizeProgressiveTiers(Number(existingRule.pricePerNight || 0), existingRule.progressiveTiers, 8),
        Number(existingRule.pricePerNight || 0),
      );
      const desiredEffect = effect(
        normalizeProgressiveTiers(desired.pricePerNight, desired.progressiveTiers, 8),
        desired.pricePerNight,
      );
      if (existingEffect !== desiredEffect) changes.push({ field: 'progressiveTiers', from: 'courbe actuelle', to: 'courbe de la recette' });
    }
    return changes;
  }

  function preview(propertyId, recipeId) {
    const warnings = [];
    // specs/tariff-recipes/spec.md §3.2 rule 9ter — every date the recipe could NOT write is
    // recorded here (not merely mentioned in a warning string) so the UI can list it.
    const conflicts = [];
    let blocking = false;

    const recipe = recipeStore.getRecipe(recipeId);
    if (!recipe) {
      return {
        recipe: { id: recipeId, version: null, label: null },
        horizon: null, seasons: [], closures: { added: [], kept: [], skipped: [] },
        conflicts: [], warnings: ['Recette introuvable.'], blocking: true,
      };
    }
    const property = database.prepare('SELECT id, name FROM properties WHERE id = ?').get(Number(propertyId));
    if (!property) {
      return {
        recipe: { id: recipe.id, version: recipe.version, label: recipe.label },
        horizon: null, seasons: [], closures: { added: [], kept: [], skipped: [] },
        conflicts: [], warnings: ['Logement introuvable.'], blocking: true,
      };
    }

    const fromYear = new Date().getFullYear();
    const toYear = fromYear + recipe.horizonYears - 1;
    const horizonStart = `${fromYear}-01-01`;

    // Closures: the skip set includes the previous winter's tail; only horizon-start rows are inserted.
    const skipClosures = materializeClosures(recipe, fromYear - 1, toYear);
    const desiredClosures = skipClosures.filter((c) => Number(c.startDate.slice(0, 4)) >= fromYear);
    const existingClosures = database.prepare(
      'SELECT id, label, startDate, endDate FROM establishment_closures WHERE propertyId = ?'
    ).all(Number(propertyId));
    const closuresDiff = { added: [], kept: [], skipped: [] };
    for (const closure of desiredClosures) {
      const already = existingClosures.find(
        (c) => c.startDate === closure.startDate && c.endDate === closure.endDate
      );
      if (already) { closuresDiff.kept.push(closure); continue; }
      const reservationConflict = closuresModel.findReservationOverlap(Number(propertyId), closure.startDate, closure.endDate);
      if (reservationConflict) {
        closuresDiff.skipped.push(closure);
        warnings.push(`Fermeture ${closure.startDate} → ${closure.endDate} non créée : réservation #${reservationConflict.id} à cheval.`);
        continue;
      }
      const closureConflict = closuresModel.findClosureOverlap(Number(propertyId), closure.startDate, closure.endDate);
      if (closureConflict) {
        closuresDiff.skipped.push(closure);
        warnings.push(`Fermeture ${closure.startDate} → ${closure.endDate} non créée : chevauche une fermeture existante.`);
        continue;
      }
      closuresDiff.added.push(closure);
    }

    // Existing skip set for the plan = desired + already-present property closures (any label).
    const planClosures = [...skipClosures, ...existingClosures.map((c) => ({ startDate: c.startDate, endDate: c.endDate }))];
    const plan = buildHorizonPlan(recipe, fromYear, planClosures);

    const rules = database.prepare('SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate, id').all(Number(propertyId));
    const ownedByKey = new Map();
    for (const rule of rules.filter((r) => r.seasonKey != null)) {
      if (ownedByKey.has(rule.seasonKey)) {
        warnings.push(`Deux saisons portent la clé « ${rule.seasonKey} » — corriger avant d'appliquer.`);
        blocking = true;
      }
      ownedByKey.set(rule.seasonKey, rule);
    }

    // ADOPTION (spec §3.2 rule 9bis) — first application on an already-configured property: a MANUAL
    // season whose label matches a recipe season's is taken over rather than treated as an obstacle.
    // Without this, applying a recipe to the property it was written for would always block on the
    // hand-painted seasons it is meant to replace. Label match only (trimmed, case-insensitive), one
    // manual row per key, and never a season the recipe already owns — so it can't hijack anything.
    const adoptedRuleIds = new Set();
    const normalizeLabel = (value) => String(value || '').trim().toLowerCase();
    for (const season of recipe.seasons) {
      if (ownedByKey.has(season.key)) continue;
      const candidate = rules.find((rule) => (
        rule.seasonKey == null
        && !adoptedRuleIds.has(rule.id)
        && normalizeLabel(rule.label) === normalizeLabel(season.label)
      ));
      if (candidate) {
        adoptedRuleIds.add(candidate.id);
        ownedByKey.set(season.key, candidate);
      }
    }
    const manualRules = rules.filter((r) => r.seasonKey == null && !adoptedRuleIds.has(r.id));

    const seasons = [];
    for (const season of recipe.seasons) {
      const existing = ownedByKey.get(season.key) || null;
      const existingRanges = existing ? parseRanges(existing.dateRanges) : [];
      const keptBefore = existingRanges.filter((r) => r.endDate < horizonStart);
      const existingInHorizon = existingRanges.filter((r) => r.endDate >= horizonStart);
      const desiredInHorizon = plan[season.key] || [];
      const desiredRanges = [...keptBefore, ...desiredInHorizon];
      const payload = desiredSeasonPayload(recipe, season, desiredRanges);

      // Obstacles (rule 9): a desired range overlapping a MANUAL season blocks the whole apply.
      for (const desired of desiredInHorizon) {
        const obstacle = manualRules.find((rule) => parseRanges(rule.dateRanges).some((r) => rangesOverlap(desired, r)));
        if (obstacle) {
          const blockingRange = parseRanges(obstacle.dateRanges).find((r) => rangesOverlap(desired, r));
          conflicts.push({
            startDate: desired.startDate,
            endDate: desired.endDate,
            seasonKey: season.key,
            seasonLabel: season.label,
            blockedByRuleId: Number(obstacle.id),
            blockedByLabel: obstacle.label,
            blockedByRange: blockingRange ? { startDate: blockingRange.startDate, endDate: blockingRange.endDate } : null,
          });
          warnings.push(`La plage ${desired.startDate} → ${desired.endDate} (${season.label}) chevauche la saison manuelle « ${obstacle.label} ».`);
          blocking = true;
        }
      }

      const seasonMin = Number(season.minNights || 1);
      const sig = (r) => rangeSignature(r, seasonMin);
      const existingSigs = new Set(existingInHorizon.map(sig));
      const desiredSigs = new Set(desiredInHorizon.map(sig));
      const rangesAdded = desiredInHorizon.filter((r) => !existingSigs.has(sig(r)));
      const rangesRemoved = existingInHorizon.filter((r) => !desiredSigs.has(sig(r)));
      const changes = existing ? fieldChanges(existing, payload) : [];
      const adopted = Boolean(existing && adoptedRuleIds.has(existing.id));
      const action = !existing
        ? 'create'
        : (!adopted && changes.length === 0 && rangesAdded.length === 0 && rangesRemoved.length === 0 ? 'unchanged' : 'update');

      seasons.push({
        seasonKey: season.key,
        label: season.label,
        ruleId: existing ? existing.id : null,
        action,
        adopted,
        fieldChanges: changes,
        rangesAdded,
        rangesRemoved,
        rangesKept: existingInHorizon.filter((r) => desiredSigs.has(sig(r))),
        payload,
      });
    }

    // Recipe-owned rows whose key the recipe no longer declares → removed (rule 9, second half).
    for (const [key, rule] of ownedByKey.entries()) {
      if (!recipe.seasons.some((s) => s.key === key)) {
        seasons.push({
          seasonKey: key, label: rule.label, ruleId: rule.id, action: 'remove',
          fieldChanges: [], rangesAdded: [], rangesRemoved: parseRanges(rule.dateRanges), rangesKept: [],
        });
      }
    }

    // A 1-night stay is impossible when both changeover days are set and differ (spec edge case).
    for (const season of recipe.seasons) {
      const a = season.changeover?.arrival;
      const d = season.changeover?.departure;
      if (Number.isInteger(a) && Number.isInteger(d) && a !== d && Number(season.minNights || 1) <= 1) {
        warnings.push(`${season.label} : arrivée le ${a} et départ le ${d} rendent les séjours d'une nuit impossibles.`);
      }
    }

    return {
      recipe: { id: recipe.id, version: recipe.version, label: recipe.label },
      horizon: { fromYear, toYear },
      seasons,
      closures: closuresDiff,
      conflicts,
      warnings,
      blocking,
    };
  }

  function apply(propertyId, recipeId) {
    const diff = preview(propertyId, recipeId);
    const recipe = recipeStore.getRecipe(recipeId);
    if (diff.blocking) {
      return { applied: false, ...diff };
    }
    const nothingToDo = diff.seasons.every((s) => s.action === 'unchanged') && diff.closures.added.length === 0;

    const runTransaction = database.transaction(() => {
      for (const closure of diff.closures.added) {
        closuresModel.insert({
          propertyId: Number(propertyId),
          label: closure.label,
          startDate: closure.startDate,
          endDate: closure.endDate,
        });
      }

      // 1. Orphans out first.
      for (const season of diff.seasons.filter((s) => s.action === 'remove')) {
        propertiesModel.deletePricingRule(Number(propertyId), season.ruleId);
      }
      // 2. Clear the recipe-owned targets' ranges so the rewrite can't transiently overlap itself
      //    (old MID holding July while LOW takes its new ranges). Direct write on purpose — the
      //    final per-season writes below go through the model and its overlap validation.
      for (const season of diff.seasons.filter((s) => s.action === 'update')) {
        database.prepare("UPDATE pricing_rules SET dateRanges = '[]', startDate = NULL, endDate = NULL WHERE id = ? AND propertyId = ?")
          .run(season.ruleId, Number(propertyId));
      }
      // 3. Final writes through the model (overlap validation runs against manual seasons).
      for (const season of diff.seasons) {
        if (season.action === 'create') {
          const result = propertiesModel.addPricingRule(Number(propertyId), season.payload);
          if (result.error) throw new Error(result.error);
        } else if (season.action === 'update') {
          const result = propertiesModel.updatePricingRule(Number(propertyId), season.ruleId, season.payload);
          if (result.error) throw new Error(result.error);
        }
      }

      propertiesModel.setTariffRecipe(Number(propertyId), recipeId, diff.recipe.version);
    });

    // The welcome-pack cost is recipe-owned: it loads the direct displayed price in the channel grid
    // and is never a property setting. Written on BOTH paths — a recipe whose only change is that
    // cost produces an EMPTY season diff, so writing it inside the transaction alone would make the
    // apply silently ignore it (a test caught exactly that).
    if (!nothingToDo) runTransaction();
    else propertiesModel.setTariffRecipe(Number(propertyId), recipeId, diff.recipe.version);
    propertiesModel.setWelcomePackCost(Number(propertyId), recipe?.welcomePack?.cost ?? 0);

    // specs/tariff-change-journal.md rule 5 — date the change, and only a real one. An apply that
    // moves no season and adds no closure changed no tariff, so it writes nothing: a journal full of
    // no-ops cannot be read against reservations. Outside the transaction and never throwing —
    // losing a line of history must not roll back seasons that are already written.
    if (!nothingToDo) {
      journal().recordRecipeApply({
        propertyId: Number(propertyId),
        recipeId,
        recipeVersion: diff.recipe.version,
      });
    }

    return { applied: !nothingToDo, ...diff };
  }

  // ── Scheduled-run journal (Dashboard alerts) ───────────────────────────────

  function recordRun({ propertyId, recipeId, recipeVersion, generatedYear, note, blocking }) {
    return database.prepare(`
      INSERT INTO tariff_recipe_runs (propertyId, recipeId, recipeVersion, generatedYear, note, blocking)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(Number(propertyId), String(recipeId), String(recipeVersion || ''), generatedYear ?? null, String(note || ''), blocking ? 1 : 0);
  }

  function listPendingRuns() {
    return database.prepare(`
      SELECT r.id, r.propertyId, p.name AS propertyName, r.recipeId, r.recipeVersion,
             r.generatedYear, r.note, r.blocking, r.createdAt
      FROM tariff_recipe_runs r
      JOIN properties p ON p.id = r.propertyId
      WHERE r.dismissedAt IS NULL
      ORDER BY r.createdAt DESC, r.id DESC
    `).all();
  }

  function dismissRun(id) {
    const result = database.prepare("UPDATE tariff_recipe_runs SET dismissedAt = datetime('now') WHERE id = ? AND dismissedAt IS NULL").run(Number(id));
    return result.changes > 0;
  }

  // The last calendar year fully covered by the property's recipe-owned seasons (horizon check).
  function coveredUntilYear(propertyId) {
    const rules = database.prepare('SELECT dateRanges FROM pricing_rules WHERE propertyId = ? AND seasonKey IS NOT NULL').all(Number(propertyId));
    let maxEnd = null;
    for (const rule of rules) {
      for (const range of parseRanges(rule.dateRanges)) {
        if (!maxEnd || range.endDate > maxEnd) maxEnd = range.endDate;
      }
    }
    if (!maxEnd) return null;
    // Covered up to 31 December of a year ⇒ that year is fully covered.
    const year = Number(maxEnd.slice(0, 4));
    return maxEnd === `${year}-12-31` ? year : year - 1;
  }

  return { preview, apply, recordRun, listPendingRuns, dismissRun, coveredUntilYear };
}

const db = require('../database');
const { getDefaultStore } = require('../utils/tariffRecipe');

let defaultModel = null;
function getDefaultModel() {
  if (!defaultModel) defaultModel = createTariffRecipeModel(db, getDefaultStore());
  return defaultModel;
}

module.exports = { createTariffRecipeModel, getDefaultModel };
