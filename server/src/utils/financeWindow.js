// The window the Suivi financier reads (specs/finance-dashboard-redesign.md §3.1 rules 1-2): the
// whole exercise, one of its months, or a custom du / au. Pure — the exercise bounds come from
// utils/fiscalYear.js, today is passed in, never read here.

const { dateWindowMessage, isRealIsoDay, HORIZON_MESSAGE, PAST_HORIZON_MESSAGE } = require('./stayDates');

const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

// A month that names one: 01 to 12 (« 2026-13 » sorts inside an exercise closing in September).
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const lastDayOfMonth = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const frDate = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const monthLabel = (ym) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// Rule 51 — two whole exercises fit (731 days); « au » 9999-12-31 is refused before any work.
const MAX_CUSTOM_WINDOW_DAYS = 750;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

const MESSAGES = {
  missingDates: 'Deux dates à choisir.',
  reversed: 'La date de début doit précéder la date de fin.',
  badMonth: "Ce mois n'appartient pas à l'exercice choisi.",
  badKind: 'Période inconnue.',
  tooWide: `Période trop longue : ${MAX_CUSTOM_WINDOW_DAYS} jours au plus.`,
  tooFar: HORIZON_MESSAGE,
  tooOld: PAST_HORIZON_MESSAGE,
};

/**
 * @param {{ exercise: {key,label,from,to}, kind?: 'fy'|'month'|'custom', month?: string, from?: string, to?: string, today: string }}
 * @returns {{ ok: true, window: {kind, from, to, label} } | { ok: false, error: string }}
 */
function resolveWindow({ exercise, kind = 'fy', month, from, to, today }) {
  if (kind === 'fy' || !kind) {
    return { ok: true, window: { kind: 'fy', from: exercise.from, to: exercise.to, label: `Exercice ${exercise.label}` } };
  }
  if (kind === 'month') {
    const ym = String(month || '');
    if (!ISO_MONTH.test(ym) || `${ym}-01` < exercise.from || `${ym}-01` > exercise.to) {
      return { ok: false, error: MESSAGES.badMonth };
    }
    return { ok: true, window: { kind: 'month', from: `${ym}-01`, to: `${ym}-${String(lastDayOfMonth(ym)).padStart(2, '0')}`, month: ym, label: monthLabel(ym) } };
  }
  if (kind === 'custom') {
    if (!isRealIsoDay(from) || !isRealIsoDay(to)) return { ok: false, error: MESSAGES.missingDates };
    if (from > to) return { ok: false, error: MESSAGES.reversed };
    if (daysBetween(from, to) > MAX_CUSTOM_WINDOW_DAYS) return { ok: false, error: MESSAGES.tooWide };
    // Rule 51, readings of 2026-11-02 — both ends inside the date window (reservations-backend-mvc rule 13).
    const outside = dateWindowMessage(from, today) || dateWindowMessage(to, today);
    if (outside) return { ok: false, error: outside };
    return { ok: true, window: { kind: 'custom', from, to, label: `du ${frDate(from)} au ${frDate(to)}` } };
  }
  return { ok: false, error: MESSAGES.badKind };
}

module.exports = { resolveWindow, monthLabel, MONTH_NAMES, MESSAGES, MAX_CUSTOM_WINDOW_DAYS };
