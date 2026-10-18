/**
 * When a template leaves, as the « Quand » column says it (specs/email-automation.md rule 16). The
 * day offset alone reads « Jour J » for a confirmation, a season email or a payment request, none of
 * which is tied to the arrival day. Pure.
 */

const BY_STABLE_KEY = Object.freeze({
  reservation_confirmation: 'À la réservation',
  season_gift_vouchers: '15 nov.',
  season_new_year: '6 janv.',
  cancellation_notice: 'À l’annulation',
  deposit_request: 'À la demande',
  balance_request: 'À la demande',
  full_request: 'À la demande',
  deposit_reminder: 'Échéance de l’acompte',
});

function offsetLabel(n, after) {
  const num = Number(n || 0);
  if (num === 0) return after ? 'Jour du départ' : 'Jour J';
  if (after) return num === 1 ? 'Lendemain du départ' : `${num} j après le départ`;
  return num < 0 ? `J${num}` : `J+${num}`;
}

function templateWhenLabel(template) {
  const t = template || {};
  if (BY_STABLE_KEY[t.stableKey]) return BY_STABLE_KEY[t.stableKey];
  const anchor = String(t.anchor || 'start');
  if (anchor === 'created') return 'À la réservation';
  if (anchor === 'season') return 'Saisonnier';
  if (anchor === 'end') return offsetLabel(t.dayOffset, true);
  if (anchor === 'balanceDueDate') {
    const n = Number(t.dayOffset || 0);
    return n === 0 ? 'Échéance du solde' : `${Math.abs(n)} j ${n > 0 ? 'après' : 'avant'} l’échéance du solde`;
  }
  if (anchor === 'depositDueDate') return 'Échéance de l’acompte';
  return offsetLabel(t.dayOffset, false);
}

module.exports = { templateWhenLabel };
