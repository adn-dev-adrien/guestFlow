/**
 * Quand peut-on ouvrir une « note en séjour » ? — specs/mid-stay-notes.md §3.5 rule 17.
 *
 * La règle vit ici, en un seul endroit, parce que DEUX surfaces l'appliquent : le bouton de la barre
 * d'actions collante (point d'entrée principal, atteignable de partout dans la fiche) et le bloc
 * « Encaissements en séjour » plus bas. Les voir diverger serait pire que de n'en avoir qu'un.
 *
 * Pure : pas d'accès au DOM, pas d'horloge implicite — `today` est passé par l'appelant.
 */

/**
 * @param {object} p
 * @param {number|null} p.editingReservationId réservation existante en cours d'édition (null = création)
 * @param {boolean} p.isDevisMode              un devis ne vend rien sur place
 * @param {string}  p.startDate                'YYYY-MM-DD'
 * @param {number}  p.notesCount               notes déjà encaissées (l'historique doit rester atteignable)
 * @param {boolean} p.endOfStaySettled         complément de fin de séjour déjà encaissé
 * @param {string}  p.today                    'YYYY-MM-DD'
 * @returns {{ visible: boolean, disabled: boolean, reason: string }}
 *          `reason` est le libellé d'infobulle quand le bouton est désactivé ('' sinon).
 */
export function midStayNoteAccess({
  editingReservationId, isDevisMode, startDate, notesCount = 0, endOfStaySettled = false, today,
}) {
  // Une note ne se rattache qu'à une réservation déjà enregistrée : elle encaisse des lignes qui
  // n'existent qu'une fois sauvegardées.
  if (!editingReservationId || isDevisMode) return { visible: false, disabled: true, reason: '' };

  // Le séjour a commencé (ou est terminé — on peut rattraper un oubli après le départ), ou bien une
  // note existe déjà et son historique doit rester consultable.
  const stayStarted = Boolean(startDate) && String(startDate) <= String(today);
  if (!stayStarted && notesCount === 0) return { visible: false, disabled: true, reason: '' };

  // Le complément de fin de séjour encaissé fige tout (§3.5) : plus rien ne doit bouger.
  if (endOfStaySettled) {
    return {
      visible: true,
      disabled: true,
      reason: 'Complément de fin de séjour déjà encaissé — décochez-le pour créer une note.',
    };
  }
  return { visible: true, disabled: false, reason: '' };
}

/**
 * Nombre de notes déjà encaissées, à partir de la colonne `midStaySettledNotes` (JSON, ou déjà
 * désérialisée). Tolérant : une valeur absente ou illisible vaut zéro plutôt que de faire planter la
 * fiche pour un compteur d'affichage.
 */
export function countMidStayNotes(raw) {
  if (Array.isArray(raw)) return raw.length;
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch { return 0; }
}

export default midStayNoteAccess;
