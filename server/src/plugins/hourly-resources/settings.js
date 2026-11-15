/**
 * The `hourly-resources` settings (specs/resource-booking-pricing-and-invoicing.md rule 5, A1).
 *
 * `standaloneVatRate` — the VAT rate of a resource sold to a guest with no lodging reservation, in percent: 20 by
 * default, and a setting because the rate may change. An issued invoice keeps the rate it was issued with.
 */

const DEFAULT_STANDALONE_VAT_RATE = 20;

function validateRate(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text) || Number(text) > 100) return 'Taux de TVA : un nombre entre 0 et 100.';
  return null;
}

const SETTINGS = [{ key: 'standaloneVatRate', default: String(DEFAULT_STANDALONE_VAT_RATE), validate: validateRate }];

function standaloneVatRateOf(settings) {
  const raw = String(settings.get('standaloneVatRate') ?? '').trim().replace(',', '.');
  return validateRate(raw) ? DEFAULT_STANDALONE_VAT_RATE : Number(raw);
}

// Loop t1 B-3 — the rate typed on the catalogue for the `resources` class (`vat_external_rates`) wins over the plugin's setting, as the core's settings
// provider reads it: one rate for a session paid in the booking dialog and one sold at the visit's mini SAS.
function outsideVatRateOf(db, fallback) {
  try {
    const row = db.prepare("SELECT rate FROM vat_external_rates WHERE vatClass = 'resources'").get();
    if (row && Number.isFinite(Number(row.rate))) return Number(row.rate);
  } catch { /* a schema without the table: the plugin's setting */ }
  return fallback();
}

module.exports = {
  outsideVatRateOf, SETTINGS, standaloneVatRateOf, validateRate, DEFAULT_STANDALONE_VAT_RATE,
};
