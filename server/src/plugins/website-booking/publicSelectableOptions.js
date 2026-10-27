/**
 * The options a visitor may choose for a property — what `GET /properties/:id/options` lists, and
 * the only ids `POST /quote` and `POST /booking-requests` accept (specs/public-api.md rule 14: until
 * the 2026-10-27 audit they accepted any option applicable to the property, internal-only and
 * negative-priced ones included).
 */

const sdk = require('../sdk');

const { isClientVisibleOption } = sdk.coreModule('optionVisibility');

/**
 * Option ids that are OFFERED defaults for a property — included in the price, not a client choice,
 * so they must not surface as selectable on the public booking form
 * (specs/property-default-option-applicability.md rule 4). Guarded for schemas without the table.
 */
function offeredDefaultOptionIds(db, propertyId) {
  try {
    return new Set(
      db.prepare('SELECT optionId FROM property_option_defaults WHERE propertyId = ? AND offered = 1')
        .all(Number(propertyId)).map((row) => Number(row.optionId))
    );
  } catch { return new Set(); }
}

/**
 * Model rows (unprojected) of the options a visitor may pick, in the model's order. The caller hands
 * in its own `db` and `optionsModel`, the ones it reached through the SDK.
 */
function publicSelectableOptions(propertyId, { db, optionsModel }) {
  const excluded = offeredDefaultOptionIds(db, propertyId);
  return optionsModel.listForProperty(Number(propertyId))
    .filter((opt) => !excluded.has(Number(opt.id)))
    // Internal-only options (specs/laundry-bath-mat.md §3 rule 11) never reach the public catalog.
    // Filtered BEFORE grouping so a category whose options are all internal yields no group at all
    // (specs/option-categories.md §3 rule 14).
    .filter(isClientVisibleOption)
    // A visitor never picks a price reduction.
    .filter((opt) => !(Number(opt.price) < 0));
}

module.exports = { publicSelectableOptions };
