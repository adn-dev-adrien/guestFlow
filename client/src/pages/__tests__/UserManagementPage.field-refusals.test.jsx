// specs/admin-account-management.md rule 20 — a refusal under a field of the account dialog is French, never its code.
import { fieldRefusalText } from '../UserManagementPage';

test.each([
  ['FIRSTNAME_REQUIRED', 'Prénom obligatoire.'],
  ['LASTNAME_REQUIRED', 'Nom obligatoire.'],
  ['INVALID_EMAIL', 'Adresse email invalide.'],
  ['EMAIL_ALREADY_EXISTS', 'Cet email est déjà utilisé.'],
  ['ROLES_REQUIRED', 'Choisir au moins un rôle.'],
  ['UNKNOWN_ROLE', 'Rôle inconnu.'],
])('rule 20: %s reads « %s »', (code, text) => {
  expect(fieldRefusalText({ error: code, field: 'x' })).toBe(text);
});

test('rule 20: the server\'s detail wins, an unlisted code reads a sentence, never the code', () => {
  expect(fieldRefusalText({ error: 'INVALID_FIELD', detail: 'Module absent.' })).toBe('Module absent.');
  expect(fieldRefusalText({ error: 'OTHER_CODE', message: 'Module inactif.' })).toBe('Module inactif.');
  expect(fieldRefusalText({ error: 'SOME_CODE', message: 'SOME_CODE' })).toBe('Valeur refusée.');
});
