// Tariff recipes controller — thin handlers over the recipe store + tariffRecipeModel
// (specs/tariff-recipes/spec.md §3.5). Read-only browser + property-scoped preview/apply +
// the scheduled-run journal the Dashboard consumes.

const db = require('../database');
const { getDefaultStore } = require('../utils/tariffRecipe');
const { getDefaultModel } = require('../models/tariffRecipeModel');

function list(req, res) {
  const store = getDefaultStore();
  const usedBy = db.prepare(
    "SELECT id, name, tariffRecipeId, tariffRecipeVersion FROM properties WHERE tariffRecipeId != ''"
  ).all();
  const recipes = store.listRecipes().map((recipe) => ({
    ...recipe,
    usedByProperties: usedBy
      .filter((p) => p.tariffRecipeId === recipe.id)
      .map((p) => ({ id: p.id, name: p.name, appliedVersion: p.tariffRecipeVersion })),
  }));
  res.json({ recipes, invalid: store.listInvalidRecipes() });
}

function getOne(req, res) {
  const recipe = getDefaultStore().getRecipe(req.params.id);
  if (!recipe) return res.status(404).json({ error: 'Recette introuvable' });
  return res.json({ recipe, meta: getDefaultStore().getRecipeMeta(req.params.id) });
}

function previewForProperty(req, res) {
  const recipeId = String(req.query.recipeId || '');
  if (!recipeId) return res.status(400).json({ error: 'recipeId requis' });
  res.json(getDefaultModel().preview(req.params.id, recipeId));
}

function applyToProperty(req, res) {
  const recipeId = String(req.body?.recipeId || '');
  if (!recipeId) return res.status(400).json({ error: 'recipeId requis' });
  const result = getDefaultModel().apply(req.params.id, recipeId);
  if (result.blocking) return res.status(409).json(result);
  return res.json(result);
}

// Detach: the property keeps its seasons verbatim, only the pointer is cleared
// (the « Recette introuvable → détacher » escape hatch of spec §3 edge cases).
function detachFromProperty(req, res) {
  const propertiesModel = require('../models/propertiesModel');
  propertiesModel.setTariffRecipe(req.params.id, '', '');
  res.json({ ok: true });
}

function listRuns(req, res) {
  res.json({ runs: getDefaultModel().listPendingRuns() });
}

function dismissRun(req, res) {
  const ok = getDefaultModel().dismissRun(req.params.runId);
  if (!ok) return res.status(404).json({ error: 'Alerte introuvable' });
  return res.json({ ok: true });
}

module.exports = { list, getOne, previewForProperty, applyToProperty, detachFromProperty, listRuns, dismissRun };
