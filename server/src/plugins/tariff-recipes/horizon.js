/**
 * The daily horizon pass of the tariff-recipes plugin, moved out of scheduledTasks.js
 * (specs/plugins-phase-1-sdk.md rule 8).
 */

// Tariff-recipe horizon extension (specs/tariff-recipes/spec.md §3.2 rule 12). For every property
// with an active recipe: when the horizon (current year + recipe.horizonYears − 1) is no longer
// fully covered by its recipe-owned seasons, re-apply the recipe (idempotent — a covered horizon
// produces an empty diff and writes nothing) and journal the run so the Dashboard surfaces it.
// A blocking condition journals instead of writing — the operator is told, never silently left
// with a half-configured year. One pending journal row per property max (no daily spam).
// deps: { model, store, database } — the plugin passes its own; tests pass in-memory ones.
function runTariffRecipeHorizonPass(reason = 'cron', { model, store, database }) {
  const properties = database.prepare("SELECT id, name, tariffRecipeId FROM properties WHERE tariffRecipeId != ''").all();
  if (!properties.length) return;
  const pendingByProperty = new Set(model.listPendingRuns().map((run) => run.propertyId));
  const currentYear = new Date().getFullYear();

  for (const property of properties) {
    try {
      if (pendingByProperty.has(property.id)) continue; // an undismissed alert is already waiting
      const recipe = store.getRecipe(property.tariffRecipeId);
      if (!recipe) {
        model.recordRun({
          propertyId: property.id, recipeId: property.tariffRecipeId, recipeVersion: '',
          note: 'Recette introuvable — le calendrier ne sera plus étendu.', blocking: 1,
        });
        continue;
      }
      const targetYear = currentYear + recipe.horizonYears - 1;
      const covered = model.coveredUntilYear(property.id);
      if (covered !== null && covered >= targetYear) continue; // horizon fully covered → no-op

      const result = model.apply(property.id, property.tariffRecipeId);
      if (result.applied) {
        model.recordRun({
          propertyId: property.id, recipeId: recipe.id, recipeVersion: recipe.version,
          generatedYear: targetYear, note: `Saisons générées jusqu'à fin ${targetYear} — à relire.`,
        });
        console.log(`[tariff-recipes] ${reason}: horizon étendu jusqu'à ${targetYear} pour « ${property.name} »`);
      } else if (result.blocking) {
        model.recordRun({
          propertyId: property.id, recipeId: recipe.id, recipeVersion: recipe.version,
          note: `Extension impossible : ${result.warnings.join(' ') || 'conflit'}`, blocking: 1,
        });
        console.warn(`[tariff-recipes] ${reason}: extension bloquée pour « ${property.name} »`);
      }
    } catch (err) {
      console.error(`[tariff-recipes] pass error (« ${property.name} »):`, err && err.message ? err.message : err);
    }
  }
}

module.exports = { runTariffRecipeHorizonPass };
