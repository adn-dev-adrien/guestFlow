/**
 * One-shot migration: the arrival SAS's « Ménage » / « Linge de toilette » upsells move from custom
 * lines to the real catalogue option.
 *
 * specs/sas-upsells-activate-catalogue-option.md §3.4. Until now `commitArrivalSas` wrote both
 * upsells as `reservation_custom_options` rows (French label, `sasArrivalOrigin = 1`). A custom line
 * is invisible to the laundry + linen-stock aggregators, which count bath linen through
 * `reservation_options → options WHERE countsAsBathroomLinen = 1` (laundryModel / linenInventory), so
 * the towels sold at check-in were never prepared nor deducted from the stock.
 *
 * Each matching custom row becomes a `reservation_options` row on the catalogue option, carrying:
 *   - `inComplement = 1`   — it stays collected in the arrival complement, exactly as before;
 *   - `sasArrivalOrigin = 1` — the SAS keeps the right to remove what it added;
 *   - `totalPrice` = the stored amount **verbatim**. A past stay is never re-quoted: the guest was
 *     charged that amount, so `unitPrice`/`billedUnits` are DERIVED from it (billedUnits from the
 *     option's price type, unitPrice = amount / billedUnits) rather than recomputed from the catalogue.
 *
 * A reservation that ALREADY carries the catalogue option is skipped (both rows kept) — deleting its
 * custom line would silently lower what the guest owes. The caller logs the skipped ids for review.
 *
 * Idempotent: once migrated there is no `sasArrivalOrigin = 1` custom row left to match, so a re-run
 * moves nothing. Pure (takes the db handle); the caller wraps it in a transaction + migration flag.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ migrated: number, skipped: number[] }}
 */

const { isCleaningOption, normalizeOptionName } = require('./cleaningOption');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Billed units the option would carry for this reservation — the same shape the pricing engine uses
// (`getTypeMultiplier`), kept local so the migration never depends on a live quote.
function billedUnitsFor(priceType, persons, nights) {
  if (priceType === 'per_person') return persons;
  if (priceType === 'per_night') return nights;
  if (priceType === 'per_person_per_night') return persons * nights;
  return 1;
}

function runSasUpsellOptionMigration(db) {
  let targets;
  try {
    targets = db.prepare("SELECT id, title, priceType, autoOptionType FROM options WHERE autoOptionType IN ('cleaning', 'bathroom_linen')").all();
  } catch {
    return { migrated: 0, skipped: [] };          // minimal schema — nothing to migrate
  }
  if (targets.length === 0) return { migrated: 0, skipped: [] };

  let customRows;
  try {
    customRows = db.prepare(`
      SELECT rco.id, rco.reservationId, rco.description, rco.amount,
             r.adults, r.teens, r.children,
             (SELECT COUNT(*) FROM reservation_nights rn WHERE rn.reservationId = r.id) AS nights
        FROM reservation_custom_options rco
        JOIN reservations r ON r.id = rco.reservationId
       WHERE COALESCE(rco.sasArrivalOrigin, 0) = 1
    `).all();
  } catch {
    return { migrated: 0, skipped: [] };
  }

  // Match a custom line to its catalogue option: the cleaning by the shared « ménage » matcher, the
  // bath linen by the option's own title (that is the label commitArrivalSas wrote).
  const bathLinen = targets.find((o) => o.autoOptionType === 'bathroom_linen');
  const cleaning = targets.find((o) => o.autoOptionType === 'cleaning');
  const matchOption = (description) => {
    if (cleaning && isCleaningOption({ title: description })) return cleaning;
    if (bathLinen && normalizeOptionName(description) === normalizeOptionName(bathLinen.title)) return bathLinen;
    return null;
  };

  const hasOption = db.prepare('SELECT 1 FROM reservation_options WHERE reservationId = ? AND optionId = ?');
  const insertOption = db.prepare(`
    INSERT INTO reservation_options
      (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement, sasArrivalOrigin)
    VALUES (?, ?, 1, ?, ?, ?, ?, 0, 1, 1)
  `);
  const deleteCustom = db.prepare('DELETE FROM reservation_custom_options WHERE id = ?');

  let migrated = 0;
  const skipped = [];
  for (const row of customRows) {
    const option = matchOption(row.description);
    if (!option) continue;                        // linen elements & operator lines: untouched
    if (hasOption.get(row.reservationId, option.id)) {
      skipped.push(Number(row.reservationId));
      continue;
    }
    const priceType = option.priceType || 'per_stay';
    const persons = (Number(row.adults) || 0) + (Number(row.teens) || 0) + (Number(row.children) || 0);
    const units = Math.max(1, billedUnitsFor(priceType, persons, Number(row.nights) || 0));
    const totalPrice = round2(row.amount);
    insertOption.run(row.reservationId, option.id, round2(totalPrice / units), units, priceType, totalPrice);
    deleteCustom.run(row.id);
    migrated += 1;
  }
  return { migrated, skipped };
}

module.exports = { runSasUpsellOptionMigration };
