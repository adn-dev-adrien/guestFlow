// « Faits marquants » of the Suivi financier (specs/finance-dashboard-redesign.md §3.3 rule 11).
// Pure: the figures come from the dashboard model, this file only turns them into French lines.

const { MONTH_NAMES } = require('./financeWindow');

const eur = (n) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0))} €`;
const pct = (x) => `${Math.round(x * 100)} %`;
const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

/**
 * @param {{
 *   bestMonth: { month: 'YYYY-MM', revenue: number, previous: number|null } | null,
 *   direct: { revenue: number, averagePlatformRate: number|null },
 *   late: { count: number, amount: number },
 * }} facts
 * @returns {Array<{ key, tone: 'success'|'warning'|'error'|'info', title, text }>}
 */
function buildInsights({ bestMonth, direct, late }) {
  const out = [];
  if (bestMonth && bestMonth.revenue > 0) {
    const name = capitalise(MONTH_NAMES[Number(bestMonth.month.slice(5, 7)) - 1]);
    out.push({
      key: 'bestMonth',
      tone: 'success',
      title: `${name}, meilleur mois de l'exercice`,
      text: `${eur(bestMonth.revenue)}${bestMonth.previous != null ? `, contre ${eur(bestMonth.previous)} l'an dernier` : ''}.`,
    });
  }
  // Hidden when no platform stay has a known commission: an invented rate would be a guess.
  if (direct && direct.revenue > 0 && direct.averagePlatformRate != null) {
    out.push({
      key: 'directSavings',
      tone: 'warning',
      title: `Le direct vous a évité ${eur(direct.revenue * direct.averagePlatformRate)} de commissions`,
      text: `${eur(direct.revenue)} réservés en direct, au taux moyen de vos plateformes (${pct(direct.averagePlatformRate)}).`,
    });
  }
  out.push(late && late.count > 0
    ? { key: 'late', tone: 'error', title: `${plural(late.count, 'séjour')} en retard de paiement`, text: `${eur(late.amount)} à relancer : tuile « En retard ».` }
    : { key: 'late', tone: 'info', title: 'Aucun paiement en retard', text: 'Tout est à jour.' });
  return out;
}

module.exports = { buildInsights, eur };
