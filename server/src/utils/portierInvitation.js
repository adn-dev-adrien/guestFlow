/**
 * A stay's invitation, read from Portier when it is needed (specs/gate-access-portier.md §3.2, §3.3).
 *
 * guestFlow stores no code, no link and no QR: each reader asks Portier at the moment it needs one,
 * so a « Nouvelle invitation » made in the list reaches the next email, the SAS and the fiche with no
 * message back. Three shapes come out of one read:
 *
 *   - the email: the context's `gateAccess` (code, link, the app's address) — or « wait », when a
 *     template that carries the gate paragraph cannot get it (§3.2: the email never leaves without it);
 *   - the SAS: the code, the QR of the SAME address as the email, the window in force;
 *   - the fiche: the access's state, window, phones and last use, and whether the last push failed.
 *
 * The QR is built in memory and handed to the screen; it is never logged and never written anywhere.
 */

const QRCode = require('qrcode');
const defaultClient = require('./portierClient');
const portierSync = require('./portierSync');
const view = require('./portierAccessView');

const { PortierUnavailableError } = defaultClient;

const GATE_TOKENS = /\b(hasGateAccess|gateAccessCode|gateAccessUrl|gateAccessBaseUrl)\b/;
const NO_INVITATION_STATES = new Set(['revoked', 'deleted', 'after']);

function templateUsesGateAccess(...texts) {
  return texts.some((text) => GATE_TOKENS.test(String(text || '')));
}

/** @returns {Promise<{status:'ok', invitation} | {status:'not_found'|'not_configured'|'unavailable'}>} */
async function readInvitation(reservationId, { client = defaultClient } = {}) {
  if (!client.isConfigured()) return { status: 'not_configured' };
  try {
    const { status, data } = await client.call({ method: 'GET', path: `/svc/v1/stays/${Number(reservationId)}/invitation` });
    if (status === 200 && data && data.code && data.url) return { status: 'ok', invitation: data };
    if (status === 404) return { status: 'not_found' };
    return { status: 'unavailable' };
  } catch (err) {
    if (err instanceof PortierUnavailableError) return { status: err.code === 'not_configured' ? 'not_configured' : 'unavailable' };
    throw err;
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * The gate paragraph of an email. `wait: true` means Portier could not give the invitation of a live
 * stay to a template that needs it. A template without the gate tokens never asks; neither does a
 * devis, a cancelled stay, or an instance where Portier is not configured (guestFlow runs normally).
 */
async function gateAccessForEmail({ reservation, texts = [], client = defaultClient }) {
  if (!templateUsesGateAccess(...texts)) return { gateAccess: null, wait: false };
  if (!reservation || String(reservation.kind || 'reservation') !== 'reservation') return { gateAccess: null, wait: false };
  const read = await readInvitation(reservation.id, { client });
  if (read.status === 'not_configured') return { gateAccess: null, wait: false };
  if (read.status === 'ok') {
    const { invitation } = read;
    if (NO_INVITATION_STATES.has(invitation.state)) return { gateAccess: null, wait: false };
    return { gateAccess: { code: invitation.code, url: invitation.url, permanentUrl: originOf(invitation.url) }, wait: false };
  }
  // Not found: the stay's push has not reached Portier yet — the email waits for it like for an outage.
  return { gateAccess: null, wait: true };
}

const SAS_NOTICES = {
  suspended: "Cet accès est suspendu dans la liste : le client ne pourra pas ouvrir tant qu'il n'est pas repris.",
  revoked: "Cet accès est révoqué : la réservation n'est plus active.",
  deleted: "Accès supprimé dans la liste. « Recréer l'accès » se fait depuis la fiche.",
  after: 'Le séjour est terminé : cet accès ne fonctionne plus.',
};

/** The SAS step « Accès portail ». `fallbackCode` is the gate keypad's physical code (Réglages). */
async function invitationForSas(reservationId, { client = defaultClient, fallbackCode = '' } = {}) {
  const read = await readInvitation(reservationId, { client });
  if (read.status !== 'ok') return { status: read.status, fallbackCode };
  const { invitation } = read;
  const base = {
    status: 'ok',
    state: invitation.state,
    stateLabel: view.STATE_LABELS[invitation.state] || invitation.state,
    notice: SAS_NOTICES[invitation.state] || '',
    windowLabel: `Actif ${view.windowSentence(invitation.window)}`,
    fallbackCode,
  };
  if (NO_INVITATION_STATES.has(invitation.state)) return { ...base, code: '', qrDataUri: '' };
  const svg = await QRCode.toString(invitation.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
  return { ...base, code: invitation.code, qrDataUri: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}` };
}

const REFUSAL_TEXT = {
  window_too_long: 'séjour de plus de 60 jours',
  starts_too_far: 'séjour à plus de 18 mois',
};

/** The compact card of the reservation fiche (§3.2). The push banner is read even when Portier is down. */
async function cardForFiche(reservationId, { database, client = defaultClient, now = new Date() }) {
  const push = portierSync.reservationPushStatus(database, reservationId, { now });
  const banner = push.refusal
    ? `Portier a refusé la dernière modification : ${REFUSAL_TEXT[push.refusal.reason] || push.refusal.reason || 'valeur refusée'}.`
    : (push.failingSince ? "Portier n'a pas reçu la dernière modification" : '');
  if (!client.isConfigured()) return { status: 'not_configured', banner: '' };
  let answer;
  try {
    answer = await client.call({ method: 'GET', path: `/svc/v1/stays/${Number(reservationId)}` });
  } catch (err) {
    if (err instanceof PortierUnavailableError) return { status: 'unavailable', banner };
    throw err;
  }
  if (answer.status === 404) return { status: 'not_found', banner };
  if (answer.status !== 200 || !answer.data || !answer.data.access) return { status: 'unavailable', banner };
  const { access } = answer.data;
  const nowMs = now.getTime();
  return {
    status: 'ok',
    banner,
    access: {
      id: access.id,
      state: access.state,
      stateLabel: view.STATE_LABELS[access.state] || access.state,
      deleted: access.state === 'deleted',
      window: `${view.windowSentence(access.window).replace(/^./, (c) => c.toUpperCase())}`,
      phones: view.phonesText(access.devices && access.devices.count),
      lastUse: view.lastUseText(access.devices && access.devices.lastUsedAt, nowMs),
    },
  };
}

module.exports = {
  templateUsesGateAccess,
  readInvitation,
  gateAccessForEmail,
  invitationForSas,
  cardForFiche,
};
