/**
 * The VAT regime of a sale (specs/vat-optional-mode.md rule 8). The ONE source of a VAT rate: every
 * reader of the rate asks `forRow` for the row it is working on, and no code outside this module reads
 * `app_settings.vatRate`.
 *
 * `forRow(db, row)` → `{ periodId, regime, rate, legalMention, legalMentionText }`. The row is whatever
 * the caller already holds (a reservation, a devis, an engine input); the module completes it.
 * A minimal test schema without the column or the row degrades to the historical default, 10 %.
 */

const DEFAULT_RATE = 10;

function appSettingsRate(db) {
  let row = null;
  try {
    row = db.prepare('SELECT vatRate FROM app_settings WHERE id = 1').get();
  } catch { /* column absent in a minimal test schema → the default */ }
  return row && row.vatRate != null ? Number(row.vatRate) : DEFAULT_RATE;
}

function forRow(db) {
  return {
    periodId: null,
    regime: 'subject',
    rate: appSettingsRate(db),
    legalMention: null,
    legalMentionText: null,
  };
}

function rateForRow(db, row) {
  return forRow(db, row).rate;
}

module.exports = { forRow, rateForRow, DEFAULT_RATE };
