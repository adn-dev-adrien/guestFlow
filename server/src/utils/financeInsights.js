// « Faits marquants » of the Suivi financier (specs/finance-dashboard-redesign.md §3.3 rule 11).
// Pure: the figures come from the dashboard model, this file only turns them into French lines.

const { MONTH_NAMES } = require('./financeWindow');

// Whole euros grouped with a REGULAR space, exactly like the client's `formatCurrencyRounded` that
// draws the tiles beside these lines. Intl's narrow no-break space (U+202F) renders next to nothing
// in the app font, so « 1 300 € » read « 1300 € » under a tile saying « 1 900 € » (2026-10-27 audit).
const eur = (n) => {
  const rounded = Math.round(Number(n) || 0);
  const grouped = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${rounded < 0 ? '-' : ''}${grouped} €`;
};
const pct = (x) => `${Math.round(x * 100)} %`;
const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Guillemets held to their word by a narrow no-break space: « tuile « » never wraps after the «.
const TILE_LATE = '«\u202FEn retard\u202F»';
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

/**
 * @param {{
 *   bestMonth: { month: 'YYYY-MM', revenue: number, previous: number|null,
 *                kind?: 'exercise'|'over'|'leading', timing?: 'current'|'upcoming' } | null,
 *   direct: { revenue: number, averagePlatformRate: number|null },
 *   late: { count: number, amount: number, payouts?: { count: number, totalAmount: number } },
 *   unpriced?: { count: number, nights: number },
 * }} facts
 * @returns {Array<{ key, tone: 'success'|'warning'|'error'|'info', title, text }>}
 */
function buildInsights({ bestMonth, direct, late, unpriced }) {
  const out = [];
  // Rule 43 — a best month is a month over; before any, the leading month is named as such.
  if (bestMonth && bestMonth.revenue > 0) {
    const name = capitalise(MONTH_NAMES[Number(bestMonth.month.slice(5, 7)) - 1]);
    out.push(bestMonth.kind === 'leading'
      ? {
        key: 'bestMonth',
        tone: 'success',
        title: `${name}, en tête des réservations : ${eur(bestMonth.revenue)}`,
        text: bestMonth.timing === 'current' ? 'Mois en cours, pas encore terminé.' : 'Mois à venir.',
      }
      : {
        key: 'bestMonth',
        tone: 'success',
        title: `${name}, meilleur mois ${bestMonth.kind === 'over' ? 'terminé' : "de l'exercice"}`,
        text: `${eur(bestMonth.revenue)}${bestMonth.previous != null ? `, contre ${eur(bestMonth.previous)} l'an dernier` : ''}.`,
      });
  }
  // Hidden when no platform stay has a known commission: an invented rate would be a guess.
  if (direct && direct.revenue > 0 && direct.averagePlatformRate != null) {
    out.push({
      key: 'directSavings',
      tone: 'success',
      title: `Commissions évitées par le direct : ${eur(direct.revenue * direct.averagePlatformRate)}`,
      text: `${eur(direct.revenue)} réservés en direct, au taux moyen des plateformes (${pct(direct.averagePlatformRate)}).`,
    });
  }
  // Rule 34 — the late payments cover the guests AND the platforms' payouts.
  const payouts = (late && late.payouts) || { count: 0, totalAmount: 0 };
  let lateText = `${eur(late && late.amount)} à relancer : tuile ${TILE_LATE}.`;
  if (payouts.count > 0 && payouts.count === late.count) lateText = `${eur(late.amount)} de ${payouts.count > 1 ? 'versements' : 'versement'} plateforme attendu${payouts.count > 1 ? 's' : ''} : tuile ${TILE_LATE}.`;
  else if (payouts.count > 0) lateText = `${eur(late.amount)} à relancer, dont ${eur(payouts.totalAmount)} de versements plateforme : tuile ${TILE_LATE}.`;
  out.push(late && late.count > 0
    ? { key: 'late', tone: 'error', title: `${plural(late.count, 'séjour')} en retard de paiement`, text: lateText }
    : { key: 'late', tone: 'info', title: 'Aucun paiement en retard', text: 'Tout est à jour.' });
  // Rule 35 — stays on the books without an amount count as nights but not as revenue: said out loud,
  // with the way to them.
  if (unpriced && unpriced.count > 0) {
    out.push({
      key: 'unpriced',
      tone: 'warning',
      title: `${plural(unpriced.count, 'séjour')} sans montant`,
      text: unpriced.nights > 0
        ? `${plural(unpriced.nights, 'nuit')} sans revenu sur la période : montants à saisir.`
        : 'Nuits déjà couvertes par un autre séjour : doublons à vérifier.',
      action: { label: 'Voir les séjours', tile: 'stays', scope: 'unpriced' },
    });
  }
  return out;
}

module.exports = { buildInsights, eur };
