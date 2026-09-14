// specs/gate-access-portier.md §3.4-§3.5 — `/api/portier/*`, the owner's list behind guestFlow's login.
//
// Three things are pinned: who gets in (admin only, reception keeps its SAS read), what goes out
// (an allowlist of Portier's owner routes, signed with the acting user, wall-clock values turned into
// instants), and what comes back (the list in words, the refusals in French, an outage said plainly).

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const enforceRoleAccess = require('../middleware/enforceRoleAccess');
const { buildController } = require('../controllers/portierController');
const { PortierUnavailableError } = require('../utils/portierClient');
const { PORTIER_OUTBOX_SQL } = require('../utils/portierSchema');
const { eventView } = require('../utils/portierAccessView');

const NOW = new Date('2026-09-13T09:00:00.000Z'); // 11:00 in Paris
const ADMIN = { id: 7, email: 'adrien@example.com', roles: ['admin'] };
const STAY_ID = '6f1c2a9e-3b7d-4c55-9a10-2e8f4b6d7c01';
const MANUAL_ID = 'b3d5e7f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

const STAY_ACCESS = {
  id: STAY_ID, kind: 'stay', label: 'Camille (Gîte · 202609042)',
  reservation: { id: 42, number: '202609042', propertyName: 'Gîte', guestFirstName: 'Camille' },
  stay: { startsAt: '2026-09-12T14:00:00.000Z', endsAt: '2026-09-14T09:00:00.000Z', revision: 3 },
  validFrom: null, validUntil: null, earlyFrom: null, extendedUntil: '2026-09-14T16:00:00.000Z',
  window: { from: '2026-09-12T14:00:00.000Z', until: '2026-09-14T16:00:00.000Z' },
  timeWindows: [], state: 'active', suspendedAt: null, cancelledAt: null, cancelReason: null, deletedAt: null,
  invitation: { code: '4K7M-9QT2', url: 'https://guest.domainesolio.com/#i=4K7M9QT2' },
  devices: { count: 2, lastUsedAt: '2026-09-13T06:00:00.000Z' },
  createdBy: 'guestflow', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-13T06:00:00.000Z',
};
const MANUAL_ACCESS = {
  id: MANUAL_ID, kind: 'manual', label: 'Paul (voisin)', reservation: null, stay: null,
  validFrom: null, validUntil: null, earlyFrom: null, extendedUntil: null, window: { from: null, until: null },
  timeWindows: [{ from: '08:00', until: '20:00' }], state: 'suspended',
  suspendedAt: '2026-09-10T10:00:00.000Z', cancelledAt: null, cancelReason: null, deletedAt: null,
  invitation: { code: 'P2NC-7VJ4', url: 'https://guest.domainesolio.com/#i=P2NC7VJ4' },
  devices: { count: 1, lastUsedAt: '2026-05-25T09:00:00.000Z' },
  createdBy: { id: 7, email: 'adrien@example.com' }, createdAt: '2026-05-02T10:00:00.000Z', updatedAt: '2026-09-10T10:00:00.000Z',
};

function fakeClient(answers = []) {
  const calls = [];
  return {
    calls,
    isConfigured: () => true,
    async call(request) {
      calls.push(request);
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

function controllerWith(client) {
  const database = new Database(':memory:');
  database.exec(PORTIER_OUTBOX_SQL);
  return buildController({ client, database, now: () => NOW, logger: { warn() {} } });
}

function fakeRes() {
  return {
    statusCode: 200, body: undefined, ended: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

const request = (over = {}) => ({ user: ADMIN, params: {}, query: {}, body: {}, ...over });

// ── Who gets in ──────────────────────────────────────────────────────────────────────────────────

function roleVerdict(user, method, path) {
  let passed = false;
  const res = fakeRes();
  enforceRoleAccess({ user, method, path }, res, () => { passed = true; });
  return passed ? 'next' : res.statusCode;
}

test('/api/portier/*: an admin passes; an accountant and reception get 403, reading or writing', () => {
  for (const [method, path] of [['GET', '/portier/accesses'], ['POST', `/portier/accesses/${STAY_ID}/regenerate`], ['PUT', '/portier/branding/source']]) {
    assert.equal(roleVerdict({ roles: ['admin'] }, method, path), 'next');
    assert.equal(roleVerdict({ roles: ['accountant'] }, method, path), 403);
    assert.equal(roleVerdict({ roles: ['reception'] }, method, path), 403);
  }
});

test('reception keeps the SAS invitation read, and nothing else of the gate', () => {
  assert.equal(roleVerdict({ roles: ['reception'] }, 'GET', '/reservations/42/sas/gate-access'), 'next');
  assert.equal(roleVerdict({ roles: ['reception'] }, 'GET', '/reservations/42/gate-access'), 403, 'the fiche card is the owner\'s');
  assert.equal(roleVerdict({ roles: ['accountant'] }, 'GET', '/reservations/42/sas/gate-access'), 403);
});

// ── What goes out ────────────────────────────────────────────────────────────────────────────────

test('the list is read as the acting user, and the finished filter asks Portier for finished stays', async () => {
  const client = fakeClient([
    { status: 200, data: { accesses: [], house: null } },
    { status: 200, data: { accesses: [], house: null } },
  ]);
  const controller = controllerWith(client);
  await controller.list(request({ query: {} }), fakeRes());
  await controller.list(request({ query: { view: 'finished' } }), fakeRes());
  assert.deepEqual(client.calls, [
    { method: 'GET', path: '/svc/v1/accesses?state=current', actor: '7|adrien@example.com' },
    { method: 'GET', path: '/svc/v1/accesses?state=finished', actor: '7|adrien@example.com' },
  ]);
});

test('only the owner routes of the contract leave: an unknown action or a malformed id never reaches Portier', async () => {
  const client = fakeClient([{ status: 200, data: { access: STAY_ACCESS } }]);
  const controller = controllerWith(client);

  const unknown = fakeRes();
  await controller.action(request({ params: { id: STAY_ID, action: 'revoke-phone' } }), unknown);
  const traversal = fakeRes();
  await controller.action(request({ params: { id: '../../stays/42', action: 'invite' } }), traversal);
  assert.equal(unknown.statusCode, 404);
  assert.equal(traversal.statusCode, 404);
  assert.equal(client.calls.length, 0);

  const res = fakeRes();
  await controller.action(request({ params: { id: STAY_ID, action: 'invite' } }), res);
  assert.deepEqual(client.calls, [{ method: 'POST', path: `/svc/v1/accesses/${STAY_ID}/invite`, actor: '7|adrien@example.com' }]);
  assert.equal(res.body.access.code, '4K7M-9QT2');
});

test('creation: only the allowed fields go, and the Paris wall clock becomes an instant (DST included)', async () => {
  const client = fakeClient([{ status: 201, data: { access: MANUAL_ACCESS } }]);
  const controller = controllerWith(client);
  const res = fakeRes();
  await controller.create(request({
    body: {
      label: 'Les Martin (cousins)', validFrom: '2026-10-24T09:00', validUntil: '2026-10-26T18:00',
      timeWindows: [{ from: '09:00', until: '22:00' }], earlyFrom: '2026-10-20T09:00', createdBy: 'guestflow',
    },
  }), res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(client.calls[0].body, {
    label: 'Les Martin (cousins)',
    validFrom: '2026-10-24T07:00:00.000Z',
    validUntil: '2026-10-26T17:00:00.000Z',
    timeWindows: [{ from: '09:00', until: '22:00' }],
  });
});

test('an edit clears a field with an empty value, and refuses an unreadable date before asking Portier', async () => {
  const client = fakeClient([{ status: 200, data: { access: STAY_ACCESS } }]);
  const controller = controllerWith(client);
  const bad = fakeRes();
  await controller.update(request({ params: { id: STAY_ID }, body: { extendedUntil: 'demain' } }), bad);
  assert.equal(bad.statusCode, 422);
  assert.deepEqual(bad.body, { field: 'extendedUntil', reason: 'datetime_invalid', message: 'Date ou heure invalide.' });
  assert.equal(client.calls.length, 0);

  await controller.update(request({ params: { id: STAY_ID }, body: { extendedUntil: '' } }), fakeRes());
  assert.deepEqual(client.calls[0], { method: 'PATCH', path: `/svc/v1/accesses/${STAY_ID}`, body: { extendedUntil: null }, actor: '7|adrien@example.com' });
});

// ── What comes back ──────────────────────────────────────────────────────────────────────────────

test('the list comes back grouped and in words: tags, validity, hours, phones, last use, house line', async () => {
  const client = fakeClient([{
    status: 200,
    data: { accesses: [STAY_ACCESS, MANUAL_ACCESS], house: { link: 'up', since: '2026-09-13T04:12:00.000Z', gateState: 'closed', gateStateAt: null } },
  }]);
  const res = fakeRes();
  await controllerWith(client).list(request(), res);

  assert.equal(res.body.house.text, 'Maison connectée depuis 06:12 · portail fermé');
  assert.deepEqual(res.body.groups.map((g) => [g.title, g.accesses.map((a) => a.label)]), [
    ['Actifs', ['Camille (Gîte · 202609042)']],
    ['Suspendus', ['Paul (voisin)']],
  ]);
  const [stay] = res.body.groups[0].accesses;
  assert.deepEqual(
    [stay.tag.label, stay.subtitle, stay.validity, stay.hours, stay.phones, stay.lastUse],
    ['guestFlow', 'Gîte · 202609042', 'Du 12/09 à 16:00 au 14/09 à 18:00 · prolongé à la main', 'à toute heure', 2, 'il y a 3 h'],
  );
  assert.equal(stay.confirm.invite, 'Le code et le QR de « Camille (Gîte · 202609042) » changent. Les 2 téléphones déjà installés continuent. L\'ancien QR ne servira plus.');
  assert.equal(stay.confirm.regenerate, 'Les 2 téléphones de « Camille (Gîte · 202609042) » s\'arrêtent et devront être réinstallés avec le nouveau code. C\'est ainsi qu\'on coupe un téléphone perdu.');
  assert.equal(stay.edit.stayUntil, '2026-09-14T11:00');
  const [manual] = res.body.groups[1].accesses;
  assert.deepEqual(
    [manual.tag.label, manual.validity, manual.hours, manual.lastUse, manual.actions.resume, manual.actions.suspend],
    ['créé par moi', 'Toujours valable', '08:00 → 20:00', 'il y a 111 jours', true, false],
  );
  assert.equal(res.body.pushFailing, null);
});

test('the « créés par moi » filter and a house down', async () => {
  const client = fakeClient([{
    status: 200,
    data: { accesses: [STAY_ACCESS, MANUAL_ACCESS], house: { link: 'down', since: '2026-09-13T12:03:00.000Z', gateState: 'unknown' } },
  }]);
  const res = fakeRes();
  await controllerWith(client).list(request({ query: { kind: 'mine' } }), res);
  assert.deepEqual(res.body.groups.map((g) => g.accesses.map((a) => a.id)), [[MANUAL_ID]]);
  assert.deepEqual(res.body.house, { up: false, text: 'Maison injoignable depuis 14:03 — les clients lisent « maison injoignable »' });
});

test('Portier refuses (422, 409, 404) → the page gets the reason in French', async () => {
  const client = fakeClient([
    { status: 422, data: { field: 'earlyFrom', reason: 'early_not_before_stay' } },
    { status: 409, data: { error: 'invalid_state' } },
    { status: 404, data: { error: 'not_found' } },
  ]);
  const controller = controllerWith(client);
  const refused = fakeRes();
  await controller.update(request({ params: { id: STAY_ID }, body: { earlyFrom: '2026-09-13T09:00' } }), refused);
  assert.deepEqual([refused.statusCode, refused.body.message], [422, "Une ouverture anticipée doit précéder l'arrivée."]);
  const conflict = fakeRes();
  await controller.action(request({ params: { id: STAY_ID, action: 'resume' } }), conflict);
  assert.equal(conflict.statusCode, 409);
  const gone = fakeRes();
  await controller.remove(request({ params: { id: STAY_ID } }), gone);
  assert.equal(gone.statusCode, 404);
});

test('Portier down → 502 « Portier ne répond pas. »; not configured → 503, and nothing cached is served', async () => {
  const down = fakeRes();
  await controllerWith(fakeClient([new PortierUnavailableError('timeout')])).list(request(), down);
  assert.deepEqual([down.statusCode, down.body], [502, { error: 'portier_unavailable', message: 'Portier ne répond pas.' }]);
  const off = fakeRes();
  await controllerWith(fakeClient([new PortierUnavailableError('not_configured')])).list(request(), off);
  assert.equal(off.statusCode, 503);
});

test('delete answers 204; the journal is read in words', async () => {
  // The actor as Portier's journal shapes it: `{ id, email }`, or null (contract §3.3).
  const client = fakeClient([
    { status: 204, data: null },
    { status: 200, data: { events: [
      { id: 2, kind: 'invited', reason: null, source: 'owner', actor: { id: 7, email: 'adrien@example.com' }, deviceId: null, at: '2026-09-13T07:30:00.000Z' },
      { id: 1, kind: 'stay_created', reason: '2026-09-12T14:00:00.000Z → 2026-09-14T09:00:00.000Z', source: 'guestflow', actor: null, deviceId: null, at: '2026-09-01T10:00:00.000Z' },
    ] } },
  ]);
  const controller = controllerWith(client);
  const removed = fakeRes();
  await controller.remove(request({ params: { id: MANUAL_ID } }), removed);
  assert.deepEqual([removed.statusCode, removed.ended], [204, true]);
  const journal = fakeRes();
  await controller.events(request({ params: { id: STAY_ID } }), journal);
  assert.deepEqual(journal.body.events, [
    { id: 2, at: '13/09 à 09:30', text: 'Nouvelle invitation', who: 'adrien@example.com' },
    { id: 1, at: '01/09 à 12:00', text: 'Séjour reçu de guestFlow — du 12/09 à 16:00 au 14/09 à 11:00', who: 'guestFlow' },
  ]);
});

test('every journal kind Portier writes reads in French, its reason too', () => {
  // Kinds and reasons exactly as Portier's journal writes them (its src/, 2026-09-14).
  const line = (kind, reason = null, source = 'portier', actor = null) => eventView({ id: 1, kind, reason, source, actor, deviceId: null, at: '2026-09-13T07:30:00.000Z' });
  const owner = { id: 7, email: 'adrien@example.com' };
  const texts = {
    created: [line('created', 'Paul (voisin)', 'owner', owner), 'Accès créé — Paul (voisin)'],
    edited: [line('edited', 'validFrom, validUntil, timeWindows', 'owner', owner), 'Accès modifié — début, fin, plages horaires'],
    editedStay: [line('edited', 'earlyFrom, extendedUntil', 'owner', owner), 'Accès modifié — ouverture anticipée, prolongation'],
    suspended: [line('suspended', null, 'owner', owner), 'Accès suspendu'],
    resumed: [line('resumed', null, 'owner', owner), 'Accès repris'],
    invited: [line('invited', null, 'owner', owner), 'Nouvelle invitation'],
    regenerated: [line('regenerated', null, 'owner', owner), 'Accès régénéré'],
    deleted: [line('deleted', null, 'owner', owner), 'Accès supprimé'],
    recreated: [line('recreated', null, 'owner', owner), 'Accès recréé'],
    stayUpdated: [line('stay_updated', '2026-09-22T14:00:00.000Z → 2026-09-26T09:00:00.000Z', 'guestflow'), 'Séjour modifié par guestFlow — du 22/09 à 16:00 au 26/09 à 11:00'],
    cancelled: [line('stay_cancelled', 'cancelled', 'guestflow'), 'Réservation annulée'],
    cancelDeleted: [line('stay_cancelled', 'deleted', 'guestflow'), 'Réservation supprimée'],
    cancelDevis: [line('stay_cancelled', 'devis', 'guestflow'), 'Réservation repassée en devis'],
    reinstated: [line('stay_reinstated', 'révision 12', 'guestflow'), 'Réservation rétablie — révision 12'],
    refused: [line('stay_refused', 'window_too_long (réservation 42, révision 9)', 'guestflow'), 'Modification de guestFlow refusée — séjour de plus de 60 jours (réservation 42, révision 9)'],
    ignored: [line('stay_ignored_deleted', 'révision 13', 'guestflow'), 'Modification de guestFlow ignorée : accès supprimé — révision 13'],
    enrolled: [line('enrolled', 'nouveau téléphone · iPhone', 'guest'), 'Téléphone installé — nouveau téléphone · iPhone'],
    opened: [line('open', 'opened', 'guest'), "Demande d'ouverture — portail actionné"],
    shared: [line('open', 'opened · appui partagé', 'guest'), "Demande d'ouverture — portail actionné · appui partagé"],
    outside: [line('open', 'outside_hours', 'guest'), "Demande d'ouverture — refusé : hors des plages horaires"],
    noAnswer: [line('open', 'no_answer · never_sent', 'guest'), "Demande d'ouverture — pas de réponse de la maison · jamais transmis"],
    busy: [line('open', 'refused · busy', 'guest'), "Demande d'ouverture — refusé par la maison · portail occupé"],
    late: [line('late_result', 'arrivé après abandon · opened', 'house'), 'Réponse de la maison arrivée trop tard — portail actionné'],
    overSix: [line('devices_over_six', '7 téléphones'), 'Plus de six téléphones — 7 téléphones'],
    eventFailed: [line('event_failed', 'devices_over_six non remis à guestFlow : HTTP 500'), 'Alerte non remise à guestFlow — devices_over_six non remis à guestFlow : HTTP 500'],
    purge: [line('purge', '1 séjours, 0 lignes de journal, 0 commandes'), 'Purge quotidienne — 1 séjours, 0 lignes de journal, 0 commandes'],
    houseUp: [line('house_connected', 'plugin 1.0.0 · ping 600 s', 'house'), 'Maison connectée — plugin 1.0.0 · ping 600 s'],
    houseDown: [line('house_disconnected', 'fermeture 1006'), 'Maison déconnectée — fermeture 1006'],
    houseAuth: [line('house_auth_refused', 'authentification invalide', 'house'), 'Connexion de la maison refusée — authentification invalide'],
    houseFrame: [line('house_frame_refused', 'trame rejouée', 'house'), 'Message de la maison refusé — trame rejouée'],
    unknown: [line('something_new', 'x'), 'something_new — x'],
  };
  for (const [name, [view, text]] of Object.entries(texts)) assert.equal(view.text, text, name);
  assert.equal(texts.edited[0].who, 'adrien@example.com', 'the acting user is named');
  assert.equal(texts.enrolled[0].who, 'client');
  assert.equal(texts.cancelled[0].who, 'guestFlow');
  assert.equal(texts.overSix[0].who, 'Portier');
});

test('the custom logo: required, PNG/SVG/JPEG only, sent as base64 with its type', async () => {
  const client = fakeClient([{ status: 200, data: { branding: { source: 'custom', updatedAt: '2026-09-13T08:00:00.000Z', guestflowUpdatedAt: '2026-09-12T16:03:00.000Z' } } }]);
  const controller = controllerWith(client);
  const missing = fakeRes();
  await controller.setBrandingSource(request({ body: { source: 'custom' } }), missing);
  assert.equal(missing.body.reason, 'logo_required');
  const gif = fakeRes();
  await controller.setBrandingSource(request({ body: { source: 'custom' }, file: { mimetype: 'image/gif', buffer: Buffer.from('GIF') } }), gif);
  assert.equal(gif.body.reason, 'logo_type');
  assert.equal(client.calls.length, 0);

  const ok = fakeRes();
  await controller.setBrandingSource(request({ body: { source: 'custom' }, file: { mimetype: 'image/svg+xml', buffer: Buffer.from('<svg/>') } }), ok);
  assert.deepEqual(client.calls[0].body, { source: 'custom', logo: Buffer.from('<svg/>').toString('base64'), mime: 'image/svg+xml' });
  assert.equal(ok.body.branding.syncLabel, 'Logo de Réglages › Société, envoyé à Portier le 12/09 à 18:03.');
  assert.equal(controller.logoUploadRefused({ code: 'LIMIT_FILE_SIZE' }, fakeRes()).body.reason, 'logo_too_big');
});
