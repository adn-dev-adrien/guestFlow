/**
 * The refusals shown while typing in the « Accès portail » editors (specs/gate-access-portier.md §3.4,
 * specs/guest-gate-access-maquettes.html « refusals shown while typing »).
 *
 * UX only: Portier's 422 is the authority, and its reasons come back as the same sentences
 * (server/src/utils/portierAccessView.js). Dates are the server's wall-clock strings
 * `YYYY-MM-DDTHH:MM`, which order correctly as text — no date arithmetic happens here. One rule for
 * the time windows, shared by creation and editing, so the two can never say different things.
 */

export const GATE_ACCESS_MESSAGES = {
  labelRequired: "Un accès sans nom est un accès qu'on n'osera pas supprimer dans six mois.",
  rangeMissing: 'Les deux dates sont nécessaires.',
  rangeOrder: 'La fin doit venir après le début.',
  earlyNotBefore: "Une ouverture anticipée doit précéder l'arrivée.",
  extendNotAfter: 'Une prolongation doit dépasser la fin du séjour. Pour couper plus tôt, c\'est « Suspendre ».',
  windowsOverlap: 'Deux plages se chevauchent — fusionnez-les, sinon la règle devient indevinable.',
};

function minutes(hhmm) {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function timeWindowsError(windows = []) {
  const rows = windows.map((w, index) => ({ n: index + 1, from: minutes(w.from), until: minutes(w.until) }));
  for (const row of rows) {
    if (row.from === null || row.until === null) return `Plage ${row.n} : incomplète.`;
    if (row.until <= row.from) return `Plage ${row.n} : la fin doit venir après le début (pas de plage qui passe minuit).`;
  }
  const byStart = [...rows].sort((a, b) => a.from - b.from);
  for (let i = 1; i < byStart.length; i += 1) {
    if (byStart[i].from < byStart[i - 1].until) return GATE_ACCESS_MESSAGES.windowsOverlap;
  }
  return '';
}

/** A hand-made access: permanent (`ranged: false`) or on a date range. */
export function manualAccessErrors({ label = '', ranged = false, validFrom = '', validUntil = '', timeWindows = [] }) {
  let range = '';
  if (ranged) {
    if (!validFrom || !validUntil) range = GATE_ACCESS_MESSAGES.rangeMissing;
    else if (validUntil <= validFrom) range = GATE_ACCESS_MESSAGES.rangeOrder;
  }
  return {
    label: String(label).trim() ? '' : GATE_ACCESS_MESSAGES.labelRequired,
    range,
    windows: timeWindowsError(timeWindows),
  };
}

/** A stay access: the two overrides can only widen the stay the reservation gives. */
export function stayOverridesErrors({ earlyFrom = '', extendedUntil = '', stayFrom = '', stayUntil = '', timeWindows = [] }) {
  return {
    early: earlyFrom && stayFrom && earlyFrom >= stayFrom ? GATE_ACCESS_MESSAGES.earlyNotBefore : '',
    extended: extendedUntil && stayUntil && extendedUntil <= stayUntil ? GATE_ACCESS_MESSAGES.extendNotAfter : '',
    windows: timeWindowsError(timeWindows),
  };
}

export const hasErrors = (errors) => Object.values(errors).some(Boolean);
