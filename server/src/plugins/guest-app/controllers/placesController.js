/**
 * « Pratique » — the places around the estate (specs/guest-app/guest-app-local-amenities.md).
 *
 *   GET    /public/v1/guest/places       rules 1-7, 12-13 — the published places, for a session or the printed code
 *   GET    /api/guest-app/places         rule 15 — the Studio's list, grouped by category
 *   POST   /api/guest-app/places         rule 16 — add a place (400 `INVALID_PLACE` with one message per refused field)
 *   PUT    /api/guest-app/places/:id     the same judgement; a body of `{ published }` alone only flips the switch
 *   DELETE /api/guest-app/places/:id
 */

const sdk = require('../../sdk');
const { parisDate } = require('../currentStay');
const { languageOf } = require('../language');
const places = require('../places');

const publicHttp = sdk.coreModule('publicHttp');

function buildPlacesController({ placesModel, settingsStore, now }) {
  const estate = () => places.estateOf(settingsStore().get('estatePosition'));
  const today = () => parisDate(now());

  /** Rule 1 — what the module's prerequisite reads. */
  const publishedCount = () => placesModel().countPublished();

  function guestRead(req, res) {
    const lang = languageOf(req, req.guest.stay);
    return publicHttp.ok(res, places.guestPayload(placesModel().published(), { estate: estate(), now: now(), lang }));
  }

  const view = () => ({
    estate: { ...estate(), position: places.positionText(estate()), communes: [...places.COMMUNES], maxKm: places.MAX_KM },
    categories: places.CATEGORIES.map((c) => ({ key: c.key, label: c.fr })),
    wasteKinds: places.choicesOf(places.WASTE_KINDS),
    accepts: places.choicesOf(places.ACCEPTS),
    energies: places.choicesOf(places.ENERGIES),
    ...places.studioList(placesModel().all(), { today: today() }),
  });

  const studioList = (req, res) => res.json(view());

  const found = (req, res) => {
    const place = /^\d+$/.test(req.params.id) ? placesModel().get(req.params.id) : null;
    if (!place) res.status(404).json({ error: 'PLACE_NOT_FOUND' });
    return place;
  };

  const refuse = (res, fields) => res.status(400).json({ error: 'INVALID_PLACE', fields });

  function create(req, res) {
    const checked = places.validatePlace(req.body, { estate: estate() });
    if (checked.fields) return refuse(res, checked.fields);
    return res.json(places.studioPlace(placesModel().insert(checked.place, { verifiedOn: today(), now: now() }), today()));
  }

  function update(req, res) {
    const current = found(req, res);
    if (!current) return undefined;
    const body = req.body;
    const switchOnly = body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 1 && 'published' in body;
    if (switchOnly) {
      if (typeof body.published !== 'boolean') return refuse(res, { published: 'Préciser si le lieu est publié.' });
      return res.json(places.studioPlace(placesModel().setPublished(current.id, body.published, { now: now() }), today()));
    }
    const checked = places.validatePlace(body, { estate: estate() });
    if (checked.fields) return refuse(res, checked.fields);
    return res.json(places.studioPlace(placesModel().update(current.id, checked.place, { verifiedOn: today(), now: now() }), today()));
  }

  function remove(req, res) {
    const current = found(req, res);
    if (!current) return undefined;
    placesModel().remove(current.id);
    return res.json({ ok: true });
  }

  return {
    create, guestRead, publishedCount, remove, studioList, update,
  };
}

module.exports = { buildPlacesController };
