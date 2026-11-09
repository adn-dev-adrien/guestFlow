/**
 * A booklet page as the editor holds it, and how « Enregistrer le brouillon » writes it back (rules 16-18). Local
 * UI state only: the server validates every page field and every block again.
 */
import { toHtml, toNotation } from './richText';

let tmp = 0;
const newKey = () => `new-${++tmp}`;

/** Rich text read back through the notation, so an untouched page is not « modified » by the round trip. */
function normalised(block) {
  if (block.type !== 'text') return block.data;
  const html = block.data.html || {};
  return { html: { fr: toHtml(toNotation(html.fr)), en: toHtml(toNotation(html.en)) } };
}

/** The server's page → the editor's draft. */
export function draftOf(page) {
  return {
    slug: page.slug,
    icon: page.icon || null,
    coverMediaId: page.coverMediaId || null,
    title: { fr: page.title.fr || '', en: page.title.en || '' },
    blocks: page.blocks.map((b) => ({
      key: `b-${b.id}`, id: b.id, type: b.type, data: normalised(b), onlyForPropertyIds: b.onlyForPropertyIds || null,
    })),
  };
}

export function newBlock(type, data) {
  return { key: newKey(), id: null, type, data, onlyForPropertyIds: null };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The editor's row keys are not content.
const content = (draft) => ({ ...draft, blocks: draft.blocks.map(({ key, ...block }) => block) });

export const isDirty = (draft, saved) => Boolean(draft && saved) && !same(content(draft), content(saved));

/** « Monter Portail »: lowercase slug from a title, accents dropped (the server judges it). */
export function slugify(text) {
  return String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Writes the draft: the page's fields that changed, the blocks removed, changed and added, then their order. Stops
 * at the first refusal and throws the server's message with the block it concerns. The blocks it creates get their
 * id on `draft` (pass a copy): after a refusal the editor keeps that draft and reads the page again as `saved`.
 */
export async function saveDraft(api, pageId, draft, saved) {
  const fields = {};
  if (draft.slug !== saved.slug) fields.slug = draft.slug;
  if (draft.icon !== saved.icon) fields.icon = draft.icon;
  if (draft.coverMediaId !== saved.coverMediaId) fields.coverMediaId = draft.coverMediaId;
  if (!same(draft.title, saved.title)) fields.title = draft.title;
  if (Object.keys(fields).length) await api.savePage(pageId, fields);

  const kept = new Set(draft.blocks.filter((b) => b.id).map((b) => b.id));
  for (const block of saved.blocks) {
    if (!kept.has(block.id)) await api.deleteBlock(block.id);
  }
  const ids = [];
  for (const [index, block] of draft.blocks.entries()) {
    try {
      if (!block.id) {
        const created = await api.createBlock(pageId, { type: block.type, data: block.data, onlyForPropertyIds: block.onlyForPropertyIds });
        // Recorded on the draft, so a save that stops further on never creates this block twice.
        block.id = created.id;
        ids.push(created.id);
      } else {
        const before = saved.blocks.find((b) => b.id === block.id);
        const patch = {};
        if (!same(before.data, block.data)) patch.data = block.data;
        if (!same(before.onlyForPropertyIds, block.onlyForPropertyIds)) patch.onlyForPropertyIds = block.onlyForPropertyIds;
        if (Object.keys(patch).length) await api.saveBlock(block.id, patch);
        ids.push(block.id);
      }
    } catch (error) {
      throw Object.assign(error, { blockIndex: index });
    }
  }
  const savedOrder = saved.blocks.map((b) => b.id).filter((id) => kept.has(id));
  if (!same(ids, savedOrder)) await api.orderBlocks(pageId, ids);
}
