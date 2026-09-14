/**
 * Portier, seen from guestFlow (specs/gate-access-portier.md §3.2-§3.6, Portier `specs/contract.md` §3-§4).
 *
 * Portier has no login of its own: the owner reaches it through guestFlow, signed in as an admin.
 * This controller is that door, and it only opens onto an ALLOWLIST of Portier's owner routes
 * (contract §3.2) — never a generic proxy. Every call is signed with the acting user
 * (`<user id>|<email>`), which Portier writes in its journal. The role guard keeps `/api/portier/*`
 * admin-only.
 *
 * It shapes what comes back for the page (utils/portierAccessView.js): French sentences on the Paris
 * wall clock, and editor values the client can send back without any date arithmetic.
 *
 * It also serves the fiche card and receives Portier's one event, `devices_over_six`, which is only
 * accepted from the loopback socket and with a valid signature.
 */

const db = require('../database');
const reservationsModel = require('../models/reservationsModel');
const portierClient = require('../utils/portierClient');
const portierSync = require('../utils/portierSync');
const view = require('../utils/portierAccessView');
const { cardForFiche } = require('../utils/portierInvitation');
const { pushToAdmins } = require('../utils/adminPush');

const { PortierUnavailableError, actorOf, decodeKey, verifyEvent } = portierClient;

const ACCESS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OWNER_ACTIONS = new Set(['suspend', 'resume', 'invite', 'regenerate', 'recreate']);
const CREATE_FIELDS = ['label', 'validFrom', 'validUntil', 'timeWindows'];
const EDIT_FIELDS = ['label', 'validFrom', 'validUntil', 'earlyFrom', 'extendedUntil', 'timeWindows'];
const LOGO_TYPES = new Set(['image/png', 'image/svg+xml', 'image/jpeg']);
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const NOT_CONFIGURED = { error: 'portier_not_configured', message: "Portier n'est pas configuré sur ce serveur." };
const UNAVAILABLE = { error: 'portier_unavailable', message: 'Portier ne répond pas.' };
const GONE = { error: 'not_found', message: "Cet accès n'existe plus." };

function brandingView(branding) {
  const b = branding || {};
  return {
    source: b.source === 'custom' ? 'custom' : 'guestflow',
    syncLabel: b.guestflowUpdatedAt
      ? `Logo de Réglages › Société, envoyé à Portier le ${view.dayTime(b.guestflowUpdatedAt)}.`
      : "Le logo de Réglages › Société n'a pas encore été envoyé à Portier.",
    customLabel: b.source === 'custom' && b.updatedAt ? `Logo personnalisé enregistré le ${view.dayTime(b.updatedAt)}.` : '',
  };
}

function buildController({
  client = portierClient,
  database = db,
  findReservation = (id) => reservationsModel.getRow(id),
  env = process.env,
  now = () => new Date(),
  notifyAdmins = pushToAdmins,
  logger = console,
} = {}) {
  // Resolves Portier's answer, or answers the request itself (503 / 502) and resolves null.
  async function ask(req, res, request) {
    try {
      return await client.call({ ...request, actor: actorOf(req.user) });
    } catch (err) {
      if (!(err instanceof PortierUnavailableError)) throw err;
      if (err.code === 'not_configured') {
        res.status(503).json(NOT_CONFIGURED);
      } else {
        logger.warn(`[portier] ${request.method} ${request.path.split('?')[0]}: ${err.message}`);
        res.status(502).json(UNAVAILABLE);
      }
      return null;
    }
  }

  function refused(res, answer) {
    const data = answer.data || {};
    if (answer.status === 422) {
      return res.status(422).json({ field: data.field || '', reason: data.reason || '', message: view.refusalMessage(data.reason) });
    }
    if (answer.status === 409) {
      return res.status(409).json({ error: 'invalid_state', message: "Cette action ne correspond plus à l'état de l'accès." });
    }
    if (answer.status === 404) return res.status(404).json(GONE);
    return res.status(502).json(UNAVAILABLE);
  }

  function inputRefused(res, err) {
    if (!(err instanceof view.AccessInputError)) throw err;
    return res.status(422).json({ field: err.field, reason: err.reason, message: view.refusalMessage(err.reason) });
  }

  const accessOf = (req, access) => view.accessView(access, { user: req.user, nowMs: now().getTime() });
  const idOf = (req) => (ACCESS_ID.test(String(req.params.id || '')) ? req.params.id : null);

  async function list(req, res) {
    const listed = view.VIEWS.includes(req.query.view) ? req.query.view : 'current';
    const kind = view.KINDS.includes(req.query.kind) ? req.query.kind : 'all';
    const state = listed === 'finished' ? 'finished' : 'current';
    const answer = await ask(req, res, { method: 'GET', path: `/svc/v1/accesses?state=${state}` });
    if (!answer) return undefined;
    if (answer.status !== 200) return refused(res, answer);
    const at = now();
    const failing = portierSync.failingSummary(database, { now: at });
    return res.json({
      ...view.listView(answer.data || {}, { view: listed, kind, user: req.user, nowMs: at.getTime() }),
      pushFailing: failing
        ? {
          text: "Portier n'a pas reçu la dernière modification",
          detail: `${failing.reservations} modification${failing.reservations > 1 ? 's' : ''} en attente ${view.sinceText(failing.since, at.getTime())}`,
        }
        : null,
    });
  }

  async function getOne(req, res) {
    const id = idOf(req);
    if (!id) return res.status(404).json(GONE);
    const answer = await ask(req, res, { method: 'GET', path: `/svc/v1/accesses/${id}` });
    if (!answer) return undefined;
    if (answer.status !== 200) return refused(res, answer);
    return res.json({ access: accessOf(req, answer.data.access) });
  }

  async function create(req, res) {
    let body;
    try {
      body = view.accessWriteBody(req.body, CREATE_FIELDS);
    } catch (err) {
      return inputRefused(res, err);
    }
    const answer = await ask(req, res, { method: 'POST', path: '/svc/v1/accesses', body });
    if (!answer) return undefined;
    if (answer.status !== 201) return refused(res, answer);
    return res.status(201).json({ access: accessOf(req, answer.data.access) });
  }

  async function update(req, res) {
    const id = idOf(req);
    if (!id) return res.status(404).json(GONE);
    let body;
    try {
      body = view.accessWriteBody(req.body, EDIT_FIELDS);
    } catch (err) {
      return inputRefused(res, err);
    }
    const answer = await ask(req, res, { method: 'PATCH', path: `/svc/v1/accesses/${id}`, body });
    if (!answer) return undefined;
    if (answer.status !== 200) return refused(res, answer);
    return res.json({ access: accessOf(req, answer.data.access) });
  }

  async function action(req, res) {
    const id = idOf(req);
    if (!id || !OWNER_ACTIONS.has(req.params.action)) return res.status(404).json(GONE);
    const answer = await ask(req, res, { method: 'POST', path: `/svc/v1/accesses/${id}/${req.params.action}` });
    if (!answer) return undefined;
    if (answer.status !== 200) return refused(res, answer);
    return res.json({ access: accessOf(req, answer.data.access) });
  }

  async function remove(req, res) {
    const id = idOf(req);
    if (!id) return res.status(404).json(GONE);
    const answer = await ask(req, res, { method: 'DELETE', path: `/svc/v1/accesses/${id}` });
    if (!answer) return undefined;
    if (answer.status !== 204 && answer.status !== 200) return refused(res, answer);
    return res.status(204).end();
  }

  async function events(req, res) {
    const id = idOf(req);
    if (!id) return res.status(404).json(GONE);
    const answer = await ask(req, res, { method: 'GET', path: `/svc/v1/accesses/${id}/events` });
    if (!answer) return undefined;
    if (answer.status !== 200) return refused(res, answer);
    return res.json({ events: ((answer.data && answer.data.events) || []).map(view.eventView) });
  }

  async function getBranding(req, res) {
    const answer = await ask(req, res, { method: 'GET', path: '/svc/v1/branding' });
    if (!answer) return undefined;
    if (answer.status !== 200) return refused(res, answer);
    return res.json({ branding: brandingView(answer.data && answer.data.branding) });
  }

  async function setBrandingSource(req, res) {
    const source = String((req.body && req.body.source) || '');
    if (source !== 'guestflow' && source !== 'custom') {
      return res.status(422).json({ field: 'source', reason: 'source_invalid', message: 'Choisissez la source du logo.' });
    }
    const body = { source };
    if (source === 'custom') {
      if (!req.file) return res.status(422).json({ field: 'logo', reason: 'logo_required', message: view.refusalMessage('logo_required') });
      if (!LOGO_TYPES.has(req.file.mimetype)) return res.status(422).json({ field: 'logo', reason: 'logo_type', message: view.refusalMessage('logo_type') });
      body.logo = req.file.buffer.toString('base64');
      body.mime = req.file.mimetype;
    }
    const answer = await ask(req, res, { method: 'PUT', path: '/svc/v1/branding/source', body });
    if (!answer) return undefined;
    if (answer.status !== 200) return refused(res, answer);
    return res.json({ branding: brandingView(answer.data && answer.data.branding) });
  }

  function logoUploadRefused(err, res) {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(422).json({ field: 'logo', reason: 'logo_too_big', message: view.refusalMessage('logo_too_big') });
    }
    return res.status(400).json({ error: 'upload_failed', message: "Le fichier n'a pas pu être lu." });
  }

  // GET /api/reservations/:id/gate-access — the compact card of the fiche (§3.2).
  async function reservationCard(req, res) {
    const reservation = findReservation(Number(req.params.id));
    if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
    if (String(reservation.kind || 'reservation') !== 'reservation') return res.json({ status: 'none' });
    return res.json(await cardForFiche(reservation.id, { database, client, now: now() }));
  }

  // POST /internal/portier/v1/events — the only request Portier sends (contract §4).
  async function receiveEvent(req, res) {
    const remote = req.socket && req.socket.remoteAddress;
    if (!LOOPBACK.has(remote)) return res.status(403).json({ error: 'forbidden' });
    // Checking an event needs the shared key only, not the address guestFlow calls Portier on.
    const verdict = verifyEvent({
      key: decodeKey(env.PORTIER_KEY_GF),
      ts: req.get('X-Portier-Ts'),
      sig: req.get('X-Portier-Sig'),
      rawBody: req.rawBody || Buffer.alloc(0),
      now: now().getTime(),
    });
    if (!verdict.ok) return res.status(401).json({ error: verdict.error });
    const event = req.body || {};
    if (event.type === 'devices_over_six') {
      await notifyAdmins({
        title: 'Accès portail',
        body: `${Number(event.count)} téléphones sur l'accès de ${String(event.label || '')}`,
        url: '/portail',
        tag: `guestflow-portier-devices-${String(event.accessId || '')}`,
      });
    } else {
      logger.warn(`[portier] event of unknown type ignored: ${String(event.type).slice(0, 40)}`);
    }
    return res.status(204).end();
  }

  return {
    list, getOne, create, update, action, remove, events, getBranding, setBrandingSource, logoUploadRefused,
    reservationCard, receiveEvent,
  };
}

const defaultController = buildController();

module.exports = defaultController;
module.exports.buildController = buildController;
