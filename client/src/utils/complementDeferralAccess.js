/**
 * Quand peut-on basculer le complément d'arrivée en fin de séjour depuis la fiche ?
 * — specs/defer-arrival-complement-to-checkout.md §3.3 rules 12-15.
 *
 * La règle tient en une phrase depuis le 2026-08-22 : **c'est l'opérateur qui décide, tout le
 * temps.** Le contrôle ne se verrouille plus au début du séjour et ne disparaît plus une fois le
 * complément encaissé — un encaissement se corrige, et regrouper la collecte au départ est
 * précisément la correction qu'on veut pouvoir faire. Il ne s'efface que lorsqu'il n'y a
 * matériellement rien à déplacer : pas de réservation enregistrée, ou pas de complément.
 *
 * Même patron que [midStayNoteAccess](./midStayNoteAccess.js) : la règle vit dans un util pur,
 * testable sans rendu, plutôt que dispersée dans le JSX de la carte.
 */

/**
 * @param {object} p
 * @param {number|null} p.editingReservationId réservation existante (null = création)
 * @param {boolean} p.isDevisMode              un devis n'a pas encore de séjour à reporter
 * @param {number}  p.complementAmount         complément d'arrivée
 * @param {boolean} p.complementPaid           déjà encaissé
 * @param {boolean} p.deferred                 marqueur actuel
 * @param {boolean} p.locked                   réservation annulée / passée verrouillée
 * @returns {{ visible: boolean, checked: boolean, disabled: boolean, reason: string,
 *            needsConfirm: boolean }}
 *          `needsConfirm` : activer le report sur un complément marqué encaissé le remet à
 *          percevoir — ça se demande avant de le faire.
 */
export function complementDeferralAccess({
  editingReservationId, isDevisMode, complementAmount = 0,
  complementPaid = false, deferred = false, locked = false,
}) {
  const hidden = { visible: false, checked: Boolean(deferred), disabled: true, reason: '', needsConfirm: false };
  // Le report se pose sur une réservation enregistrée : c'est un marqueur en base, pas un brouillon.
  if (!editingReservationId || isDevisMode) return hidden;
  // Pas de complément d'arrivée du tout → rien à déplacer (sauf si le marqueur traîne encore).
  if (Number(complementAmount || 0) <= 0 && !deferred) return hidden;

  return {
    visible: true,
    checked: Boolean(deferred),
    disabled: Boolean(locked),
    reason: locked ? 'Réservation verrouillée.' : '',
    needsConfirm: Boolean(complementPaid) && !deferred,
  };
}

export default complementDeferralAccess;
