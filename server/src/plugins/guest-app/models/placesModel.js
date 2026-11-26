/**
 * `guest_app_places` — the shops, services and waste points around the estate (specs/guest-app/guest-app-local-amenities.md §5).
 * One list for the whole estate: no lodging column. A factory: the plugin builds it on `ctx.db`, tests on an in-memory database.
 */

const parseList = (text) => {
  if (!text) return null;
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
};

const fromRow = (row) => ({
  id: row.id,
  category: row.category,
  nameFr: row.name_fr,
  nameEn: row.name_en,
  commune: row.commune,
  lat: row.lat,
  lng: row.lng,
  driveMinutes: row.drive_minutes,
  wasteKind: row.waste_kind,
  accepts: parseList(row.accepts),
  energies: parseList(row.energies),
  phone: row.phone,
  noteFr: row.note_fr,
  noteEn: row.note_en,
  hours: parseList(row.hours),
  published: Number(row.published) === 1,
  verifiedOn: row.verified_on,
});

const json = (list) => (list ? JSON.stringify(list) : null);

const COLUMNS = `category, name_fr, name_en, commune, lat, lng, drive_minutes, waste_kind, accepts, energies, phone,
  note_fr, note_en, hours, published, verified_on`;

const valuesOf = (place, verifiedOn) => [
  place.category, place.nameFr, place.nameEn, place.commune, place.lat, place.lng, place.driveMinutes, place.wasteKind,
  json(place.accepts), json(place.energies), place.phone, place.noteFr, place.noteEn, json(place.hours), place.published ? 1 : 0, verifiedOn,
];

function createPlacesModel(db) {
  const all = () => db.prepare('SELECT * FROM guest_app_places ORDER BY id').all().map(fromRow);
  const published = () => db.prepare('SELECT * FROM guest_app_places WHERE published = 1 ORDER BY id').all().map(fromRow);
  const get = (id) => {
    const row = db.prepare('SELECT * FROM guest_app_places WHERE id = ?').get(Number(id));
    return row ? fromRow(row) : null;
  };
  const countPublished = () => db.prepare('SELECT COUNT(*) AS n FROM guest_app_places WHERE published = 1').get().n;

  function insert(place, { verifiedOn, now }) {
    const stamp = now.toISOString();
    const { lastInsertRowid } = db.prepare(`INSERT INTO guest_app_places (${COLUMNS}, created_at, updated_at)
      VALUES (${COLUMNS.split(',').map(() => '?').join(', ')}, ?, ?)`).run(...valuesOf(place, verifiedOn), stamp, stamp);
    return get(lastInsertRowid);
  }

  function update(id, place, { verifiedOn, now }) {
    const set = COLUMNS.split(',').map((c) => `${c.trim()} = ?`).join(', ');
    db.prepare(`UPDATE guest_app_places SET ${set}, updated_at = ? WHERE id = ?`).run(...valuesOf(place, verifiedOn), now.toISOString(), Number(id));
    return get(id);
  }

  /** The publish switch alone: it does not re-verify the place. */
  function setPublished(id, value, { now }) {
    db.prepare('UPDATE guest_app_places SET published = ?, updated_at = ? WHERE id = ?').run(value ? 1 : 0, now.toISOString(), Number(id));
    return get(id);
  }

  const remove = (id) => db.prepare('DELETE FROM guest_app_places WHERE id = ?').run(Number(id)).changes > 0;

  return {
    all, countPublished, get, insert, published, remove, setPublished, update,
  };
}

module.exports = createPlacesModel;
