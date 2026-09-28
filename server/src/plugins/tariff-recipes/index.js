/**
 * Recettes tarifaires (specs/tariff-recipes/spec.md; module per specs/plugins-phase-1-sdk.md).
 * A recipe generates a property's seasons, prices and closures; a daily pass extends the horizon.
 *
 * The recipe columns on `properties` and `pricing_rules` stay declared by the core, which prices with
 * them (rule 6); the plugin owns only its run journal. The tariff change journal is core data served
 * here under /api/tariff-recipes/journal.
 */

const express = require('express');
const sdk = require('../sdk');
const { createDefaultStore } = require('./store');
const { createTariffRecipeModel } = require('./model');
const { createController } = require('./controller');
const { runTariffRecipeHorizonPass } = require('./horizon');

const id = 'tariff-recipes';

function register(ctx) {
  ctx.migrations([{
    name: 'runs_table_v1',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tariff_recipe_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          propertyId INTEGER NOT NULL,
          recipeId TEXT NOT NULL,
          recipeVersion TEXT NOT NULL DEFAULT '',
          generatedYear INTEGER,
          note TEXT NOT NULL DEFAULT '',
          blocking INTEGER NOT NULL DEFAULT 0,
          createdAt TEXT DEFAULT (datetime('now')),
          dismissedAt TEXT,
          FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_tariff_recipe_runs_propertyId ON tariff_recipe_runs(propertyId)');
    },
  }]);

  let store = null;
  let model = null;
  const getStore = () => {
    if (!store) store = createDefaultStore(ctx.db.name);
    return store;
  };
  const getModel = () => {
    if (!model) model = createTariffRecipeModel(ctx.db, getStore());
    return model;
  };

  const controller = createController({
    db: ctx.db,
    store: getStore,
    model: getModel,
    properties: () => sdk.models.properties(ctx.db),
    journal: () => sdk.models.tariffJournal(ctx.db),
  });

  const router = express.Router();
  router.get('/', controller.list);
  router.get('/runs', controller.listRuns);
  router.post('/runs/:runId/dismiss', controller.dismissRun);
  // Declared BEFORE the `/:id` catch-all, which would otherwise swallow `/journal` as a recipe id.
  router.get('/journal', controller.listJournal);
  router.post('/journal', controller.createJournalEntry);
  router.delete('/journal/:eventId', controller.deleteJournalEntry);
  router.get('/:id', controller.getOne);
  ctx.mount('/api/tariff-recipes', router);

  ctx.route('get', '/api/properties/:id/tariff-recipe/preview', controller.previewForProperty);
  ctx.route('post', '/api/properties/:id/tariff-recipe/apply', controller.applyToProperty);
  ctx.route('post', '/api/properties/:id/tariff-recipe/detach', controller.detachFromProperty);

  // Daily; the boot pass 140 s after start so a restart never leaves an expiring horizon waiting.
  ctx.jobs.every({
    name: 'horizon',
    intervalMs: 24 * 60 * 60 * 1000,
    bootDelayMs: 140 * 1000,
    run: (reason = 'cron') => runTariffRecipeHorizonPass(reason, { model: getModel(), store: getStore(), database: ctx.db }),
  });

  // Rule 20 — only the recipe's hold on the properties goes: every season, price and closure stays,
  // and the seasons become manual. The tariff change journal is core data and is never erased.
  ctx.data({
    tables: ['tariff_recipe_runs'],
    describe: (db) => {
      const lines = [];
      const runs = db.prepare('SELECT COUNT(*) AS n FROM tariff_recipe_runs').get().n;
      if (runs > 0) lines.push({ label: runs > 1 ? `${runs} exécutions de recette` : '1 exécution de recette', count: runs });
      const attached = db.prepare("SELECT COUNT(*) AS n FROM properties WHERE tariffRecipeId != ''").get().n;
      if (attached > 0) {
        lines.push({
          label: attached > 1 ? `le rattachement de ${attached} logements à leur recette` : 'le rattachement d’un logement à sa recette',
          count: attached,
        });
      }
      return lines;
    },
    purge: (db) => {
      db.prepare("UPDATE properties SET tariffRecipeId = '', tariffRecipeVersion = ''").run();
      db.prepare('UPDATE pricing_rules SET seasonKey = NULL').run();
      model = null;
    },
  });
}

module.exports = { id, register };
