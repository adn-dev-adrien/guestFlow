/**
 * The « Domotique » page (specs/guest-app-home-automation.md §3.C-§3.D, §4.3).
 *
 * Guest side: the page ready to render, a tap on a light, the state of that tap. Studio side: the lodging's blocks,
 * the catalogue shaped as pickers, the preview. The house's data comes from the Sowel connector through
 * `ctx.core.homeData()` (SDK 2.28.0) — this plugin never reads its tables and never calls the house.
 */

const sdk = require('../../sdk');
const { languageOf } = require('../language');
const { fail, refusal } = require('../refusals');
const { buildHomeView, HIDE_MS, FRESH_MS } = require('../homeView');
const { validateHomeBlocks } = require('../homeBlocksValidation');
const { KINDS, LIST_KINDS, fits, equipmentsOf, selectionOf } = require('../homeRoles');

const publicHttp = sdk.coreModule('publicHttp');

const MINUTE = 60 * 1000;

const parisDateTime = (iso) => new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso)).replace(' ', ' à ').replace(':', ' h ');

/** Rule 15 — the channel as Studio says it. */
function channelView(data, now) {
  if (!data) return { state: 'off', message: 'Le connecteur Sowel n’est pas actif dans Réglages › Intégrations.' };
  const c = data.channel();
  if (!c.lastReadingsAt) {
    return { state: 'never', message: 'Sowel n’a encore rien envoyé.', equipments: c.equipments };
  }
  const age = now.getTime() - Date.parse(c.lastReadingsAt);
  if (age <= FRESH_MS) {
    const minutes = Math.max(1, Math.round(age / MINUTE));
    return { state: 'ok', message: `Reçu de Sowel il y a ${minutes} min.`, equipments: c.equipments };
  }
  return {
    state: age > HIDE_MS ? 'gone' : 'silent',
    message: `Plus de nouvelles de Sowel depuis le ${parisDateTime(c.lastReadingsAt)}.`
      + (age > HIDE_MS ? ' La tuile Domotique est masquée chez les voyageurs.' : ''),
    equipments: c.equipments,
  };
}

/** Rule 13 — the pickers: the catalogue's equipments fitting each kind, by zone then name; a gone one is flagged. */
function pickersOf(catalog, blocks) {
  const referenced = new Set(blocks.flatMap((b) => equipmentsOf(b).map((e) => e.equipmentId)));
  const choice = (e) => ({
    id: e.id,
    label: e.zonePath ? `${e.zonePath} — ${e.name}` : e.name,
    ...(e.goneAt ? { gone: `Introuvable dans Sowel depuis le ${parisDateTime(e.goneAt)}` } : {}),
    ...(e.guestSwitchable ? { guestSwitchable: true } : {}),
  });
  return Object.fromEntries(KINDS.map((kind) => [kind, catalog
    .filter((e) => fits(kind, e) && (!e.goneAt || referenced.has(e.id)))
    .map(choice)]));
}

function buildHomeController({
  homeBlocks, lodgings, homeData = () => sdk.core.homeData(), now = () => new Date(),
}) {
  const propertyIdOf = (req) => {
    const id = Number(req.params.propertyId);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  /** Everything the view needs for one lodging, or null without a connector. */
  function viewOf(propertyId, lang) {
    const data = homeData();
    if (!data) return null;
    const blocks = homeBlocks().blocksOf(propertyId);
    const catalog = data.catalog();
    const pairs = selectionOf([blocks], catalog);
    return buildHomeView({
      blocks, catalog, readings: data.readings(pairs), series: data.series(pairs), now: now(), lang,
    });
  }

  /** Rule 17 — the module's prerequisite: a live connector heard within 6 h, and a block on with a present equipment. */
  function ready(propertyId) {
    const data = homeData();
    if (!data) return false;
    const { lastReadingsAt } = data.channel();
    if (!lastReadingsAt || now().getTime() - Date.parse(lastReadingsAt) > HIDE_MS) return false;
    const present = new Set(data.catalog().filter((e) => !e.goneAt).map((e) => e.id));
    return homeBlocks().blocksOf(propertyId)
      .some((b) => b.on && equipmentsOf(b).some(({ equipmentId }) => present.has(equipmentId)));
  }

  /** Rule 4 — what every lodging's switched-on blocks read. */
  function selection() {
    const data = homeData();
    if (!data) return [];
    return selectionOf(homeBlocks().all().map((l) => l.blocks), data.catalog());
  }

  /** The light the tap names, if the guest may switch it now (rule 7). */
  function pilotableLight(propertyId, lightId) {
    const data = homeData();
    if (!data) return null;
    const block = homeBlocks().blocksOf(propertyId).find((b) => b.kind === 'lights' && b.on);
    const item = block && block.items.find((i) => i.id === lightId);
    if (!item || !item.pilotable) return null;
    const entry = data.catalog().find((e) => e.id === item.equipmentId);
    if (!entry || entry.goneAt || !entry.guestSwitchable) return null;
    return item;
  }

  const COMMAND_TEXT = Object.freeze({
    fr: {
      expired: 'La maison ne répond pas. Réessayer dans un instant.',
      not_occupied: 'Possible uniquement pendant le séjour.',
      rate_limited: 'Trop de demandes. Réessayer dans quelques minutes.',
      refused: 'Commande refusée par la maison.',
    },
    en: {
      expired: 'The house is not answering. Try again in a moment.',
      not_occupied: 'Only possible during the stay.',
      rate_limited: 'Too many requests. Try again in a few minutes.',
      refused: 'The house refused the command.',
    },
  });

  function commandView(command, lang) {
    const words = COMMAND_TEXT[lang] || COMMAND_TEXT.fr;
    const state = command.state === 'collected' ? 'pending' : command.state;
    const message = state === 'expired' ? words.expired
      : (state === 'refused' ? (words[command.reason] || words.refused) : null);
    return { id: command.id, state, on: command.value === 'on', ...(message ? { message } : {}) };
  }

  return {
    ready,
    selection,

    /** GET /public/v1/guest/home — rule 18. */
    read(req, res) {
      const lang = languageOf(req, req.guest.stay);
      const view = viewOf(req.guest.lodging.propertyId, lang);
      if (!view) return fail(res, refusal(404, 'MODULE_OFF', 'moduleOff'));
      return publicHttp.ok(res, view);
    },

    /** POST /public/v1/guest/home/lights/:lightId — rules 7-8, 10. */
    switchLight(req, res) {
      const on = req.body && req.body.on;
      if (typeof on !== 'boolean') return fail(res, refusal(400, 'INVALID_REQUEST', 'invalidRequest'));
      const propertyId = req.guest.lodging.propertyId;
      const item = pilotableLight(propertyId, String(req.params.lightId));
      if (!item) return fail(res, refusal(403, 'NOT_PILOTABLE', 'lightNotPilotable'));
      const queued = homeData().queueCommand({
        stayId: req.guest.stay.id,
        propertyId,
        equipmentId: item.equipmentId,
        lightId: item.id,
        value: on ? 'on' : 'off',
      });
      return res.status(202).json({ data: commandView(queued, languageOf(req, req.guest.stay)) });
    },

    /** GET /public/v1/guest/home/commands/:id — rule 22: a stay reads its own taps only. */
    command(req, res) {
      const data = homeData();
      const id = Number(req.params.id);
      const command = data && Number.isInteger(id) && id > 0 ? data.command(id) : null;
      if (!command || command.stayId !== req.guest.stay.id) return fail(res, refusal(404, 'NOT_FOUND', 'commandNotFound'));
      return publicHttp.ok(res, commandView(command, languageOf(req, req.guest.stay)));
    },

    /** GET /api/guest-app/lodgings/:propertyId/home — rules 12-15. */
    studioRead(req, res) {
      const id = propertyIdOf(req);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
      if (!lodgings().get(id)) return res.status(404).json({ error: 'Logement introuvable' });
      const data = homeData();
      const blocks = homeBlocks().blocksOf(id);
      return res.json({
        channel: channelView(data, now()),
        blocks,
        pickers: pickersOf(data ? data.catalog() : [], blocks),
      });
    },

    /** PUT /api/guest-app/lodgings/:propertyId/home — rule 14, every refusal at once. */
    studioWrite(req, res) {
      const id = propertyIdOf(req);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
      if (!lodgings().get(id)) return res.status(404).json({ error: 'Logement introuvable' });
      const data = homeData();
      const catalog = data ? data.catalog() : [];
      const result = validateHomeBlocks(req.body && req.body.blocks, catalog);
      if (!result.ok) {
        const n = Object.keys(result.errors).length;
        return res.status(422).json({ error: n > 1 ? `${n} saisies à corriger.` : 'Une saisie à corriger.', errors: result.errors });
      }
      const blocks = homeBlocks().save(id, result.blocks, now());
      return res.json({ channel: channelView(data, now()), blocks, pickers: pickersOf(catalog, blocks) });
    },

    /**
     * POST /api/guest-app/lodgings/:propertyId/home/preview — rule 16: the guest's page for the blocks being edited
     * (or the saved ones without a body), with the real readings. A draft Studio would refuse is refused the same way.
     */
    studioPreview(req, res) {
      const id = propertyIdOf(req);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
      const data = homeData();
      if (!data) return res.json({ live: false, updated: null, blocks: [] });
      const lang = req.query.lang === 'en' ? 'en' : 'fr';
      const catalog = data.catalog();
      let blocks = homeBlocks().blocksOf(id);
      if (req.body && req.body.blocks) {
        const result = validateHomeBlocks(req.body.blocks, catalog);
        if (!result.ok) return res.status(422).json({ error: 'Aperçu impossible tant que des saisies sont refusées.', errors: result.errors });
        blocks = result.blocks;
      }
      const pairs = selectionOf([blocks], catalog);
      return res.json(buildHomeView({
        blocks, catalog, readings: data.readings(pairs), series: data.series(pairs), now: now(), lang,
      }));
    },
  };
}

module.exports = { buildHomeController, channelView, pickersOf, LIST_KINDS };
