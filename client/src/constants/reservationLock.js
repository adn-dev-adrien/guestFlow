// specs/mid-stay-extras-on-locked-fiche.md §3.5 — copy of the locked-fiche banner and of the arrival
// caption. The lock itself is decided by the server (`editLock`); only its wording lives here.

export const LOCKED_FICHE_BANNER = 'Cette réservation est passée ou en cours : seuls le client, la plateforme, les ajustements de prix et les statuts de paiement/caution restent modifiables.';

// specs/settings-rationalization.md rule 35 (D21) — the unlocked fiche keeps its final price; the server refuses the rest.
export const UNLOCKED_FICHE_BANNER = 'Fiche déverrouillée : tout reste modifiable sauf le prix final. Le verrou revient à la sortie de la fiche.';

export const UNLOCKED_NEW_FICHE_BANNER = 'Fiche déverrouillée : dates, logement et suppression sont modifiables. Le verrou revient dès la sortie de la fiche.';

export const MID_STAY_EXTRAS_BANNER = 'Séjour commencé : options, client, plateforme, prix et paiements restent modifiables.';

export const ARRIVAL_LINE_CAPTION = 'Vendu à l\'arrivée';

export const OFFERED_LINE_CAPTION = 'Offerte';
