// specs/plugin-removal-resilience.md rule 11 — a recipe applied to the property: its run.
module.exports = {
  seed(db, { stays }) {
    db.prepare("INSERT INTO tariff_recipe_runs (propertyId, recipeId, recipeVersion, generatedYear, note) VALUES (?, 'removal-recipe', '1.0.0', 2030, 'removal seed')").run(stays.direct.propertyId);
  },
};
