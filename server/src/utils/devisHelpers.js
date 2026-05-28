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

module.exports = {
  roundMoney,
  formatDateFR,
  formatCurrency,
  isLineOffered,
  timeToDecimalHour,
  formatHoursLabel,
  diffDays,
  addDaysToIsoDate,
  formatDate,
};
