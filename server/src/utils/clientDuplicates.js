/**
 * The refusal of a client record that already exists (specs/clients.md rule 12): 409
 * `CLIENT_EXISTS`, carrying the existing client so the screen can offer to use it.
 */
function clientExistsRefusal(existing) {
  const name = [existing.firstName, existing.lastName].filter(Boolean).join(' ').trim() || 'Sans nom';
  const contact = existing.email || existing.phone || '';
  return {
    error: `Client existant : ${name}${contact ? ` (${contact})` : ''}.`,
    code: 'CLIENT_EXISTS',
    client: {
      id: existing.id,
      firstName: existing.firstName || '',
      lastName: existing.lastName || '',
      email: existing.email || '',
      phone: existing.phone || '',
    },
  };
}

module.exports = { clientExistsRefusal };
