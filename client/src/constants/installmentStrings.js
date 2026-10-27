/**
 * Copy of the installment plan card (specs/direct-installments.md §6) — presentation only. The server decides
 * every amount, date, status and refusal; these are the words around them.
 */

export const PLAN_TITLE = 'Échéancier';
export const PLAN_EMPTY_LABEL = 'Paiement en plusieurs fois';
export const PLAN_CREATE = 'Créer un échéancier';
export const PLAN_DELETE = 'Supprimer l’échéancier';
export const PLAN_FROZEN = 'Figé depuis le 1er versement';
export const PLAN_NOT_AVAILABLE = 'Échéancier indisponible';

export const STEPPER_LABEL = 'Nombre d’échéances';
export const STEPPER_LESS = 'Une échéance de moins';
export const STEPPER_MORE = 'Une échéance de plus';
export const countLabel = (count) => `${count} échéances`;

export const RECOMPUTE_WARNING = (count) => `Passer à ${count} échéances recalcule toutes les dates ; les dates et montants modifiés seront perdus.`;
export const RECOMPUTE_CONFIRM = 'Recalculer';
export const RECOMPUTE_KEEP = 'Garder';

export const DATE_LABEL = (number) => `Date de l’échéance ${number}`;
export const AMOUNT_LABEL = (number) => `Montant de l’échéance ${number}`;
export const PINNED_MARK = 'fixé';
export const ADDED_MARK = (amount) => `+${amount} ajoutés`;

export const ACTION_SEND = 'Envoyer la demande';
export const ACTION_COPY = 'Copier le lien';
export const ACTION_PAY = 'Marquer payée';
export const PAY_DATE_LABEL = 'Perçu le';
export const PAY_METHODS = [
  { value: 'transfer', label: 'Virement' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'cash', label: 'Espèces' },
  { value: 'card', label: 'Carte' },
  { value: 'other', label: 'Autre' },
];

export const GAP_LABEL = 'Échéancier au-dessus du séjour';
export const GAP_HELP = 'Les montants restent figés ; à régler au registre (remboursement ou geste).';
export const FOOTER_TOTAL = 'Total séjour';
export const FOOTER_PAID = 'Payé';
export const FOOTER_REMAINING = 'Reste';

export const REQUEST_SENT = (email) => `Demande envoyée${email ? ` à ${email}` : ''}.`;
export const LINK_COPIED = 'Lien copié.';
export const GENERIC_ERROR = 'Échéancier : enregistrement impossible.';
