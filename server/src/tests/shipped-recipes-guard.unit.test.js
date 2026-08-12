const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { validateRecipe } = require('../utils/tariffRecipe');
const { buildHorizonPlan, materializeClosures, missingEventYears } = require('../utils/seasonPlan');

// A recipe is DATA in the repository, and data has no compiler. Every other test in this area
// builds its own recipe object, so a typo in a shipped `server/src/recipes/*.json` — a season key
// that no period references, a date outside its year, a discount table that decreases — would ship
// green and only surface when someone opened the tariff page in production.
//
// This file walks whatever is actually in the folder, so a recipe added later is covered the day it
// lands without anyone remembering to write a test for it.

const RECIPES_DIR = path.join(__dirname, '..', 'recipes');
const FILES = fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith('.json'));

test('the recipes folder is not silently empty', () => {
  assert.ok(FILES.length > 0, 'at least one shipped recipe is expected — an empty folder means the test proves nothing');
});

for (const file of FILES) {
  const recipe = (() => {
    const raw = fs.readFileSync(path.join(RECIPES_DIR, file), 'utf8');
    const out = validateRecipe(JSON.parse(raw));
    return out.valid ? out.recipe : null;
  })();

  test(`${file} — parses and validates`, () => {
    const raw = fs.readFileSync(path.join(RECIPES_DIR, file), 'utf8');
    let json;
    assert.doesNotThrow(() => { json = JSON.parse(raw); }, 'must be valid JSON');
    const out = validateRecipe(json);
    assert.equal(out.valid, true, out.error);
  });

  test(`${file} — the id matches the filename, so a local override can target it`, () => {
    assert.equal(recipe.id, file.replace(/\.json$/, ''));
  });

  test(`${file} — every declared season is reachable`, () => {
    // A season no period, base or event ever paints produces an empty range list: the apply would
    // create a row that can never price a night, and the operator would see a phantom season.
    const used = new Set([recipe.calendar.baseSeason]);
    for (const p of recipe.calendar.periods || []) used.add(p.season);
    for (const e of recipe.calendar.events || []) used.add(e.season);
    // A holiday modifier reaches ranks nothing else paints — but only `amount` above the highest
    // painted rank. Bounding by `amount` is what makes the check able to fail: waving through every
    // higher rank would declare any orphan season reachable.
    const bridge = (recipe.calendar.modifiers || []).find((m) => m.type === 'public_holiday_bridge');
    if (bridge) {
      const ranks = recipe.seasons.filter((s) => used.has(s.key)).map((s) => s.rank);
      const maxUsed = ranks.length ? Math.max(...ranks) : 1;
      const reach = maxUsed + (bridge.amount === undefined ? 1 : bridge.amount);
      for (const s of recipe.seasons) if (s.rank > maxUsed && s.rank <= reach) used.add(s.key);
    }
    const unreachable = recipe.seasons.filter((s) => !used.has(s.key)).map((s) => s.key);
    assert.deepEqual(unreachable, [], 'these seasons are declared but never painted');
  });

  test(`${file} — the horizon covers every day, with no gap and no overlap`, () => {
    const fromYear = 2026;
    const closures = materializeClosures(recipe, fromYear - 1, fromYear + recipe.horizonYears);
    const plan = buildHorizonPlan(recipe, fromYear, closures);
    const all = Object.values(plan).flat().sort((a, b) => a.startDate.localeCompare(b.startDate));
    assert.ok(all.length > 0, 'the horizon produced ranges');

    for (let i = 1; i < all.length; i += 1) {
      assert.ok(all[i - 1].endDate < all[i].startDate, `overlap between ${JSON.stringify(all[i - 1])} and ${JSON.stringify(all[i])}`);
    }
    // Day-by-day coverage of the first year: a hole means a night falls back to no season at all.
    const covered = new Set();
    for (const r of all) {
      for (let d = new Date(`${r.startDate}T12:00:00Z`); d <= new Date(`${r.endDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
        covered.add(d.toISOString().slice(0, 10));
      }
    }
    const holes = [];
    for (let d = new Date(Date.UTC(fromYear, 0, 1)); d.getUTCFullYear() === fromYear; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (!covered.has(iso)) holes.push(iso);
    }
    assert.deepEqual(holes, [], `${fromYear} has uncovered days`);
  });

  test(`${file} — no minimum stay exceeds its own maximum`, () => {
    const fromYear = 2026;
    const closures = materializeClosures(recipe, fromYear - 1, fromYear + recipe.horizonYears);
    const plan = buildHorizonPlan(recipe, fromYear, closures);
    for (const season of recipe.seasons) {
      const seasonMax = season.maxNights ?? Infinity;
      for (const range of plan[season.key] || []) {
        const min = range.minNights ?? season.minNights ?? 1;
        const max = range.maxNights ?? seasonMax;
        assert.ok(min <= max, `${season.key} ${range.startDate}: min ${min} > max ${max} — that range is unbookable`);
      }
    }
  });

  test(`${file} — every declared event year is in the future or the near past`, () => {
    // A date typed as 2025 in a 2027 slot validates (the year key is checked) but silently paints
    // nothing. Catching an event whose ONLY years are long past flags a recipe nobody maintains.
    for (const event of recipe.calendar.events || []) {
      const years = Object.keys(event.dates || {}).map(Number);
      if (years.length === 0) continue;
      assert.ok(Math.max(...years) >= 2026, `${event.key}: latest declared year ${Math.max(...years)} is stale`);
    }
  });

  test(`${file} — the event gaps in the horizon are reported, not hidden`, () => {
    // Not a failure: a year without dates is a legitimate state. The assertion is that the SIGNAL
    // exists, because the visible gap is the durable guarantee behind the scheduled watch.
    const events = recipe.calendar.events || [];
    if (events.length === 0) return;
    const beyond = missingEventYears(recipe, 2026, 2040);
    assert.ok(beyond.length > 0, 'a far horizon must report missing years rather than inventing them');
    assert.ok(beyond.every((m) => m.key && m.label && m.year), 'each gap names the event and the year');
  });
}
