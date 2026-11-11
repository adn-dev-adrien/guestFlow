// « Validation en deux étapes » — the feature's name and the wording of its card and dialogs
// (specs/hosting-h2-account-security.md rules 38–46). The sentences that carry a number or a date
// (tries left, codes left, « depuis le … ») are worded by the server.

export const TWO_FACTOR_NAME = 'Validation en deux étapes';
export const TWO_FACTOR_EXPLAINER = 'Code de l’appli d’authentification demandé à chaque connexion, en plus du mot de passe.';
export const SETUP_STEPS = ['Mot de passe', 'Appli', 'Codes de secours'];
export const ENROLMENT_ENDED = {
  TOO_MANY_CODES: 'Trop de codes incorrects : activation annulée.',
  ENROLMENT_EXPIRED: 'Activation expirée : recommencer.',
};
export const REAUTH_TEXTS = {
  disable: {
    title: 'Désactiver la validation en deux étapes',
    text: 'Le compte ne sera plus protégé que par le mot de passe.',
    submitLabel: 'Désactiver',
    submitColor: 'error',
  },
  codes: {
    title: 'Nouveaux codes de secours',
    text: 'Les anciens codes ne marcheront plus.',
    submitLabel: 'Générer',
  },
  replace: {
    title: 'Changer d’appli',
    text: 'L’appli actuelle reste valable jusqu’à la confirmation de la nouvelle.',
    submitLabel: 'Continuer',
  },
  toApp: {
    title: 'Passer à une appli',
    text: 'Le code par email reste valable jusqu’à la confirmation de l’appli.',
    submitLabel: 'Continuer',
  },
};
