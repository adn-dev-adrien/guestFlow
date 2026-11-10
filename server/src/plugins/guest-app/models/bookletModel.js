/**
 * The booklets (specs/guest-app.md rules 16-19, 48-49): pages, their placements in each lodging's booklet,
 * their blocks, and the versions « Publier » freezes.
 *
 * A page is content; a placement puts it in one lodging's booklet, at that lodging's own position, published
 * or not there. A page placed in two lodgings is shared: edited once, it changes in both. A block may be
 * restricted to some of the lodgings its page is placed in. A slug is unique inside one lodging's booklet,
 * so a button to `depart` in a shared page opens each lodging's own « Départ ».
 *
 * The studio edits the draft; a guest reads the lodging's last published version: its pages in the stored,
 * bilingual shape, already that lodging's — the language and the lodging's facts are applied at reading
 * (rule 11ter: one password to change, the tile and the booklet follow).
 *
 * A factory: the plugin builds it on `ctx.db`, tests on an in-memory database.
 */

const { resolvePages, untranslatedCount } = require('../booklet');

const parseJson = (text, fallback) => {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
};

// Rule 16, §9 Q1 — neutral pages until the user's booklets are entered (plan, slice I), marked as such.
const PLACEHOLDER_TEXT = Object.freeze({
  fr: '<p>Page d’exemple : texte à remplacer depuis le studio du livret.</p>',
  en: '<p>Sample page: replace this text from the booklet studio.</p>',
});
const PLACEHOLDER_PAGES = Object.freeze([
  { slug: 'bienvenue', icon: 'house', title: { fr: 'Bienvenue', en: 'Welcome' }, blocks: [] },
  { slug: 'arrivee', icon: 'key-round', title: { fr: 'Arrivée', en: 'Arrival' }, blocks: [] },
  { slug: 'le-logement', icon: 'bed-double', title: { fr: 'Le logement', en: 'The accommodation' }, blocks: [{ type: 'wifi', data: {} }] },
  { slug: 'depart', icon: 'door-open', title: { fr: 'Départ', en: 'Departure' }, blocks: [] },
  { slug: 'urgences-et-contacts', icon: 'phone', title: { fr: 'Urgences et contacts', en: 'Emergencies and contacts' }, blocks: [{ type: 'contact', data: { source: 'lodging' } }] },
]);

function createBookletModel(db) {
  const iso = (at) => (at instanceof Date ? at : new Date(at)).toISOString();

  const pageRow = (pageId) => db.prepare('SELECT * FROM guest_booklet_pages WHERE id = ?').get(Number(pageId)) || null;
  const blockRow = (blockId) => db.prepare('SELECT * FROM guest_booklet_blocks WHERE id = ?').get(Number(blockId)) || null;
  const placementsOf = (pageId) => db.prepare(`
    SELECT pl.propertyId, pl.sortOrder, pl.published, p.name AS name
    FROM guest_booklet_placements pl
    JOIN properties p ON p.id = pl.propertyId
    WHERE pl.pageId = ? ORDER BY pl.propertyId
  `).all(Number(pageId));
  const propertyExists = (propertyId) => Boolean(db.prepare('SELECT 1 FROM properties WHERE id = ?').get(Number(propertyId)));
  const slugTaken = (propertyId, slug, exceptPageId = null) => Boolean(db.prepare(`
    SELECT 1 FROM guest_booklet_placements pl JOIN guest_booklet_pages pg ON pg.id = pl.pageId
    WHERE pl.propertyId = ? AND pg.slug = ? AND pg.id IS NOT ?
  `).get(Number(propertyId), slug, exceptPageId));
  const nextSortOrder = (propertyId) => db.prepare('SELECT COALESCE(MAX(sortOrder) + 1, 0) AS n FROM guest_booklet_placements WHERE propertyId = ?').get(Number(propertyId)).n;
  const touchPage = (pageId, at) => db.prepare('UPDATE guest_booklet_pages SET updatedAt = ?, placeholder = 0 WHERE id = ?').run(iso(at), Number(pageId));

  const toBlock = (row) => ({
    id: row.id,
    pageId: row.pageId,
    type: row.type,
    data: parseJson(row.dataJson, {}),
    onlyForPropertyIds: parseJson(row.onlyForPropertyIdsJson, null),
    sortOrder: row.sortOrder,
  });
  const blocksOf = (pageId) => db.prepare('SELECT * FROM guest_booklet_blocks WHERE pageId = ? ORDER BY sortOrder, id').all(Number(pageId)).map(toBlock);

  const title = (row) => (row.titleEn ? { fr: row.titleFr, en: row.titleEn } : { fr: row.titleFr });

  /** One page for the studio: its fields, every placement, every block with its restriction. */
  function getPage(pageId) {
    const row = pageRow(pageId);
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      icon: row.icon,
      coverMediaId: row.coverMediaId,
      title: title(row),
      placeholder: Boolean(row.placeholder),
      updatedAt: row.updatedAt,
      placements: placementsOf(row.id).map((p) => ({ propertyId: p.propertyId, name: p.name, sortOrder: p.sortOrder, published: Boolean(p.published) })),
      blocks: blocksOf(row.id),
    };
  }

  /** The block shows in this lodging: unrestricted, or restricted to a list naming it (rule 17). */
  const showsIn = (block, propertyId) => block.onlyForPropertyIds === null || block.onlyForPropertyIds.includes(Number(propertyId));

  /**
   * A lodging's booklet in the stored shape, as a guest would read it once published: its published
   * placements in its order, each page's blocks restricted to that lodging.
   */
  function draftPages(propertyId) {
    const rows = db.prepare(`
      SELECT pg.* FROM guest_booklet_placements pl JOIN guest_booklet_pages pg ON pg.id = pl.pageId
      WHERE pl.propertyId = ? AND pl.published = 1
      ORDER BY pl.sortOrder, pg.id
    `).all(Number(propertyId));
    return rows.map((row) => ({
      pageId: row.id,
      slug: row.slug,
      icon: row.icon,
      coverMediaId: row.coverMediaId,
      title: title(row),
      blocks: blocksOf(row.id).filter((block) => showsIn(block, propertyId)).map(({ id, type, data }) => ({ id, type, data })),
    }));
  }

  function latestVersion(propertyId) {
    const row = db.prepare('SELECT * FROM guest_booklet_versions WHERE propertyId = ? ORDER BY id DESC LIMIT 1').get(Number(propertyId));
    return row ? { id: row.id, publishedAt: row.publishedAt, publishedBy: row.publishedBy, pages: parseJson(row.snapshotJson, { pages: [] }).pages } : null;
  }

  /** The studio's list of one lodging's pages, in its order, with what each is shared with. */
  function lodgingBooklet(propertyId) {
    const id = Number(propertyId);
    const rows = db.prepare(`
      SELECT pg.*, pl.sortOrder, pl.published,
        (SELECT COUNT(*) FROM guest_booklet_blocks b WHERE b.pageId = pg.id) AS blockCount
      FROM guest_booklet_placements pl JOIN guest_booklet_pages pg ON pg.id = pl.pageId
      WHERE pl.propertyId = ? ORDER BY pl.sortOrder, pg.id
    `).all(id);
    const latest = latestVersion(id);
    const draft = draftPages(id);
    return {
      propertyId: id,
      pages: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        icon: row.icon,
        coverMediaId: row.coverMediaId,
        title: title(row),
        sortOrder: row.sortOrder,
        published: Boolean(row.published),
        placeholder: Boolean(row.placeholder),
        blockCount: row.blockCount,
        sharedWith: placementsOf(row.id).filter((p) => p.propertyId !== id).map((p) => ({ propertyId: p.propertyId, name: p.name })),
      })),
      version: latest ? { id: latest.id, publishedAt: latest.publishedAt } : null,
      upToDate: Boolean(latest) && JSON.stringify(latest.pages) === JSON.stringify(draft),
      untranslated: untranslatedCount(draft),
    };
  }

  // --- Writes ---------------------------------------------------------------------------------------------

  /** → { page } or { error, status }. The page is placed at the end of the lodging's booklet, published there. */
  function createPage(propertyId, fields, at) {
    return db.transaction(() => {
      if (!propertyExists(propertyId)) return { status: 404, error: 'Logement introuvable' };
      if (slugTaken(propertyId, fields.slug)) return { status: 409, error: 'Une page de ce livret porte déjà cette adresse.' };
      const pageId = db.prepare(`
        INSERT INTO guest_booklet_pages (slug, icon, coverMediaId, titleFr, titleEn, placeholder, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(fields.slug, fields.icon ?? null, fields.coverMediaId ?? null, fields.title.fr, fields.title.en ?? null, fields.placeholder ? 1 : 0, iso(at)).lastInsertRowid;
      db.prepare('INSERT INTO guest_booklet_placements (pageId, propertyId, sortOrder, published) VALUES (?, ?, ?, 1)')
        .run(pageId, Number(propertyId), nextSortOrder(propertyId));
      return { page: getPage(pageId) };
    })();
  }

  /** Writes what the patch names. A new slug must stay unique in every lodging the page is placed in. */
  function updatePage(pageId, patch, at) {
    return db.transaction(() => {
      const row = pageRow(pageId);
      if (!row) return { status: 404, error: 'Page introuvable' };
      if (patch.slug !== undefined && patch.slug !== row.slug
        && placementsOf(pageId).some((p) => slugTaken(p.propertyId, patch.slug, row.id))) {
        return { status: 409, error: 'Une page d’un livret où cette page est placée porte déjà cette adresse.' };
      }
      const next = {
        slug: patch.slug ?? row.slug,
        icon: patch.icon !== undefined ? patch.icon : row.icon,
        coverMediaId: patch.coverMediaId !== undefined ? patch.coverMediaId : row.coverMediaId,
        titleFr: patch.title ? patch.title.fr : row.titleFr,
        titleEn: patch.title ? (patch.title.en ?? null) : row.titleEn,
      };
      db.prepare('UPDATE guest_booklet_pages SET slug = ?, icon = ?, coverMediaId = ?, titleFr = ?, titleEn = ? WHERE id = ?')
        .run(next.slug, next.icon, next.coverMediaId, next.titleFr, next.titleEn, row.id);
      touchPage(row.id, at);
      return { page: getPage(row.id) };
    })();
  }

  /** The page, its blocks and every placement: it leaves every booklet at their next publication. */
  function deletePage(pageId) {
    return db.transaction(() => {
      if (!pageRow(pageId)) return false;
      db.prepare('DELETE FROM guest_booklet_blocks WHERE pageId = ?').run(Number(pageId));
      db.prepare('DELETE FROM guest_booklet_placements WHERE pageId = ?').run(Number(pageId));
      db.prepare('DELETE FROM guest_booklet_pages WHERE id = ?').run(Number(pageId));
      return true;
    })();
  }

  /** Rule 17 — shares the page with another lodging, placed at the end of that lodging's booklet. */
  function placePage(pageId, propertyId) {
    return db.transaction(() => {
      const row = pageRow(pageId);
      if (!row) return { status: 404, error: 'Page introuvable' };
      if (!propertyExists(propertyId)) return { status: 404, error: 'Logement introuvable' };
      if (placementsOf(pageId).some((p) => p.propertyId === Number(propertyId))) return { status: 409, error: 'La page est déjà dans ce livret.' };
      if (slugTaken(propertyId, row.slug)) return { status: 409, error: 'Une page de ce livret porte déjà cette adresse.' };
      db.prepare('INSERT INTO guest_booklet_placements (pageId, propertyId, sortOrder, published) VALUES (?, ?, ?, 1)')
        .run(row.id, Number(propertyId), nextSortOrder(propertyId));
      return { page: getPage(row.id) };
    })();
  }

  /**
   * Takes the page out of one lodging's booklet. The last placement is refused: a page in no booklet is
   * deleted, not unshared. The blocks restricted to that lodging lose it from their list.
   */
  function unplacePage(pageId, propertyId) {
    return db.transaction(() => {
      const placements = placementsOf(pageId);
      if (!pageRow(pageId)) return { status: 404, error: 'Page introuvable' };
      if (!placements.some((p) => p.propertyId === Number(propertyId))) return { status: 404, error: 'La page n’est pas dans ce livret.' };
      if (placements.length === 1) return { status: 409, error: 'La page n’est que dans ce livret : la supprimer plutôt.' };
      db.prepare('DELETE FROM guest_booklet_placements WHERE pageId = ? AND propertyId = ?').run(Number(pageId), Number(propertyId));
      blocksOf(pageId).filter((b) => b.onlyForPropertyIds && b.onlyForPropertyIds.includes(Number(propertyId))).forEach((b) => {
        db.prepare('UPDATE guest_booklet_blocks SET onlyForPropertyIdsJson = ? WHERE id = ?')
          .run(JSON.stringify(b.onlyForPropertyIds.filter((id) => id !== Number(propertyId))), b.id);
      });
      return { page: getPage(pageId) };
    })();
  }

  /**
   * Rule 17 — « Dupliquer vers… »: an independent page in the target lodging, made of what that lodging would
   * read of the original (the blocks restricted elsewhere stay behind), restrictions dropped. A slug taken
   * there gets a number.
   */
  function duplicatePage(pageId, toPropertyId, at) {
    return db.transaction(() => {
      const source = getPage(pageId);
      if (!source) return { status: 404, error: 'Page introuvable' };
      if (!propertyExists(toPropertyId)) return { status: 404, error: 'Logement introuvable' };
      let slug = source.slug;
      for (let n = 2; slugTaken(toPropertyId, slug); n += 1) slug = `${source.slug}-${n}`.slice(0, 60);
      const { page } = createPage(toPropertyId, { slug, icon: source.icon, coverMediaId: source.coverMediaId, title: source.title }, at);
      const insert = db.prepare('INSERT INTO guest_booklet_blocks (pageId, sortOrder, onlyForPropertyIdsJson, type, dataJson, updatedAt) VALUES (?, ?, NULL, ?, ?, ?)');
      source.blocks.filter((block) => showsIn(block, toPropertyId))
        .forEach((block, sortOrder) => insert.run(page.id, sortOrder, block.type, JSON.stringify(block.data), iso(at)));
      return { page: getPage(page.id) };
    })();
  }

  /**
   * Rule 16 — one lodging's own order and visibility: the list names every page of that booklet exactly once.
   * → { booklet } or { error }.
   */
  function setLodgingBooklet(propertyId, pages) {
    return db.transaction(() => {
      if (!propertyExists(propertyId)) return { status: 404, error: 'Logement introuvable' };
      const current = db.prepare('SELECT pageId FROM guest_booklet_placements WHERE propertyId = ?').all(Number(propertyId)).map((r) => r.pageId);
      const named = pages.map((p) => p.pageId);
      if (named.length !== current.length || new Set(named).size !== named.length || named.some((id) => !current.includes(id))) {
        return { status: 400, error: 'La liste doit nommer chaque page du livret une fois.' };
      }
      const update = db.prepare('UPDATE guest_booklet_placements SET sortOrder = ?, published = ? WHERE pageId = ? AND propertyId = ?');
      pages.forEach((p) => update.run(p.sortOrder, p.published ? 1 : 0, p.pageId, Number(propertyId)));
      return { booklet: lodgingBooklet(propertyId) };
    })();
  }

  /** Appends a block; its restriction names lodgings the page is placed in. */
  function createBlock(pageId, { type, data, onlyForPropertyIds = null }, at) {
    return db.transaction(() => {
      if (!pageRow(pageId)) return { status: 404, error: 'Page introuvable' };
      const error = restrictionError(pageId, onlyForPropertyIds);
      if (error) return { status: 400, error };
      const sortOrder = db.prepare('SELECT COALESCE(MAX(sortOrder) + 1, 0) AS n FROM guest_booklet_blocks WHERE pageId = ?').get(Number(pageId)).n;
      const id = db.prepare('INSERT INTO guest_booklet_blocks (pageId, sortOrder, onlyForPropertyIdsJson, type, dataJson, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run(Number(pageId), sortOrder, onlyForPropertyIds === null ? null : JSON.stringify(onlyForPropertyIds), type, JSON.stringify(data), iso(at)).lastInsertRowid;
      touchPage(pageId, at);
      return { block: toBlock(blockRow(id)) };
    })();
  }

  function restrictionError(pageId, onlyForPropertyIds) {
    if (onlyForPropertyIds === null) return null;
    const placed = placementsOf(pageId).map((p) => p.propertyId);
    return onlyForPropertyIds.every((id) => placed.includes(id)) ? null : 'Un bloc ne peut être réservé qu’aux logements où sa page est placée.';
  }

  /** The block's data and / or its restriction (rule 17); its type never changes. */
  function updateBlock(blockId, patch, at) {
    return db.transaction(() => {
      const row = blockRow(blockId);
      if (!row) return { status: 404, error: 'Bloc introuvable' };
      if (patch.onlyForPropertyIds !== undefined) {
        const error = restrictionError(row.pageId, patch.onlyForPropertyIds);
        if (error) return { status: 400, error };
      }
      const dataJson = patch.data !== undefined ? JSON.stringify(patch.data) : row.dataJson;
      const restriction = patch.onlyForPropertyIds !== undefined
        ? (patch.onlyForPropertyIds === null ? null : JSON.stringify(patch.onlyForPropertyIds))
        : row.onlyForPropertyIdsJson;
      db.prepare('UPDATE guest_booklet_blocks SET dataJson = ?, onlyForPropertyIdsJson = ?, updatedAt = ? WHERE id = ?').run(dataJson, restriction, iso(at), row.id);
      touchPage(row.pageId, at);
      return { block: toBlock(blockRow(row.id)) };
    })();
  }

  function deleteBlock(blockId, at) {
    return db.transaction(() => {
      const row = blockRow(blockId);
      if (!row) return false;
      db.prepare('DELETE FROM guest_booklet_blocks WHERE id = ?').run(row.id);
      touchPage(row.pageId, at);
      return true;
    })();
  }

  /** The page's blocks in the given order: every block of the page, once. */
  function reorderBlocks(pageId, blockIds, at) {
    return db.transaction(() => {
      if (!pageRow(pageId)) return { status: 404, error: 'Page introuvable' };
      const current = blocksOf(pageId).map((b) => b.id);
      if (blockIds.length !== current.length || new Set(blockIds).size !== blockIds.length || blockIds.some((id) => !current.includes(id))) {
        return { status: 400, error: 'La liste doit nommer chaque bloc de la page une fois.' };
      }
      const update = db.prepare('UPDATE guest_booklet_blocks SET sortOrder = ? WHERE id = ?');
      blockIds.forEach((id, sortOrder) => update.run(sortOrder, id));
      touchPage(pageId, at);
      return { page: getPage(pageId) };
    })();
  }

  // --- Publication (rules 48, 49) -------------------------------------------------------------------------

  const insertVersion = (propertyId, pages, { by, at }) => {
    const id = db.prepare('INSERT INTO guest_booklet_versions (propertyId, publishedAt, publishedBy, snapshotJson) VALUES (?, ?, ?, ?)')
      .run(Number(propertyId), iso(at), by ?? null, JSON.stringify({ pages })).lastInsertRowid;
    return { propertyId: Number(propertyId), id, publishedAt: iso(at) };
  };

  /**
   * « Publier » for one lodging: its draft becomes what its guests read. A shared page is republished in every
   * other lodging it is placed in: that lodging's last version takes the page's current content (or loses it,
   * unpublished there), its other pages untouched — its own drafts stay its own. A lodging never published
   * has nothing to republish. → the versions written.
   */
  function publish(propertyId, { by = null, at }) {
    return db.transaction(() => {
      const own = draftPages(propertyId);
      const written = [insertVersion(propertyId, own, { by, at })];
      const shared = new Set();
      const others = new Set();
      own.forEach((page) => placementsOf(page.pageId).forEach((p) => {
        if (p.propertyId === Number(propertyId)) return;
        shared.add(page.pageId);
        others.add(p.propertyId);
      }));
      others.forEach((otherId) => {
        const latest = latestVersion(otherId);
        if (!latest) return;
        const current = new Map(draftPages(otherId).map((page) => [page.pageId, page]));
        const pages = latest.pages
          .map((page) => (shared.has(page.pageId) ? current.get(page.pageId) : page))
          .filter(Boolean);
        if (JSON.stringify(pages) !== JSON.stringify(latest.pages)) written.push(insertVersion(otherId, pages, { by, at }));
      });
      return written;
    })();
  }

  /**
   * Rule 17 — a lodging's booklet as it is read: the last published version for a guest, the draft for the
   * studio. context: { lang, facts, mediaOf, isAvailable } (booklet.js). → { version, pages } with the
   * untranslated count of the draft.
   */
  function resolveBooklet(propertyId, lang, context, { draft = false } = {}) {
    if (draft) {
      const pages = draftPages(propertyId);
      return { version: null, pages: resolvePages(pages, { ...context, lang }), untranslated: untranslatedCount(pages) };
    }
    const latest = latestVersion(propertyId);
    return { version: latest ? latest.id : null, pages: latest ? resolvePages(latest.pages, { ...context, lang }) : [] };
  }

  /**
   * §9 Q1 — the neutral pages a lodging starts with, the first time it enters the app: once per lodging
   * (`guest_app_lodgings.bookletSeededAt`), and never into a booklet that already holds a page.
   */
  function seedPlaceholders(propertyId, at) {
    return db.transaction(() => {
      const lodging = db.prepare('SELECT bookletSeededAt FROM guest_app_lodgings WHERE propertyId = ?').get(Number(propertyId));
      if (!lodging || lodging.bookletSeededAt) return false;
      db.prepare('UPDATE guest_app_lodgings SET bookletSeededAt = ? WHERE propertyId = ?').run(iso(at), Number(propertyId));
      if (db.prepare('SELECT 1 FROM guest_booklet_placements WHERE propertyId = ?').get(Number(propertyId))) return false;
      const insert = db.prepare('INSERT INTO guest_booklet_blocks (pageId, sortOrder, onlyForPropertyIdsJson, type, dataJson, updatedAt) VALUES (?, ?, NULL, ?, ?, ?)');
      PLACEHOLDER_PAGES.forEach(({ slug, icon, title: pageTitle, blocks }) => {
        const { page } = createPage(propertyId, { slug, icon, title: pageTitle, placeholder: true }, at);
        [{ type: 'text', data: { html: PLACEHOLDER_TEXT } }, ...blocks]
          .forEach((block, sortOrder) => insert.run(page.id, sortOrder, block.type, JSON.stringify(block.data), iso(at)));
      });
      return true;
    })();
  }

  return {
    createBlock,
    createPage,
    deleteBlock,
    deletePage,
    draftPages,
    duplicatePage,
    getBlock: (blockId) => { const row = blockRow(blockId); return row ? toBlock(row) : null; },
    getPage,
    latestVersion,
    lodgingBooklet,
    placePage,
    publish,
    reorderBlocks,
    resolveBooklet,
    seedPlaceholders,
    setLodgingBooklet,
    unplacePage,
    updateBlock,
    updatePage,
  };
}

module.exports = createBookletModel;
