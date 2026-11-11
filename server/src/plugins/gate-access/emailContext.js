/**
 * The gate key in the guest emails (specs/gate-access-sowel-connector.md §3.5 rule 23): the stored
 * result the house reported — composing an email never reaches it, and waits for nothing. Empty when
 * there is no usable key; the template's paragraph is then skipped by its flag. A code alone can be
 * dictated; a link alone installs the key (a profile without a code).
 */

// The labels are the editor's buttons: the server is the only place they are declared.
const TOKENS = [
  { name: 'gateAccessCode', label: 'Code portail' },
  { name: 'gateAccessUrl', label: 'Lien portail' },
];
const FLAGS = [{ name: 'hasGateAccess', label: 'Si accès portail' }];

function gateEmailContext(invitation) {
  const code = invitation && invitation.code ? String(invitation.code) : '';
  const url = invitation && invitation.url ? String(invitation.url) : '';
  return { tokens: { gateAccessCode: code, gateAccessUrl: url }, flags: { hasGateAccess: Boolean(code || url) } };
}

module.exports = { TOKENS, FLAGS, gateEmailContext };
