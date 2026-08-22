/**
 * Quand peut-on basculer le complément d'arrivée en fin de séjour depuis la fiche ?
 * — specs/defer-arrival-complement-to-checkout.md §3.3 rules 12-15.
 *
 * Même patron que [midStayNoteAccess](./midStayNoteAccess.js) : la règle d'affichage vit dans un util
 * pur, testable sans rendu, plutôt que dispersée dans le JSX de la carte.
 *
 * Pure : pas d'horloge implicite — `today` est passé par l'appelant.
 */

/**
 * @param {object} p
 * @param {number|null} p.editingReservationId réservation existante (null = création)
 * @param {boolean} p.isDevisMode              un devis n'a pas encore de séjour à reporter
 * @param {string}  p.startDate                'YYYY-MM-DD'
 * @param {number}  p.complementAmount         complément d'arrivée à percevoir
 * @param {boolean} p.complementPaid           déjà encaissé (rien à reporter)
 * @param {boolean} p.deferred                 marqueur actuel
 * @param {boolean} p.locked                   réservation annulée / passée verrouillée
 * @param {string}  p.today                    'YYYY-MM-DD'
 * @returns {{ visible: boolean, checked: boolean, disabled: boolean, reason: string }}
 */
export function complementDeferralAccess({
  editingReservationId, isDevisMode, startDate, complementAmount = 0,
  complementPaid = false, deferred = false, locked = false, today,
}) {
  const hidden = { visible: false, checked: Boolean(deferred), disabled: true, reason: '' };
  // Le report se pose sur une réservation enregistrée : c'est un marqueur en base, pas un brouillon.
  if (!editingReservationId || isDevisMode) return hidden;
  // Complément déjà encaissé, ou pas de complément du tout → il n'y a rien à déplacer.
  if (complementPaid) return hidden;
  if (Number(complementAmount || 0) <= 0 && !deferred) return hidden;

  // Le séjour a commencé : un complément non encaissé se perçoit de toute façon à la porte
  // (specs/complement-buckets-by-moment.md règle 4). L'interrupteur le dit, sans prétendre décider.
  const stayStarted = Boolean(startDate) && String(startDate) <= String(today);
  if (stayStarted) {
    return {
      visible: true,
      checked: true,
      disabled: true,
      reason: 'Le séjour a commencé : un complément non encaissé se perçoit au départ.',
    };
  }
  if (locked) {
    return { visible: true, checked: Boolean(deferred), disabled: true, reason: 'Réservation verrouillée.' };
  }
  return { visible: true, checked: Boolean(deferred), disabled: false, reason: '' };
}

export default complementDeferralAccess;
