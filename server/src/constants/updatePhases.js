/**
 * The phases of a self-update and the French sentence the UI shows for each
 * (specs/self-update-and-releases.md §3.F rule 37).
 *
 * The phase is the machine-readable field written to `data/update-status.json` — by this process
 * during staging, then by `apply-update.sh` during the swap. The label lives here, on the server
 * only, so the shell helper never has to produce French text and the client never has to map codes.
 */

const PHASE_LABELS = {
  idle: 'Aucune mise à jour en cours',
  checking: 'Recherche d’une nouvelle version…',
  downloading: 'Téléchargement de l’archive…',
  verifying: 'Vérification de l’intégrité de l’archive…',
  extracting: 'Extraction de la nouvelle version…',
  installing: 'Installation des dépendances…',
  backup: 'Sauvegarde de la base de données…',
  swapping: 'Basculement vers la nouvelle version…',
  restarting: 'Redémarrage de l’application…',
  done: 'Mise à jour terminée',
  failed: 'La mise à jour a échoué',
  rolled_back: 'Mise à jour annulée : la version précédente a été restaurée',
};

/** Phases after which nothing more will happen on its own. */
const TERMINAL_PHASES = new Set(['idle', 'done', 'failed', 'rolled_back']);

/** Error codes `apply-update.sh` can write, and what they mean to a human. */
const ERROR_MESSAGES = {
  SYMLINK_FAILED: "Le basculement vers la nouvelle version a échoué (lien « current »).",
  PM2_FAILED: 'PM2 n’a pas pu redémarrer l’application.',
  HEALTHCHECK_TIMEOUT: "La nouvelle version n’a pas répondu dans le délai imparti.",
  WRONG_VERSION: "Après redémarrage, l’application ne tourne pas sur la version attendue.",
  ROLLBACK_FAILED: "Le retour à la version précédente a échoué : l’application peut être arrêtée. Voir le journal de mise à jour.",
  NO_PREVIOUS_RELEASE: "Aucune version précédente n’est disponible pour un retour arrière.",
};

function phaseLabel(phase) {
  return PHASE_LABELS[phase] || PHASE_LABELS.idle;
}

function isTerminal(phase) {
  return TERMINAL_PHASES.has(phase);
}

function errorMessage(code, fallback = null) {
  if (!code) return fallback;
  return ERROR_MESSAGES[code] || fallback || code;
}

module.exports = { PHASE_LABELS, TERMINAL_PHASES, ERROR_MESSAGES, phaseLabel, isTerminal, errorMessage };
