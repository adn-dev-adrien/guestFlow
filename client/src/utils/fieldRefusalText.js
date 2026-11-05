const FIELD_REFUSALS = {
  FIRSTNAME_REQUIRED: 'Prénom obligatoire.',
  LASTNAME_REQUIRED: 'Nom obligatoire.',
  INVALID_EMAIL: 'Adresse email invalide.',
  EMAIL_ALREADY_EXISTS: 'Cet email est déjà utilisé.',
  ROLES_REQUIRED: 'Choisir au moins un rôle.',
  UNKNOWN_ROLE: 'Rôle inconnu.',
  ROLE_PLUGIN_INACTIVE: 'Module de ce rôle inactif.',
};

/** What a server refusal says under its field of the account dialog (specs/admin-account-management.md rule 20). */
export default function fieldRefusalText(err) {
  return err.detail || FIELD_REFUSALS[err.error] || (err.message !== err.error && err.message) || 'Valeur refusée.';
}
