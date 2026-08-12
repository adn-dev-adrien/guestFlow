#!/usr/bin/env node
/**
 * Aventura Lodge — 2026 all-inclusive tariff, production configuration
 * (specs/tariff-recipes/architecture.md §6).
 *
 * Handles ONLY what a recipe deliberately does not cover (spec §3.1 rule 6):
 *   - the property fields (occupancy, check-in/out, deposit, extra-guest price + unit);
 *   - the platform commissions (global per platform);
 *   - the linen / cleaning options as property defaults marked « offered » (→ `includedInRate`,
 *     deducted from the tourist-tax base — they are KEPT, never deleted: the laundry engine counts
 *     linen from the ticked option);
 *   - the welcome-pack option, likewise included in the rate.
 * Then it sets `tariffRecipeId` and calls `tariffRecipeModel.apply()` — the seasons, their ranges
 * and the winter closures come from the ONE calendar implementation the UI and the scheduled task
 * also use. This script never re-derives a date.
 *
 * Safety: dry run by default (prints the diff), `--apply` required to write; every write is an
 * upsert keyed on a natural key (property name, option title) so a second run is a no-op and a
 * partial run is safe to resume; scoped to ONE property by name so a typo cannot reach the Gîte.
 * Take a backup before the first `--apply` (scripts/backup-from-pi.sh).
 *
 * Usage:
 *   node scripts/configure-aventura-lodge-2026.mjs                 # dry run
 *   node scripts/configure-aventura-lodge-2026.mjs --apply
 *   DB_PATH=/path/to/guestflow.db node scripts/configure-aventura-lodge-2026.mjs --apply
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(pathToFileURL(path.join(ROOT, 'server', 'src', 'index.js')));

const APPLY = process.argv.includes('--apply');
const PROPERTY_NAME = 'Aventura lodge';
// specs/tariff-recipes/spec.md §3.9 — the own-channel welcome pack: breakfast for 2 on the first
// morning + a 1 L bottle of Pressoir du Pilat apple juice. 25 € of displayed value = 2 × 10 € + 5 €,
// which is why the Lodge charges 10 € a breakfast where the catalogue says 8 € (the Gîte keeps 8 €).
// `unitPrice: null` = keep the catalogue price. Matching is by title substring, lowercased: « jus de
// pomme 1l » is deliberately that precise so it cannot catch the 25 cl bottle or the pomme-kiwi.
const WELCOME_PACK = [
  { label: 'Petit déjeuner', match: 'petit déjeuner', freeUnits: 2, unitPrice: 10 },
  { label: 'Jus de pomme 1L', match: 'jus de pomme 1l', freeUnits: 1, unitPrice: null },
];
const RECIPE_ID = 'aventura-lodge-2026';

// Property fields the recipe does not own (spec §3.1 rule 6, §3.6 rule 35, §3.7 rule 41).
const PROPERTY_FIELDS = {
  maxAdults: 5,
  maxChildren: 0,
  maxBabies: 1,
  singleBeds: 3,
  doubleBeds: 1,
  basePriceIncludedGuests: 2,
  // Fallback only: the recipe writes the 15/8 tier table onto every season, and the tiers win.
  // 15 € — the first-night price — is what a night not covered by any season would charge, which is
  // the conservative direction for a state that already means « the calendar has a hole ».
  extraGuestPrice: 15,
  extraGuestPriceUnit: 'per_night',
  defaultCheckIn: '16:00',
  defaultCheckOut: '10:00',
  defaultCautionAmount: 400,
};

// Global per-platform commissions (spec §3.6 rule 34). Direct carries the Lodgify booking-engine fee.
const COMMISSIONS = {
  direct: 5,
  abracadaroom: 20,
  airbnb: 15.5,
  booking: 15,
  greengo: 14.5,
  abritel: 13,
  'gîtes de france': 0,
  'gites de france': 0,
};

// Options included in the rate on this property (spec §3.8 rules 47-50). They stay chargeable in the
// catalogue; the property DEFAULT marks them offered → « Comprise ». Titles are the real ones on the
// Lodge: no speculative alias, or a missing alias reports as missing work when nothing is missing.
// The welcome pack is NOT here — it is included by the unit (WELCOME_PACK), not by the whole line.
const INCLUDED_OPTION_TITLES = ['ménage', 'linge de lit', 'linge de toilette'];

function log(...args) { console.log(...args); }

function main() {
  const db = require(path.join(ROOT, 'server', 'src', 'database.js'));
  const { getDefaultStore } = require(path.join(ROOT, 'server', 'src', 'utils', 'tariffRecipe.js'));
  const { createTariffRecipeModel } = require(path.join(ROOT, 'server', 'src', 'models', 'tariffRecipeModel.js'));

  log(`Base : ${db.dbPath}`);
  log(APPLY ? '⚠️  MODE ÉCRITURE (--apply)' : 'Mode simulation — relancer avec --apply pour écrire.');
  log('');

  // ── 1. The property ───────────────────────────────────────────────────────
  const property = db.prepare('SELECT * FROM properties WHERE lower(name) = lower(?)').get(PROPERTY_NAME);
  if (!property) {
    const names = db.prepare('SELECT name FROM properties ORDER BY name').all().map((p) => p.name);
    console.error(`❌ Logement « ${PROPERTY_NAME} » introuvable. Logements présents : ${names.join(', ') || '(aucun)'}`);
    process.exit(1);
  }
  log(`Logement : « ${property.name} » (id ${property.id})`);

  const fieldDiff = Object.entries(PROPERTY_FIELDS)
    .filter(([key, value]) => String(property[key] ?? '') !== String(value))
    .map(([key, value]) => `    ${key} : ${property[key] ?? '—'} → ${value}`);
  if (fieldDiff.length) {
    log('  Champs à mettre à jour :');
    fieldDiff.forEach((line) => log(line));
  } else {
    log('  Champs : déjà conformes.');
  }
  if (APPLY && fieldDiff.length) {
    const assignments = Object.keys(PROPERTY_FIELDS).map((key) => `${key} = @${key}`).join(', ');
    db.prepare(`UPDATE properties SET ${assignments}, updatedAt = datetime('now') WHERE id = @id`)
      .run({ ...PROPERTY_FIELDS, id: property.id });
  }

  // ── 2. Platform commissions ───────────────────────────────────────────────
  log('');
  log('Commissions plateformes :');
  const platforms = db.prepare('SELECT id, name, COALESCE(commissionPercent, 0) AS commissionPercent FROM platforms').all();
  for (const platform of platforms) {
    const target = COMMISSIONS[String(platform.name).toLowerCase()];
    if (target === undefined) { log(`    ${platform.name} : (hors périmètre, inchangée)`); continue; }
    if (Number(platform.commissionPercent) === target) { log(`    ${platform.name} : ${target} % (déjà)`); continue; }
    log(`    ${platform.name} : ${platform.commissionPercent} % → ${target} %`);
    if (APPLY) db.prepare('UPDATE platforms SET commissionPercent = ? WHERE id = ?').run(target, platform.id);
  }
  const missing = Object.keys(COMMISSIONS)
    .filter((name) => !platforms.some((p) => String(p.name).toLowerCase() === name))
    .filter((name) => !name.startsWith('gites')); // the accent-less alias is a lookup convenience
  if (missing.length) log(`    ⚠️  Absentes de la table platforms : ${missing.join(', ')}`);

  // ── 3. Options included in the rate ───────────────────────────────────────
  log('');
  log('Options comprises dans le tarif :');
  // Archived options are out of the catalogue and internal ones (« Tapis de bain ») are laundry
  // counters a reservation never carries — marking either « included » would put a phantom line on
  // every fiche. A stale default on one is also cleared below.
  const linkedOptions = db.prepare(`
    SELECT o.id, o.title, COALESCE(d.offered, -1) AS offered
    FROM options o
    JOIN property_options po ON po.optionId = o.id AND po.propertyId = ?
    LEFT JOIN property_option_defaults d ON d.optionId = o.id AND d.propertyId = ?
    WHERE o.archivedAt IS NULL AND COALESCE(o.displayToClient, 1) != 0
    ORDER BY o.title
  `).all(property.id, property.id);

  const staleDefaults = db.prepare(`
    SELECT o.id, o.title, o.archivedAt, o.displayToClient
    FROM property_option_defaults d
    JOIN options o ON o.id = d.optionId
    WHERE d.propertyId = ? AND (o.archivedAt IS NOT NULL OR COALESCE(o.displayToClient, 1) = 0)
  `).all(property.id);
  for (const stale of staleDefaults) {
    const why = stale.archivedAt ? 'archivée' : 'interne (compteur blanchisserie)';
    log(`    ${stale.title} : défaut retiré — option ${why}`);
    if (APPLY) {
      db.prepare('DELETE FROM property_option_defaults WHERE propertyId = ? AND optionId = ?')
        .run(property.id, stale.id);
    }
  }
  for (const option of linkedOptions) {
    const shouldInclude = INCLUDED_OPTION_TITLES.some((needle) => option.title.toLowerCase().includes(needle));
    if (!shouldInclude) continue;
    if (Number(option.offered) === 1) { log(`    ${option.title} : déjà « Comprise »`); continue; }
    log(`    ${option.title} : ${option.offered === -1 ? 'aucun défaut' : 'défaut facturé'} → « Comprise » (offerte par défaut)`);
    if (APPLY) {
      db.prepare(`
        INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (?, ?, 1)
        ON CONFLICT(propertyId, optionId) DO UPDATE SET offered = 1
      `).run(property.id, option.id);
    }
  }
  const notFound = INCLUDED_OPTION_TITLES
    .filter((needle) => !linkedOptions.some((o) => o.title.toLowerCase().includes(needle)));
  if (notFound.length) {
    log(`    ⚠️  Options non trouvées sur ce logement : ${notFound.join(', ')}`);
    log('        (à créer/rattacher à la main — le script ne crée jamais d\'option)');
  }

  // ── 3bis. Welcome pack: the units the rate covers on own-channel bookings ──
  log('');
  log('Pack accueil (direct + Lodgify) :');
  for (const item of WELCOME_PACK) {
    const option = linkedOptions.find((o) => o.title.toLowerCase().includes(item.match));
    if (!option) {
      log(`    ⚠️  Option « ${item.label} » introuvable sur ce logement — à rattacher à la main.`);
      continue;
    }
    // A per-property price row means « this property charges THIS », so creating one just to carry
    // the free units must copy the catalogue price — writing 0 would make the option free.
    const catalogPrice = Number(db.prepare('SELECT price FROM options WHERE id = ?').get(option.id)?.price ?? 0);
    const current = db.prepare('SELECT price, freeUnits FROM property_option_prices WHERE propertyId = ? AND optionId = ?')
      .get(property.id, option.id);
    const currentPrice = current?.price != null ? Number(current.price) : catalogPrice;
    const currentFree = Number(current?.freeUnits || 0);
    const targetPrice = item.unitPrice ?? currentPrice;
    if (currentPrice === targetPrice && currentFree === item.freeUnits) {
      log(`    ${option.title} : ${targetPrice} €, ${item.freeUnits} offert(s) (déjà)`);
      continue;
    }
    log(`    ${option.title} : ${currentPrice} € → ${targetPrice} €, ${currentFree} → ${item.freeUnits} offert(s)`);
    if (APPLY) {
      db.prepare(`
        INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(propertyId, optionId) DO UPDATE SET price = excluded.price, freeUnits = excluded.freeUnits
      `).run(property.id, option.id, targetPrice, item.freeUnits);
    }
  }
  log('        Le client commande tout ce qu\'il veut : seules les unités au-delà des offertes');
  log('        sont facturées, et le SAS prépare toujours la totalité.');

  // ── 4. The recipe: seasons, ranges, closures ──────────────────────────────
  log('');
  const store = getDefaultStore();
  const recipe = store.getRecipe(RECIPE_ID);
  if (!recipe) {
    console.error(`❌ Recette « ${RECIPE_ID} » introuvable. Recettes chargées : ${store.listRecipes().map((r) => r.id).join(', ') || '(aucune)'}`);
    process.exit(1);
  }
  const model = createTariffRecipeModel(db, store);
  const diff = model.preview(property.id, RECIPE_ID);
  log(`Recette « ${recipe.label} » v${recipe.version} — horizon ${diff.horizon.fromYear} → ${diff.horizon.toYear}`);
  for (const season of diff.seasons) {
    if (season.action === 'unchanged') { log(`    ${season.label} : inchangée`); continue; }
    log(`    ${season.label} : ${season.action}${season.adopted ? ' (saison manuelle adoptée)' : ''}`);
    // Some fields hold arrays (the extra-guest tier table); `${[]}` renders them as
    // « [object Object] », which tells the operator nothing about what is being written.
    const show = (v) => {
      if (v === null || v === undefined || v === '') return '—';
      return Array.isArray(v) ? JSON.stringify(v) : String(v);
    };
    season.fieldChanges.forEach((c) => log(`        ${c.field} : ${show(c.from)} → ${show(c.to)}`));
    season.rangesAdded.forEach((r) => log(`        + ${r.startDate} → ${r.endDate}`));
    season.rangesRemoved.forEach((r) => log(`        − ${r.startDate} → ${r.endDate}`));
  }
  diff.closures.added.forEach((c) => log(`    + fermeture ${c.startDate} → ${c.endDate}`));
  diff.warnings.forEach((w) => log(`    ⚠️  ${w}`));

  if (diff.blocking) {
    console.error('');
    console.error('❌ Application bloquée — corriger les points ci-dessus avant de relancer. Rien n\'a été écrit pour les saisons.');
    process.exit(2);
  }
  if (APPLY) {
    const result = model.apply(property.id, RECIPE_ID);
    log(result.applied ? '    ✅ Recette appliquée.' : '    (rien à faire — déjà conforme)');
  }

  log('');
  log(APPLY ? '✅ Terminé.' : 'Simulation terminée — relancer avec --apply pour écrire.');
}

main();
