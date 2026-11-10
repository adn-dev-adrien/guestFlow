/**
 * `/api/guest-app/studio/**` — the booklet studio's API (specs/guest-app.md rules 16-20, 47-49): pages, their
 * placement in each lodging's booklet (order, visibility, sharing), blocks (rule 18), photos, the draft's
 * preview and search, « Publier » per lodging. Admin only: the guard refuses every role but admin on a path no
 * role has listed. The boundary validates everything; French messages reach the operator as they are.
 */

const multer = require('multer');
const { validateBlockData, validateText, mediaIdsOf, SLUG } = require('../bookletBlocks');
const { searchPages } = require('../booklet');
const { textOf } = require('../refusals');
const { ACCEPTED_TYPES, MAX_UPLOAD_BYTES, MediaError, storeImage } = require('../media');
const { mediaView } = require('../models/mediaModel');

const ICON = /^[a-z0-9-]{1,40}$/;
const PAGE_FIELDS = Object.freeze(['slug', 'icon', 'coverMediaId', 'title']);
const MAX_PAGES = 200;
const MAX_BLOCKS = 200;
const MAX_RESTRICTION = 20;
const MAX_ALT = 200;

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;
const idOf = (value) => (typeof value === 'string' && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null);
const unknownKey = (body, allowed) => Object.keys(body).some((key) => !allowed.includes(key));

/** → `{ fields }` (the stored shape) or `{ error }`. Creating needs a slug and a title. */
function pageInput(body, { creating }) {
  if (!isPlainObject(body) || unknownKey(body, PAGE_FIELDS)) return { error: 'Requête invalide.' };
  if (creating && (body.slug === undefined || body.title === undefined)) return { error: 'Une page a une adresse et un titre.' };
  const fields = {};
  if (body.slug !== undefined) {
    if (typeof body.slug !== 'string' || body.slug.length > 60 || !SLUG.test(body.slug)) return { error: 'L’adresse de la page : lettres minuscules, chiffres et tirets.' };
    fields.slug = body.slug;
  }
  if (body.icon !== undefined) {
    if (body.icon !== null && (typeof body.icon !== 'string' || !ICON.test(body.icon))) return { error: 'L’icône est invalide.' };
    fields.icon = body.icon;
  }
  if (body.coverMediaId !== undefined) {
    if (body.coverMediaId !== null && !isPositiveInt(body.coverMediaId)) return { error: 'La photo de couverture est invalide.' };
    fields.coverMediaId = body.coverMediaId;
  }
  if (body.title !== undefined) {
    const title = validateText(body.title, 'Le titre de la page', { max: 120 });
    if (title.error) return { error: title.error };
    fields.title = title.value;
  }
  if (!Object.keys(fields).length) return { error: 'Requête invalide.' };
  return { fields };
}

/** `null` (every lodging the page is placed in) or 1-20 distinct lodging ids. */
function restrictionInput(value) {
  if (value === null) return { value: null };
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RESTRICTION
    || !value.every(isPositiveInt) || new Set(value).size !== value.length) {
    return { error: 'Les logements du bloc sont invalides.' };
  }
  return { value: [...value].sort((a, b) => a - b) };
}

function bookletOrderInput(body) {
  if (!isPlainObject(body) || unknownKey(body, ['pages']) || !Array.isArray(body.pages) || body.pages.length > MAX_PAGES) return 'Requête invalide.';
  const bad = body.pages.some((p) => !isPlainObject(p) || unknownKey(p, ['pageId', 'sortOrder', 'published'])
    || !isPositiveInt(p.pageId) || !Number.isInteger(p.sortOrder) || p.sortOrder < 0 || typeof p.published !== 'boolean');
  return bad ? 'Une page de la liste est invalide.' : null;
}

function altInput(body) {
  if (!isPlainObject(body) || unknownKey(body, ['altFr', 'altEn']) || !Object.keys(body).length) return 'Requête invalide.';
  const bad = ['altFr', 'altEn'].some((key) => body[key] !== undefined && body[key] !== null
    && (typeof body[key] !== 'string' || body[key].length > MAX_ALT));
  return bad ? `Le texte alternatif fait au plus ${MAX_ALT} caractères.` : null;
}

// Rule 48 — the photos come from the studio: one file, its type and size refused at the boundary.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 2, fieldSize: 1024 },
  fileFilter: (req, file, cb) => cb(null, ACCEPTED_TYPES.includes(file.mimetype)),
});

function receiveFile(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Photo trop volumineuse (${MAX_UPLOAD_BYTES / 1024 / 1024} Mo au plus).`
      : 'Une seule photo à la fois, avec son texte alternatif.';
    return res.status(400).json({ error: message });
  });
}

function buildStudioController({
  booklet, media, lodgings, resolver, uploadsDir, now,
}) {
  const answer = (res, result, key) => (result.error
    ? res.status(result.status || 400).json({ error: result.error })
    : res.json(result[key]));

  /** The lodging named by the URL, or the error answered. */
  function lodgingOf(req, res) {
    const id = idOf(req.params.propertyId);
    if (!id) { res.status(400).json({ error: 'Identifiant invalide' }); return null; }
    const lodging = lodgings().get(id);
    if (!lodging) { res.status(404).json({ error: 'Logement introuvable' }); return null; }
    return lodging;
  }

  function idParam(req, res) {
    const id = idOf(req.params.id);
    if (!id) res.status(400).json({ error: 'Identifiant invalide' });
    return id;
  }

  const missingMedia = (ids) => (media().missing(ids.filter(Boolean)).length ? 'Une photo est introuvable.' : null);
  const langOf = (req) => (req.query.lang === 'en' ? 'en' : 'fr');

  // GET /studio/lodgings/:propertyId/booklet — the lodging's pages, its version, « 3 textes non traduits ».
  function readBooklet(req, res) {
    const lodging = lodgingOf(req, res);
    if (!lodging) return null;
    return res.json(booklet().lodgingBooklet(lodging.propertyId));
  }

  // PUT /studio/lodgings/:propertyId/booklet — rule 16: that lodging's own order and visibility.
  function writeBooklet(req, res) {
    const lodging = lodgingOf(req, res);
    if (!lodging) return null;
    const error = bookletOrderInput(req.body);
    if (error) return res.status(400).json({ error });
    return answer(res, booklet().setLodgingBooklet(lodging.propertyId, req.body.pages), 'booklet');
  }

  // GET /studio/lodgings/:propertyId/preview?lang= — rule 49: the draft as the lodging's guests would read it.
  async function preview(req, res) {
    const lodging = lodgingOf(req, res);
    if (!lodging) return null;
    return res.json(await resolver.resolve({ lodging, mode: 'stay', lang: langOf(req), draft: true }));
  }

  // GET /studio/lodgings/:propertyId/search?q=&lang= — rule 20, on the draft. Rule 62: a refusal key of the guest's
  // table reaches the operator as its French words.
  async function search(req, res) {
    const lodging = lodgingOf(req, res);
    if (!lodging) return null;
    if (typeof req.query.q !== 'string') return res.status(400).json({ error: 'Recherche vide.' });
    const { pages } = await resolver.resolve({ lodging, mode: 'stay', lang: langOf(req), draft: true });
    const found = searchPages(pages, req.query.q);
    return found.error ? res.status(400).json({ error: textOf(found.error, 'fr', found.params) }) : res.json(found);
  }

  // POST /studio/lodgings/:propertyId/publish — rule 48: this lodging, and its shared pages everywhere.
  function publish(req, res) {
    const lodging = lodgingOf(req, res);
    if (!lodging) return null;
    return res.json({ versions: booklet().publish(lodging.propertyId, { by: (req.user && req.user.id) || null, at: now() }) });
  }

  // POST /studio/lodgings/:propertyId/pages
  function createPage(req, res) {
    const lodging = lodgingOf(req, res);
    if (!lodging) return null;
    const input = pageInput(req.body, { creating: true });
    if (input.error) return res.status(400).json({ error: input.error });
    const error = missingMedia([input.fields.coverMediaId]);
    if (error) return res.status(400).json({ error });
    return answer(res, booklet().createPage(lodging.propertyId, input.fields, now()), 'page');
  }

  // GET /studio/pages/:id — with its placements (« Partagée avec L'Estiva ») and its blocks.
  function readPage(req, res) {
    const id = idParam(req, res);
    if (!id) return null;
    const page = booklet().getPage(id);
    return page ? res.json(page) : res.status(404).json({ error: 'Page introuvable' });
  }

  // PUT /studio/pages/:id — a shared page changes in every lodging it is placed in (« Modifie aussi L'Estiva »).
  function updatePage(req, res) {
    const id = idParam(req, res);
    if (!id) return null;
    const input = pageInput(req.body, { creating: false });
    if (input.error) return res.status(400).json({ error: input.error });
    const error = missingMedia([input.fields.coverMediaId]);
    if (error) return res.status(400).json({ error });
    return answer(res, booklet().updatePage(id, input.fields, now()), 'page');
  }

  // DELETE /studio/pages/:id
  function deletePage(req, res) {
    const id = idParam(req, res);
    if (!id) return null;
    return booklet().deletePage(id) ? res.json({ deleted: true }) : res.status(404).json({ error: 'Page introuvable' });
  }

  // POST /studio/pages/:id/placements — rule 17: share the page with another lodging.
  function share(req, res) {
    const id = idParam(req, res);
    if (!id) return null;
    if (!isPlainObject(req.body) || unknownKey(req.body, ['propertyId']) || !isPositiveInt(req.body.propertyId)) {
      return res.status(400).json({ error: 'Logement à choisir.' });
    }
    return answer(res, booklet().placePage(id, req.body.propertyId), 'page');
  }

  // DELETE /studio/pages/:id/placements/:propertyId
  function unshare(req, res) {
    const id = idParam(req, res);
    const propertyId = idOf(req.params.propertyId);
    if (!id) return null;
    if (!propertyId) return res.status(400).json({ error: 'Identifiant invalide' });
    return answer(res, booklet().unplacePage(id, propertyId), 'page');
  }

  // POST /studio/pages/:id/duplicate — rule 17: an independent copy, to diverge from there.
  function duplicate(req, res) {
    const id = idParam(req, res);
    if (!id) return null;
    if (!isPlainObject(req.body) || unknownKey(req.body, ['toPropertyId']) || !isPositiveInt(req.body.toPropertyId)) {
      return res.status(400).json({ error: 'Logement à choisir.' });
    }
    return answer(res, booklet().duplicatePage(id, req.body.toPropertyId, now()), 'page');
  }

  // POST /studio/pages/:id/blocks — rule 18: one block of the closed list, its data validated and sanitised.
  function createBlock(req, res) {
    const id = idParam(req, res);
    if (!id) return null;
    const body = req.body;
    if (!isPlainObject(body) || unknownKey(body, ['type', 'data', 'onlyForPropertyIds'])) return res.status(400).json({ error: 'Requête invalide.' });
    const block = validateBlockData(body.type, body.data);
    if (block.error) return res.status(400).json({ error: block.error });
    const restriction = restrictionInput(body.onlyForPropertyIds === undefined ? null : body.onlyForPropertyIds);
    if (restriction.error) return res.status(400).json({ error: restriction.error });
    const error = missingMedia(mediaIdsOf(body.type, block.data));
    if (error) return res.status(400).json({ error });
    const page = booklet().getPage(id);
    if (page && page.blocks.length >= MAX_BLOCKS) return res.status(400).json({ error: `Une page compte au plus ${MAX_BLOCKS} blocs.` });
    return answer(res, booklet().createBlock(id, { type: body.type, data: block.data, onlyForPropertyIds: restriction.value }, now()), 'block');
  }

  // PUT /studio/blocks/:id — its data and / or rule 17's « Seulement pour ».
  function updateBlock(req, res) {
    const id = idParam(req, res);
    if (!id) return null;
    const body = req.body;
    if (!isPlainObject(body) || unknownKey(body, ['data', 'onlyForPropertyIds']) || !Object.keys(body).length) return res.status(400).json({ error: 'Requête invalide.' });
    const current = booklet().getBlock(id);
    if (!current) return res.status(404).json({ error: 'Bloc introuvable' });
    const patch = {};
    if (body.data !== undefined) {
      const block = validateBlockData(current.type, body.data);
      if (block.error) return res.status(400).json({ error: block.error });
      const error = missingMedia(mediaIdsOf(current.type, block.data));
      if (error) return res.status(400).json({ error });
      patch.data = block.data;
    }
    if (body.onlyForPropertyIds !== undefined) {
      const restriction = restrictionInput(body.onlyForPropertyIds);
      if (restriction.error) return res.status(400).json({ error: restriction.error });
      patch.onlyForPropertyIds = restriction.value;
    }
    return answer(res, booklet().updateBlock(id, patch, now()), 'block');
  }

  // DELETE /studio/blocks/:id
  function deleteBlock(req, res) {
    const id = idParam(req, res);
    if (!id) return null;
    return booklet().deleteBlock(id, now()) ? res.json({ deleted: true }) : res.status(404).json({ error: 'Bloc introuvable' });
  }

  // PUT /studio/pages/:id/blocks/order
  function reorderBlocks(req, res) {
    const id = idParam(req, res);
    if (!id) return null;
    const body = req.body;
    if (!isPlainObject(body) || unknownKey(body, ['blockIds']) || !Array.isArray(body.blockIds)
      || body.blockIds.length > MAX_BLOCKS || !body.blockIds.every(isPositiveInt)) {
      return res.status(400).json({ error: 'Requête invalide.' });
    }
    return answer(res, booklet().reorderBlocks(id, body.blockIds, now()), 'page');
  }

  const mediaAdminView = (m) => ({
    id: m.id, ...mediaView(m, 'fr'), altFr: m.altFr, altEn: m.altEn, createdAt: m.createdAt,
  });

  // GET /studio/media
  function listMedia(req, res) {
    return res.json(media().list().map(mediaAdminView));
  }

  // POST /studio/media — multipart `file` (+ `altFr`, `altEn`): stored at 1600, 800 and 400 px, WebP.
  async function uploadMedia(req, res, next) {
    if (!req.file) return res.status(400).json({ error: 'Formats acceptés : JPG, PNG, WEBP.' });
    const alt = { altFr: req.body && req.body.altFr, altEn: req.body && req.body.altEn };
    const altError = [alt.altFr, alt.altEn].some((text) => text !== undefined && (typeof text !== 'string' || text.length > MAX_ALT));
    if (altError) return res.status(400).json({ error: `Le texte alternatif fait au plus ${MAX_ALT} caractères.` });
    try {
      const stored = await storeImage(req.file.buffer, uploadsDir());
      return res.status(201).json(mediaAdminView(media().create({ ...stored, ...alt, at: now() })));
    } catch (error) {
      if (error instanceof MediaError) return res.status(400).json({ error: error.message });
      return next(error);
    }
  }

  // PUT /studio/media/:id — the alt texts.
  function updateMedia(req, res) {
    const id = idParam(req, res);
    if (!id) return null;
    const error = altInput(req.body);
    if (error) return res.status(400).json({ error });
    const updated = media().updateAlt(id, req.body);
    return updated ? res.json(mediaAdminView(updated)) : res.status(404).json({ error: 'Photo introuvable' });
  }

  return {
    createBlock,
    createPage,
    deleteBlock,
    deletePage,
    duplicate,
    listMedia,
    preview,
    publish,
    readBooklet,
    readPage,
    receiveFile,
    reorderBlocks,
    search,
    share,
    unshare,
    updateBlock,
    updateMedia,
    updatePage,
    uploadMedia,
    writeBooklet,
  };
}

module.exports = { buildStudioController };
