/**
 * French copy for the reception SAS locks (specs/reception-sas-today-only.md §3.3).
 *
 * The server resolves WHY a SAS is locked ('done' | 'future' | 'past') and ships the reason in the
 * payload; this module is the single place that turns a reason into words, shared by the planning
 * cards, the departure rows and the SAS wizard. Lookup only — the window arithmetic lives in
 * server/src/utils/sasEditWindow.js.
 */

const TOOLTIPS = {
  arrival: {
    done: "Check-in déjà effectué — modification réservée à l'administrateur",
    past: 'Check-in passé — seuls les check-in du jour sont modifiables',
    future: "Check-in à venir — modifiable le jour de l'arrivée",
  },
  departure: {
    done: "Check-out déjà effectué — modification réservée à l'administrateur",
    past: 'Check-out passé — seuls les check-out du jour sont modifiables',
    future: 'Check-out à venir — modifiable le jour du départ',
  },
};

const TITLES = {
  arrival: { done: 'Check-in déjà effectué', past: 'Check-in passé', future: 'Check-in à venir' },
  departure: { done: 'Check-out déjà effectué', past: 'Check-out passé', future: 'Check-out à venir' },
};

/** Tooltip on the disabled ✓ of a planning card / departure row. */
export function sasLockTooltip(mode, reason) {
  return (TOOLTIPS[mode] || TOOLTIPS.arrival)[reason] || '';
}

/** Header title of the locked wizard panel. */
export function sasLockTitle(mode, reason) {
  const byReason = TITLES[mode] || TITLES.arrival;
  return byReason[reason] || (mode === 'departure' ? 'Check-out' : 'Check-in');
}

/**
 * Body sentence of the locked wizard panel — also used for the 403 raised mid-wizard.
 * @param {string} mode - 'arrival' | 'departure'
 * @param {string} reason - 'done' | 'past' | 'future'
 * @param {string} [dateLabel] - dd/MM/yyyy; every date clause is dropped when absent.
 */
export function sasLockMessage(mode, reason, dateLabel) {
  const noun = mode === 'departure' ? 'check-out' : 'check-in';
  const day = mode === 'departure' ? 'du départ' : "de l'arrivée";
  switch (reason) {
    case 'done':
      return `Ce ${noun} a déjà été validé${dateLabel ? ` le ${dateLabel}` : ''}. Sa modification est réservée à l'administrateur.`;
    case 'past':
      return `Ce ${noun}${dateLabel ? ` datait du ${dateLabel}` : ' est passé'}. Seuls les ${noun} du jour sont modifiables — contactez l'administrateur.`;
    case 'future':
      return `Ce ${noun} n'est possible que${dateLabel ? ` le ${dateLabel}` : ` le jour ${day}`}${dateLabel ? `, le jour ${day}` : ''}.`;
    default:
      return '';
  }
}

/** Tooltip on a status checkbox disabled by the day window. */
export function statusLockTooltip(mode) {
  return mode === 'departure'
    ? 'Statut modifiable uniquement le jour du départ'
    : "Statut modifiable uniquement le jour de l'arrivée";
}
