/**
 * What the operator reads of a ledger row (specs/gift-vouchers.md §4.3): the French label, the Paris day and the author's
 * name, shaped here so the screen only renders.
 */

const rules = require('./voucherRules');

const LABELS = Object.freeze({
  issue: 'Émission',
  hold: 'Réservé sur une fiche',
  release: 'Réservation libérée',
  redeem: 'Utilisé sur une fiche',
  refund: 'Remboursé sur le bon',
  cancel: 'Annulé',
  reveal: 'Code affiché',
  mail: 'Mail envoyé',
});

const FIXED_ACTORS = Object.freeze({ public: 'Site', system: 'Automatique' });

function labelOf(m) {
  if (m.kind === 'extend') {
    const target = String(m.note || '').split('→').pop().trim();
    return rules.isIsoDate(target) ? `Prolongé jusqu’au ${rules.formatFrDate(target)}` : 'Validité prolongée';
  }
  if (m.kind === 'adjust') return m.note ? `Solde corrigé : ${m.note}` : 'Solde corrigé';
  return LABELS[m.kind] || m.kind;
}

/** The name an actor is shown under: the author of a ledger row or of a refund's settlement. `userName(id)` → the display name or null. */
function actorNameOf(actor, userName) {
  const [scope, rest] = String(actor).split(':');
  return FIXED_ACTORS[scope] || (scope === 'user' ? userName(Number(rest)) || 'Utilisateur' : actor);
}

/** `userName(id)` → the display name or null. */
function presentMovement(m, userName) {
  const actorName = actorNameOf(m.actor, userName);
  return {
    id: m.id,
    kind: m.kind,
    label: labelOf(m),
    amountCents: m.amountCents,
    date: rules.parisDate(new Date(m.createdAt)),
    actorName,
    reservationId: m.reservationId,
    note: m.kind === 'extend' || m.kind === 'adjust' ? null : m.note,
  };
}

module.exports = { presentMovement, actorNameOf };
