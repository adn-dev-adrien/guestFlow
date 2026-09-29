// The window the Suivi financier reads (specs/finance-dashboard-redesign.md §3.1 rules 1-2): the
// whole exercise, one of its months, or a custom du / au. Pure — the exercise bounds come from
// utils/fiscalYear.js, today is never read here.

const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

const isRealDate = (s) => ISO_DATE.test(String(s || '')) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const lastDayOfMonth = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const frDate = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const monthLabel = (ym) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

const MESSAGES = {
  missingDates: 'Choisissez deux dates.',
  reversed: 'La date de début doit précéder la date de fin.',
  badMonth: "Ce mois n'appartient pas à l'exercice choisi.",
  badKind: 'Période inconnue.',
};

/**
 * @param {{ exercise: {key,label,from,to}, kind?: 'fy'|'month'|'custom', month?: string, from?: string, to?: string }}
 * @returns {{ ok: true, window: {kind, from, to, label} } | { ok: false, error: string }}
 */
function resolveWindow({ exercise, kind = 'fy', month, from, to }) {
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
    if (!isRealDate(from) || !isRealDate(to)) return { ok: false, error: MESSAGES.missingDates };
    if (from > to) return { ok: false, error: MESSAGES.reversed };
    return { ok: true, window: { kind: 'custom', from, to, label: `du ${frDate(from)} au ${frDate(to)}` } };
  }
  return { ok: false, error: MESSAGES.badKind };
}

module.exports = { resolveWindow, monthLabel, MONTH_NAMES, MESSAGES };
