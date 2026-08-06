/**
 * Catering catalogue seeder — « Boissons » + « Restauration » (specs/option-categories.md §3
 * rules 21-26, §5.2, §5.4).
 *
 * Structural boot-time seed with the same contract as `bedLinenSeed.js` / `breakfastSeed.js`:
 * idempotent, non-destructive, re-run on every server start, re-creating any row that went
 * missing. It differs from those on one point only — identity.
 *
 * The linen and breakfast seeds are singletons, so `autoOptionType` can key them. This family is
 * 14 distinct rows with no engine behaviour, so it keys on `options.seedKey` instead. Keying on
 * the title would be a trap: the operator is meant to re-price and re-word these articles, and a
 * title-keyed seed would read a renamed row as "missing" and insert a duplicate beside it on the
 * next boot. `seedKey` survives every edit.
 *
 * Three escape hatches, in decreasing order of gentleness:
 *   - **Edit** (title, description, price) — always sticks; the seed only ever inserts what is
 *     absent, it never re-asserts the definition onto an existing row.
 *   - **Archive** (`archivedAt`) — sticks. The lookup deliberately ignores `archivedAt`, so an
 *     archived article is seen as present and is never resurrected. Same behaviour as the linen
 *     seed, and the supported way to retire an article.
 *   - **Delete** — does NOT stick: the row comes back on the next boot. The admin UI disables
 *     hard-delete on seeded rows for exactly that reason (rule 25).
 *
 * Adoption path: an option whose title matches a definition but carries no `seedKey` (a row the
 * operator created by hand before this shipped) is adopted rather than duplicated — the same
 * defensive strategy as `KNOWN_TITLE_ALIASES` in the linen seeds.
 *
 * Returns a `{ action, inserted, adopted, linked }` tag for the unit tests and the boot log.
 */

const DRINKS_CATEGORY = 'Boissons';
const CATERING_CATEGORY = 'Restauration';

// Prices are the SELLING prices of the price list (specs/option-categories.md §5.4 — column 6 of
// Adrien's sheet, the bold amounts). The cost, VAT and margin columns are not tracked by GuestFlow.
// Producer names are carried into the description: the price list groups drinks into three
// sub-families (bières / jus / champagne) and we collapse them into one category, so the origin
// would otherwise be lost.
const SEED_DEFINITIONS = Object.freeze([
  // ---- Boissons — Bières locales (Brasserie du Pilat, St Julien Molin Molette) ----
  {
    seedKey: 'drink_blonde_pilat_75',
    title: 'Blonde du Pilat 75cl - 4,5°',
    description: 'Bière blonde bio — Brasserie du Pilat, St Julien Molin Molette',
    price: 6.5,
    category: DRINKS_CATEGORY,
  },
  {
    seedKey: 'drink_biscanna_75',
    title: 'Biscanna 75cl - 5°',
    description: 'Blonde chanvrée bio — Brasserie du Pilat, St Julien Molin Molette',
    price: 7.5,
    category: DRINKS_CATEGORY,
  },
  {
    seedKey: 'drink_madmax_75',
    title: 'Mad Max 75cl - 5,5°',
    description: 'Ambrée bio — Brasserie du Pilat, St Julien Molin Molette',
    price: 7.5,
    category: DRINKS_CATEGORY,
  },
  // ---- Boissons — Jus de fruits (Pressoir du Pilat, Maclas) ----
  {
    seedKey: 'drink_jus_pomme_1l',
    title: 'Jus de pomme 1L',
    description: '3 pommes - bouteille 1L — Pressoir du Pilat, Maclas',
    price: 5,
    category: DRINKS_CATEGORY,
  },
  {
    seedKey: 'drink_jus_poire_1l',
    title: 'Jus de poire William\'s 1L',
    description: 'Bouteille 1L — Pressoir du Pilat, Maclas',
    price: 6,
    category: DRINKS_CATEGORY,
  },
  {
    seedKey: 'drink_jus_pomme_kiwi_1l',
    title: 'Jus pomme-kiwi 1L',
    description: 'Bouteille 1L — Pressoir du Pilat, Maclas',
    price: 5.5,
    category: DRINKS_CATEGORY,
  },
  {
    seedKey: 'drink_jus_pomme_25cl',
    title: 'Jus de pomme 25cl',
    description: 'Petit format (unité) — Pressoir du Pilat, Maclas',
    price: 3,
    category: DRINKS_CATEGORY,
  },
  // ---- Boissons — Champagne ----
  {
    seedKey: 'drink_champagne_75',
    title: 'Champagne - bouteille 75cl',
    description: 'Bouteille standard',
    price: 40,
    category: DRINKS_CATEGORY,
  },
  {
    seedKey: 'drink_champagne_37',
    title: 'Champagne - demi-bouteille 37,5cl',
    description: 'Demi-bouteille',
    price: 25,
    category: DRINKS_CATEGORY,
  },
  // ---- Restauration — Planches apéro (Terroir Ardèche) ----
  {
    seedKey: 'board_s',
    title: 'Planche S — 1-2 pers. (Apéro Solo/Duo)',
    description: 'Saucisson 80g + caillette + fromage + pain + chutney — Terroir Ardèche',
    price: 17,
    category: CATERING_CATEGORY,
  },
  {
    seedKey: 'board_m',
    title: 'Planche M — 2-3 pers. (Apéro Couple)',
    description: 'Saucisson 150g + caillette + châtaignade + fromage + pain + chutney — Terroir Ardèche',
    price: 32,
    category: CATERING_CATEGORY,
  },
  {
    seedKey: 'board_l',
    title: 'Planche L — 4 pers. (Apéro Famille)',
    description: 'Saucisson 250g + pâté Ardéchoise + caillette + châtaignade + 2 fromages + pain + chutney + olives — Terroir Ardèche',
    price: 52,
    category: CATERING_CATEGORY,
  },
  {
    seedKey: 'board_xl',
    title: 'Planche XL — 6-7 pers. (Apéro Tribu)',
    description: '2 saucissons + 2 pâtés + caillette + 2 verrines + 3 fromages + pain + condiments — Terroir Ardèche',
    price: 78,
    category: CATERING_CATEGORY,
  },
  {
    seedKey: 'board_xxl',
    title: 'Planche XXL — 10-12 pers. (Apéro Gîte)',
    description: '3 saucissons + 2 pâtés + 2 caillettes + 2 verrines + 5 fromages + pain + condiments — Terroir Ardèche',
    price: 115,
    category: CATERING_CATEGORY,
  },
]);

function ensureCateringOptions(database, { logger = console } = {}) {
  try {
    const cols = database.prepare('PRAGMA table_info(options)').all().map((c) => c.name);
    if (!cols.includes('category') || !cols.includes('seedKey')) {
      // Schema not migrated yet — silent return; the column migration runs before us on a normal
      // boot, and the next start seeds. No log line on every restart.
      return { action: 'skipped-schema' };
    }

    const findBySeedKey = database.prepare('SELECT id FROM options WHERE seedKey = ? LIMIT 1');
    // Adoption lookup — deliberately excludes rows that already carry a seedKey so two definitions
    // can never fight over the same row.
    const findByTitle = database.prepare(`
      SELECT id FROM options
       WHERE LOWER(TRIM(title)) = ? AND (seedKey IS NULL OR seedKey = '')
       LIMIT 1
    `);
    const adopt = database.prepare('UPDATE options SET seedKey = ?, category = ? WHERE id = ?');
    const insert = database.prepare(`
      INSERT INTO options (
        title, description, priceType, price, optionProgressiveTiers,
        autoEnabled, autoPricingMode, countsAsBedLinen, countsAsBathroomLinen,
        displayToClient, category, seedKey
      ) VALUES (?, ?, 'per_stay', ?, '[]', 0, 'fixed', 0, 0, 1, ?, ?)
    `);
    const link = database.prepare(
      'INSERT OR IGNORE INTO property_options (propertyId, optionId) VALUES (?, ?)',
    );

    let inserted = 0;
    let adopted = 0;
    let linked = 0;

    const tx = database.transaction(() => {
      const propertyIds = database.prepare('SELECT id FROM properties').all().map((r) => r.id);
      for (const def of SEED_DEFINITIONS) {
        // NOTE: no `archivedAt IS NULL` filter — an archived article counts as present, so
        // archiving is the permanent way to retire one (rule 25).
        let row = findBySeedKey.get(def.seedKey);
        if (!row) {
          const candidate = findByTitle.get(def.title.trim().toLowerCase());
          if (candidate) {
            adopt.run(def.seedKey, def.category, candidate.id);
            adopted += 1;
            row = candidate;
          }
        }
        if (!row) {
          const res = insert.run(
            def.title, def.description, def.price, def.category, def.seedKey,
          );
          inserted += 1;
          row = { id: res.lastInsertRowid };
        }
        // Runs on every boot, not just on insert: a property created after the first seed run must
        // still get the whole catering catalogue attached to it.
        for (const propertyId of propertyIds) {
          linked += link.run(propertyId, row.id).changes;
        }
      }
    });
    tx();

    if (inserted > 0 || adopted > 0) {
      logger.log(`[seed:catering] seeded ${inserted} option(s), adopted ${adopted}, linked ${linked} property row(s)`);
    }
    return {
      action: inserted > 0 ? 'seeded' : (adopted > 0 ? 'promoted-adopted' : 'skipped-already-seeded'),
      inserted,
      adopted,
      linked,
    };
  } catch (error) {
    console.error(`[seed:catering] failed: ${error.message}`);
    return { action: 'error', error: error.message };
  }
}

module.exports = {
  ensureCateringOptions,
  SEED_DEFINITIONS,
  DRINKS_CATEGORY,
  CATERING_CATEGORY,
};
