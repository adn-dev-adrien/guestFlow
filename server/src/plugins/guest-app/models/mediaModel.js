/**
 * `guest_media` — the photos of the booklet, the lodgings and the shop (specs/guest-app.md §5). A row's `path`
 * is the largest WebP under the uploads root (`guest-app/<name>.webp`), served at `/uploads/<path>`; the 800
 * and 400 px copies sit beside it (`<name>-800.webp`, `<name>-400.webp`).
 *
 * A factory: the plugin builds it on `ctx.db`, tests on an in-memory database.
 */

const WIDTHS = Object.freeze([1600, 800, 400]);

/** `guest-app/abc.webp` → `{ 1600: …abc.webp, 800: …abc-800.webp, 400: …abc-400.webp }`. */
function variantPaths(path) {
  const base = String(path).replace(/\.webp$/, '');
  return Object.fromEntries(WIDTHS.map((width, index) => [width, index === 0 ? `${base}.webp` : `${base}-${width}.webp`]));
}

const toMedia = (row) => ({
  id: row.id,
  path: row.path,
  width: row.width,
  height: row.height,
  altFr: row.altFr || '',
  altEn: row.altEn || '',
  createdAt: row.createdAt,
});

/** What a page or a block shows of a photo: its URLs by width, its size and its alt text in the language. */
function mediaView(media, lang) {
  const urls = Object.fromEntries(Object.entries(variantPaths(media.path)).map(([width, path]) => [width, `/uploads/${path}`]));
  return {
    url: urls[WIDTHS[0]],
    sizes: urls,
    width: media.width,
    height: media.height,
    alt: (lang === 'en' && media.altEn) || media.altFr || '',
  };
}

function createMediaModel(db) {
  const get = (id) => {
    const row = Number.isInteger(Number(id)) ? db.prepare('SELECT * FROM guest_media WHERE id = ?').get(Number(id)) : null;
    return row ? toMedia(row) : null;
  };

  function create({ path, width, height, altFr = '', altEn = '', at }) {
    const id = db.prepare('INSERT INTO guest_media (path, width, height, altFr, altEn, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(path, width, height, altFr || null, altEn || null, at.toISOString()).lastInsertRowid;
    return get(id);
  }

  const list = () => db.prepare('SELECT * FROM guest_media ORDER BY id DESC').all().map(toMedia);

  function updateAlt(id, { altFr, altEn }) {
    const media = get(id);
    if (!media) return null;
    db.prepare('UPDATE guest_media SET altFr = ?, altEn = ? WHERE id = ?')
      .run(altFr !== undefined ? (altFr || null) : (media.altFr || null), altEn !== undefined ? (altEn || null) : (media.altEn || null), media.id);
    return get(media.id);
  }

  const missing = (ids) => ids.filter((id) => !get(id));

  /** `mediaOf(id, lang)` for the booklet's resolution: every photo read once. */
  function viewer() {
    const all = new Map(db.prepare('SELECT * FROM guest_media').all().map((row) => [row.id, toMedia(row)]));
    return (id, lang) => (all.has(Number(id)) ? mediaView(all.get(Number(id)), lang) : null);
  }

  return { create, get, list, missing, updateAlt, viewer };
}

module.exports = createMediaModel;
module.exports.WIDTHS = WIDTHS;
module.exports.mediaView = mediaView;
module.exports.variantPaths = variantPaths;
