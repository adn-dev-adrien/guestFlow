/**
 * « Lit bébé » supplement option seeder (specs/baby-bed-supplement.md §5).
 *
 * Structural boot-time seed with the same contract as `cancellationInsuranceSeed.js`: idempotent,
 * non-destructive, re-run on every server start, keyed on `options.seedKey` so the operator can
 * rename, re-price and re-scope the article without the next boot inserting a duplicate beside it.
 *
 * What the seeded row carries:
 *   - `autoOptionType = 'baby_bed'` + `autoEnabled = 1` → the pricing engine derives the line itself
 *     from `reservations.babyBeds`; the option is never ticked by hand, and stays undeletable in the
 *     Options screen (every typed option is).
 *   - `priceType = 'per_stay'`, `price = 5` → 5 € per cot for the whole stay. The engine bills
 *     `price × babyBeds` whatever the price type says: a cot is never per-night or per-person
 *     (spec §3.1 rule 3). Re-pricing per logement goes through `property_option_prices`, and a
 *     per-property price of 0 is the documented way to opt a logement out (rule 4).
 *   - links to every property, re-applied on every boot so a property created later gets it too.
 *
 * Deliberately NO title adoption (unlike the insurance seed): flipping an operator-created « Lit
 * bébé » option to engine-managed would take it out of their hands and re-derive the quantity of
 * every reservation already carrying it. A look-alike row is reported instead, so Adrien can archive
 * it himself.
 *
 * Returns an `{ action, linked }` tag for the unit tests and the boot log.
 */

const SEED_KEY = 'baby_bed';
const AUTO_OPTION_TYPE = 'baby_bed';
const DEFAULT_PRICE = 5;

const SEED_DEFINITION = Object.freeze({
  seedKey: SEED_KEY,
  autoOptionType: AUTO_OPTION_TYPE,
  title: 'Lit bébé',
  titleEn: 'Baby cot',
  price: DEFAULT_PRICE,
  description: "Supplément facturé automatiquement pour chaque lit bébé de la réservation, pour l'ensemble du séjour.",
});

// Reported (never adopted) so a duplicate can't hide in the catalogue unnoticed.
const LOOK_ALIKE_TITLES = Object.freeze(['lit bébé', 'lit bebe', 'lits bébé', 'lits bebe']);

function ensureBabyBedSupplementOption(database, { logger = console } = {}) {
  try {
    const cols = database.prepare('PRAGMA table_info(options)').all().map((c) => c.name);
    if (!cols.includes('seedKey') || !cols.includes('autoOptionType') || !cols.includes('autoEnabled')) {
      // Schema not migrated yet — the next boot, after the columns are added, will seed.
      return { action: 'skipped-schema' };
    }
    const hasTitleEn = cols.includes('titleEn');

    // Either key identifies the row: `seedKey` for anything this seed created, `autoOptionType` for
    // the engine contract itself — so a row whose seedKey was wiped by hand is still never doubled.
    const findSeeded = database.prepare(
      'SELECT id FROM options WHERE seedKey = ? OR autoOptionType = ? ORDER BY id LIMIT 1',
    );
    const stampSeedKey = database.prepare(
      "UPDATE options SET seedKey = ? WHERE id = ? AND (seedKey IS NULL OR seedKey = '')",
    );
    const insert = database.prepare(hasTitleEn
      ? `INSERT INTO options (
           title, titleEn, description, priceType, price, optionProgressiveTiers,
           autoOptionType, autoEnabled, autoPricingMode, countsAsBedLinen, countsAsBathroomLinen,
           displayToClient, seedKey
         ) VALUES (?, ?, ?, 'per_stay', ?, '[]', ?, 1, 'fixed', 0, 0, 1, ?)`
      : `INSERT INTO options (
           title, description, priceType, price, optionProgressiveTiers,
           autoOptionType, autoEnabled, autoPricingMode, countsAsBedLinen, countsAsBathroomLinen,
           displayToClient, seedKey
         ) VALUES (?, ?, 'per_stay', ?, '[]', ?, 1, 'fixed', 0, 0, 1, ?)`);
    const link = database.prepare(
      'INSERT OR IGNORE INTO property_options (propertyId, optionId) VALUES (?, ?)',
    );
    const lookAlikePlaceholders = LOOK_ALIKE_TITLES.map(() => '?').join(', ');
    const findLookAlikes = database.prepare(`
      SELECT id, title FROM options
       WHERE LOWER(TRIM(title)) IN (${lookAlikePlaceholders})
         AND (autoOptionType IS NULL OR autoOptionType != ?)
       ORDER BY id
    `);

    let action = 'skipped-already-seeded';
    let linked = 0;
    let lookAlikes = [];

    const tx = database.transaction(() => {
      // NOTE: no `archivedAt IS NULL` filter — an archived supplement counts as present, so
      // archiving stays the permanent way to retire it.
      let row = findSeeded.get(SEED_KEY, AUTO_OPTION_TYPE);
      if (!row) {
        const res = hasTitleEn
          ? insert.run(
            SEED_DEFINITION.title, SEED_DEFINITION.titleEn, SEED_DEFINITION.description,
            SEED_DEFINITION.price, AUTO_OPTION_TYPE, SEED_KEY,
          )
          : insert.run(
            SEED_DEFINITION.title, SEED_DEFINITION.description,
            SEED_DEFINITION.price, AUTO_OPTION_TYPE, SEED_KEY,
          );
        action = 'seeded';
        row = { id: Number(res.lastInsertRowid) };
      } else {
        stampSeedKey.run(SEED_KEY, row.id);
      }

      // Runs on every boot, not just on insert: a property created after the first seed run must
      // still offer the cot. Unlinking a logement therefore does NOT stick — the documented opt-out
      // is a per-property price of 0 (spec §3.1 rule 4), which removes the line entirely.
      const propertyIds = database.prepare('SELECT id FROM properties').all().map((r) => r.id);
      for (const propertyId of propertyIds) {
        linked += link.run(propertyId, row.id).changes;
      }

      lookAlikes = findLookAlikes.all(...LOOK_ALIKE_TITLES, AUTO_OPTION_TYPE);
    });
    tx();

    if (action !== 'skipped-already-seeded') {
      logger.log(`[seed:baby-bed] ${action} (linked ${linked} property row(s))`);
    }
    if (lookAlikes.length > 0) {
      logger.warn(
        `[seed:baby-bed] ${lookAlikes.length} untyped option(s) named like a cot left untouched `
        + `(id ${lookAlikes.map((r) => r.id).join(', ')}) — archive them to avoid billing twice`,
      );
    }
    return { action, linked, lookAlikes: lookAlikes.map((r) => Number(r.id)) };
  } catch (error) {
    console.error(`[seed:baby-bed] failed: ${error.message}`);
    return { action: 'error', error: error.message };
  }
}

module.exports = {
  ensureBabyBedSupplementOption,
  SEED_DEFINITION,
  SEED_KEY,
  AUTO_OPTION_TYPE,
  DEFAULT_PRICE,
  LOOK_ALIKE_TITLES,
};
