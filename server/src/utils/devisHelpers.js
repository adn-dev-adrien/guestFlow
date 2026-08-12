/**
 * Pure money / date / format helpers shared by the devis model, controller and PDF service.
 * (Relocated verbatim from the former routes/devis.js so behaviour — incl. PDF output — is unchanged.)
 */

function roundMoney(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

function formatDateFR(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = String(dateStr).split('-');
  return `${d}/${m}/${y}`;
}

// English-language date formatter used by the EN devis PDF (specs/devis-english-language.md §3 rule 3).
// Format: `D MMMM YYYY` (e.g. `5 June 2026`) — unambiguous internationally, unlike the numeric
// `dd/mm/yyyy` which a US reader could parse as mm/dd.
const EN_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function formatDateEN(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = String(dateStr).split('-');
  const monthIdx = Number(m) - 1;
  if (!Number.isInteger(monthIdx) || monthIdx < 0 || monthIdx > 11) return '';
  const dayNum = Number(d);
  if (!Number.isInteger(dayNum) || dayNum <= 0) return '';
  return `${dayNum} ${EN_MONTH_NAMES[monthIdx]} ${y}`;
}

// Locale-aware accessor — keeps the PDF call sites short: `formatDateLocalised(date, language)`.
function formatDateLocalised(dateStr, language) {
  return String(language || 'fr').toLowerCase() === 'en'
    ? formatDateEN(dateStr)
    : formatDateFR(dateStr);
}

function formatCurrency(amount) {
  return `${Number(amount || 0).toFixed(2).replace('.', ',')} €`;
}

function isLineOffered(line) {
  const total = Number(line?.totalPrice || 0);
  const billedUnits = Number(line?.billedUnits || line?.quantity || 0);
  const unitPrice = Number(line?.unitPrice || 0);
  return total === 0 && billedUnits > 0 && unitPrice > 0;
}

function timeToDecimalHour(timeStr, fallback = 0) {
  const value = String(timeStr || '').trim();
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return Number(fallback || 0);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number(fallback || 0);
  return hours + minutes / 60;
}

function formatHoursLabel(hoursValue) {
  const hours = Number(hoursValue || 0);
  if (!Number.isFinite(hours) || hours <= 0) return '';
  const rounded = Math.round(hours * 10) / 10;
  const display = Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded).replace('.', ',');
  return `${display}h`;
}

function diffDays(startDate, endDate) {
  const s = new Date(`${startDate}T00:00:00`);
  const e = new Date(`${endDate}T00:00:00`);
  return Math.round((e - s) / 86400000);
}

function formatDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDaysToIsoDate(isoDate, daysDelta) {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + Number(daysDelta || 0));
  return formatDate(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * The extra-guest supplement row for the devis / invoice PDF — or null when there is nothing to draw.
 *
 * The PDF's line items are the accommodation nights, the options and the resources; the supplement
 * used to be inside the GRAND TOTAL only, so any devis with extra guests printed a sub-total that
 * did not match its own lines (69 € of unexplained gap on a 2-night Lodge stay). This resolves the
 * row's amounts from the LIVE quote when the engine could produce one, and otherwise derives the
 * remainder `finalPrice − rows` — which, by the engine's own composition
 * (finalPrice = accommodation + supplement + options + resources), is exactly the supplement.
 * An offered supplement returns `totalTtc: 0` with the real value in `originalTtc`, the same
 * struck-through contract as an offered option.
 */
function resolveExtraGuestPdfRow({ quote, finalPriceTtc, accommodationTtc, optionsTtc, resourcesTtc }) {
  if (quote && quote.extraGuestSurchargeOriginal != null) {
    const original = roundMoney(quote.extraGuestSurchargeOriginal);
    if (original <= 0.009) return null;
    const offered = Boolean(quote.extraGuestSurchargeOffered);
    return {
      totalTtc: offered ? 0 : roundMoney(quote.extraGuestSurcharge ?? original),
      originalTtc: original,
      offered,
      count: Math.max(0, Number(quote.extraGuestCount || 0)),
      tiersLabel: quote.extraGuestTiersLabel || null,
    };
  }
  // Fallback (engine failure at print time): the remainder the drawn rows leave unexplained.
  // An offered supplement is already absent from finalPrice, so the remainder is 0 → no row, which
  // is the correct degraded rendering (no strike-through without the engine's word for it).
  const remainder = roundMoney(
    Number(finalPriceTtc || 0) - Number(accommodationTtc || 0) - Number(optionsTtc || 0) - Number(resourcesTtc || 0),
  );
  if (remainder <= 0.009) return null;
  return { totalTtc: remainder, originalTtc: remainder, offered: false, count: 0, tiersLabel: null };
}

module.exports = {
  roundMoney,
  formatDateFR,
  formatDateEN,
  formatDateLocalised,
  formatCurrency,
  isLineOffered,
  resolveExtraGuestPdfRow,
  timeToDecimalHour,
  formatHoursLabel,
  diffDays,
  addDaysToIsoDate,
  formatDate,
};
