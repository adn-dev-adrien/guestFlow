/**
 * Support access with consent (specs/hosting-h2-account-security.md rules 12–17).
 *
 * - The console's request arrives as a signed file next to the licence (utils/supportAccess.js); it
 *   becomes the banner every administrator sees, « Autoriser 24 h » / « Refuser » (rule 12).
 * - Accepting opens the access for 1 h, 24 h or 7 days; an administrator can revoke it (rule 13).
 * - A signed, 2-minute, single-use link opens a session as « Support GuestFlow », only while the
 *   access is open (rule 14). The session ends at the first request after the access closed.
 * - Paramètres › Accès du support lists the accesses and their logs, read-only (rule 15).
 * - Without `GUESTFLOW_LICENCE_PUBLIC_KEY` none of this exists (rule 17).
 */

const supportAccess = require('../utils/supportAccess');
const { httpError } = require('../utils/httpError');
const { ADMIN, userHasRole } = require('../constants/roles');

const parisDateTime = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) : null);
const durationLabel = (hours) => (hours === 168 ? '7 jours' : `${hours} h`);
const nameOf = (name, email) => (String(name || '').trim() || email || '—');

function createSupportAccessController({
  model,
  users,
  publicKey,
  slug = null,
  readRequest = () => null,
  now = () => new Date(),
}) {
  const nowIso = () => now().toISOString();
  const enabled = () => Boolean(publicKey);

  function assertEnabled() {
    if (!enabled()) throw httpError(404, 'SUPPORT_ACCESS_UNAVAILABLE', 'Accès du support indisponible.');
  }

  // The console's request file → the pending row (a new reason replaces the pending one).
  function syncRequest() {
    const request = readRequest();
    if (request) model.receiveRequest(request);
  }

  function stateOf(row) {
    if (!row.decision) return { state: 'pending', stateLabel: 'En attente' };
    if (row.decision === 'refused') return { state: 'refused', stateLabel: 'Refusé' };
    if (row.revokedAt) return { state: 'revoked', stateLabel: 'Révoqué' };
    if (row.expiresAt > nowIso()) return { state: 'open', stateLabel: `Ouvert jusqu’au ${parisDateTime(row.expiresAt)}` };
    return { state: 'expired', stateLabel: 'Expiré' };
  }

  // The banner, for an administrator: the pending request, if any.
  function banner(user) {
    if (!enabled() || !userHasRole(user, ADMIN) || user.isSupport) return { pending: null };
    syncRequest();
    const pending = model.pending();
    return {
      pending: pending ? { id: pending.id, reason: pending.reason, requestedAt: pending.requestedAt } : null,
      durations: supportAccess.DURATION_HOURS.map((h) => ({ hours: h, label: durationLabel(h) })),
      defaultHours: supportAccess.DEFAULT_HOURS,
    };
  }

  function decide(user, id, { decision, hours } = {}) {
    assertEnabled();
    const row = model.get(id);
    if (!row) throw httpError(404, 'NOT_FOUND', 'Demande introuvable.');
    if (decision === 'refuse') {
      if (!model.decide(id, { decision: 'refused', userId: user.id, nowIso: nowIso() })) throw httpError(409, 'ALREADY_DECIDED', 'Demande déjà traitée.');
      return view();
    }
    if (decision !== 'accept') throw httpError(400, 'INVALID_DECISION', 'Décision inconnue.');
    const h = hours == null ? supportAccess.DEFAULT_HOURS : Number(hours);
    if (!supportAccess.DURATION_HOURS.includes(h)) throw httpError(400, 'INVALID_DURATION', 'Durée : 1 h, 24 h ou 7 jours.');
    const expiresAt = new Date(now().getTime() + h * 3600000).toISOString();
    if (!model.decide(id, { decision: 'accepted', userId: user.id, nowIso: nowIso(), expiresAt })) throw httpError(409, 'ALREADY_DECIDED', 'Demande déjà traitée.');
    return view();
  }

  function revoke(user, id) {
    assertEnabled();
    const row = model.get(id);
    if (!row || stateOf(row).state !== 'open') throw httpError(409, 'NOT_OPEN', 'Aucun accès ouvert à révoquer.');
    model.revoke(id, user.id, nowIso());
    return view();
  }

  // Paramètres › Accès du support (rule 15).
  function view() {
    assertEnabled();
    syncRequest();
    return {
      accesses: model.list().map((row) => ({
        id: row.id,
        reason: row.reason,
        requestedAt: row.requestedAt,
        requestedAtLabel: parisDateTime(row.requestedAt),
        decisionLabel: !row.decision ? '—'
          : `${row.decision === 'accepted' ? 'Autorisé' : 'Refusé'} par ${nameOf(row.decidedByName, row.decidedByEmail)} le ${parisDateTime(row.decidedAt)}`,
        revokedLabel: row.revokedAt ? `Révoqué par ${nameOf(row.revokedByName, row.revokedByEmail)} le ${parisDateTime(row.revokedAt)}` : null,
        expiresAt: row.expiresAt,
        logCount: row.logCount,
        ...stateOf(row),
      })),
    };
  }

  function logs(id) {
    assertEnabled();
    if (!model.get(id)) throw httpError(404, 'NOT_FOUND', 'Accès introuvable.');
    return {
      entries: model.logs(id).map((l) => ({
        at: l.at,
        atLabel: parisDateTime(l.at),
        label: l.method === 'PAGE' ? `Page ouverte : ${l.path}` : l.method === 'LOGIN' ? 'Connexion du support' : `${l.method} ${l.path}`,
        summary: l.summary,
      })),
    };
  }

  // Rule 14 — the console's link → the session to open: { user, accessId, expiresAt }.
  function consumeLink(token) {
    assertEnabled();
    let payload;
    try {
      payload = supportAccess.verifyLink(String(token || ''), { publicKey, slug, now: now() });
    } catch {
      throw httpError(401, 'INVALID_LINK', 'Lien support invalide ou expiré.');
    }
    const access = model.get(payload.accessId);
    if (!access || stateOf(access).state !== 'open') throw httpError(401, 'INVALID_LINK', 'Lien support invalide ou expiré.');
    if (!model.useLink(payload.jti, access.id, nowIso())) throw httpError(401, 'INVALID_LINK', 'Lien support invalide ou expiré.');
    const user = users.findByEmail(supportAccess.SUPPORT_USER_EMAIL);
    if (!user) throw httpError(401, 'INVALID_LINK', 'Lien support invalide ou expiré.');
    model.addLog(access.id, { at: nowIso(), method: 'LOGIN', path: '/', summary: '' });
    return { user, accessId: access.id, expiresAt: access.expiresAt };
  }

  // The support session is alive only while its access is open (§3 edge case: expiry ends it).
  function sessionAccess(accessId) {
    const access = accessId ? model.get(accessId) : null;
    return access && stateOf(access).state === 'open' ? access : null;
  }

  function record(accessId, entry) {
    model.addLog(accessId, { at: nowIso(), ...entry });
  }

  return { enabled, banner, decide, revoke, view, logs, consumeLink, sessionAccess, record, syncRequest };
}

module.exports = { createSupportAccessController };
