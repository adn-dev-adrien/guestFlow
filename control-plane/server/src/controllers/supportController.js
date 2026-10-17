/**
 * Support access with consent, the console's side (specs/hosting-h2-account-security.md rules 12–14,
 * §4.2).
 *
 * - The operator asks for access with a reason: the console signs a request and writes it next to the
 *   customer's licence (`<instance>/data/support-request.jws`). The instance shows it to its
 *   administrators, who accept or refuse. Nothing is sent over the network.
 * - The state — pending, open, last decision — is read in the instance's database, read-only, like
 *   the directory and the installed plugins.
 * - While an access is open, « Ouvrir l'espace » mints a sign-in link signed with the licence key,
 *   valid 2 minutes and accepted once by the instance.
 *
 * Every request and every link is written to the customer's journal.
 */

const crypto = require('crypto');
const { supportAccess } = require('../utils/gf');
const { httpError } = require('../utils/httpError');

const frDateTime = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) : null);

function createSupportController(ctx, customers) {
  const { models, now, instances, issuer } = ctx;

  function customerOf(id) {
    const c = models.customers.get(id);
    if (!c || c.erasedAt) throw httpError(404, 'NOT_FOUND', 'Client introuvable.');
    return c;
  }

  function stateOf(c) {
    if (!issuer.canSign) return { available: false, unavailableReason: 'Aucune clé de licence sur la console.' };
    if (c.archivedAt) return { available: false, unavailableReason: 'Client archivé.' };
    const slug = customers.servedSlug(c);
    const read = instances.readSupportAccess(slug, now().toISOString());
    if (!read) return { available: false, unavailableReason: 'Instance illisible, ou antérieure aux accès du support.' };
    const { pending, open, last } = read;
    let state = 'none';
    let stateLabel = 'Aucun accès';
    if (open) {
      state = 'open';
      stateLabel = `Ouvert jusqu’au ${frDateTime(open.expiresAt)}`;
    } else if (pending) {
      state = 'pending';
      stateLabel = `En attente de réponse : « ${pending.reason} »`;
    }
    let lastLabel = null;
    if (!open && last) {
      if (last.decision === 'refused') lastLabel = `Dernière demande refusée le ${frDateTime(last.decidedAt)}.`;
      else if (last.revokedAt) lastLabel = `Dernier accès révoqué le ${frDateTime(last.revokedAt)}.`;
      else lastLabel = `Dernier accès expiré le ${frDateTime(last.expiresAt)}.`;
    }
    return { available: true, state, stateLabel, lastLabel, canOpen: Boolean(open) };
  }

  function state(id) {
    return stateOf(customerOf(id));
  }

  // Rule 12 — a new request replaces the pending one on the instance.
  function request(id, { reason } = {}, operator) {
    const c = customerOf(id);
    const current = stateOf(c);
    if (!current.available) throw httpError(409, 'UNAVAILABLE', current.unavailableReason);
    if (current.state === 'open') throw httpError(409, 'ALREADY_OPEN', 'Un accès est déjà ouvert.');
    const text = String(reason || '').trim();
    if (!text) throw httpError(400, 'INVALID', 'Motif obligatoire.', { errors: { reason: 'Motif obligatoire.' } });
    if (text.length > supportAccess.REASON_MAX) {
      throw httpError(400, 'INVALID', `${supportAccess.REASON_MAX} caractères au plus.`, { errors: { reason: `${supportAccess.REASON_MAX} caractères au plus.` } });
    }
    const slug = customers.servedSlug(c);
    const token = supportAccess.signRequest({ slug, requestId: crypto.randomUUID(), reason: text, requestedAt: now().toISOString() }, issuer.privateKey);
    const written = issuer.writeFile(slug, supportAccess.REQUEST_FILE, token);
    if (!written.written) throw httpError(502, 'WRITE_FAILED', written.reason);
    customers.journal(c.id, operator, 'support', `Accès du support demandé : « ${text} ».`);
    return state(id);
  }

  // Rule 14 — the single-use sign-in link, only while the customer's access is open.
  function link(id, operator) {
    const c = customerOf(id);
    const slug = customers.servedSlug(c);
    const read = issuer.canSign ? instances.readSupportAccess(slug, now().toISOString()) : null;
    if (!read || !read.open) throw httpError(409, 'NOT_OPEN', 'Aucun accès ouvert : le client doit d’abord l’autoriser.');
    const token = supportAccess.signLink({ slug, accessId: read.open.id, jti: crypto.randomUUID(), now: now() }, issuer.privateKey);
    customers.journal(c.id, operator, 'support', 'Espace du client ouvert par le support.');
    return { url: `${customers.urlOf(slug)}/api/auth/support?token=${encodeURIComponent(token)}`, validSeconds: supportAccess.LINK_TTL_MS / 1000 };
  }

  return { state, request, link };
}

module.exports = { createSupportController };
