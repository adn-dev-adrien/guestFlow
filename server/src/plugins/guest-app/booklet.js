/**
 * The booklet a guest reads (specs/guest-app.md rules 16-20). Pure: a lodging's pages in their stored,
 * bilingual shape come in — the draft for the studio, the last published snapshot for a guest — and the
 * payload to render goes out, in one language with the French as fallback per field, the lodging's facts in
 * the `wifi` and `contact` blocks, and the buttons the session cannot follow dropped.
 */

const { plainText } = require('./bookletBlocks');

const MIN_QUERY = 2;
const MAX_QUERY = 100;
const MAX_RESULTS = 20;
const MAX_EXCERPT = 200;

/** Rule 19 — the language's text, else the French. */
const pick = (text, lang) => {
  if (!text) return '';
  return (lang === 'en' && text.en) || text.fr || '';
};

const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined && v !== null && v !== ''));

const digits = (phone) => String(phone).replace(/[^0-9+]/g, '');

function contactView(contact, lang) {
  return compact({
    name: contact.name,
    role: typeof contact.role === 'string' ? contact.role : pick(contact.role, lang),
    phone: contact.phone,
    telUrl: contact.phone ? `tel:${digits(contact.phone)}` : null,
    whatsapp: contact.whatsapp,
    whatsappUrl: contact.whatsapp ? `https://wa.me/${digits(contact.whatsapp).replace(/^\+/, '')}` : null,
    email: contact.email,
    mailto: contact.email ? `mailto:${contact.email}` : null,
  });
}

function mapsUrl(place) {
  const destination = Number.isFinite(place.lat) ? `${place.lat},${place.lng}` : place.address;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/**
 * One stored block → its payload, or null when it has nothing to show (a photo gone, a lodging without
 * contacts, a button the session cannot follow).
 */
function blockView(block, context) {
  const { lang, facts, mediaOf, canFollow } = context;
  const d = block.data || {};
  const image = (id) => (id ? mediaOf(id, lang) : null);
  switch (block.type) {
    case 'text':
      return { type: 'text', html: pick(d.html, lang) };
    case 'image': {
      const shown = image(d.mediaId);
      return shown ? compact({ type: 'image', image: shown, caption: pick(d.caption, lang) }) : null;
    }
    case 'gallery': {
      const items = d.items.map((item) => ({ image: image(item.mediaId), caption: pick(item.caption, lang) }))
        .filter((item) => item.image).map(compact);
      return items.length ? { type: 'gallery', items } : null;
    }
    case 'callout':
      return compact({ type: 'callout', tone: d.tone, title: pick(d.title, lang), text: pick(d.text, lang) });
    case 'steps':
      return { type: 'steps', steps: d.steps.map((step) => compact({ text: pick(step.text, lang), image: image(step.mediaId) })) };
    // Rule 11ter — the lodging's wifi, or its « Pas de wifi » message when it has none.
    case 'wifi':
      return facts.wifi
        ? { type: 'wifi', available: true, ...facts.wifi }
        : { type: 'wifi', available: false, text: pick(facts.noWifi, lang) };
    case 'contact': {
      const contacts = d.source === 'lodging' ? facts.contacts : [d];
      return contacts.length ? { type: 'contact', contacts: contacts.map((c) => contactView(c, lang)) } : null;
    }
    case 'place':
      return { type: 'place', name: pick(d.name, lang), address: d.address, mapsUrl: mapsUrl(d) };
    case 'faq':
      return { type: 'faq', items: d.items.map((item) => ({ question: pick(item.question, lang), answer: pick(item.answer, lang) })) };
    // Rule 18 — a target the session cannot follow is not rendered.
    case 'button':
      return canFollow(d.target) ? { type: 'button', label: pick(d.label, lang), target: d.target } : null;
    case 'hours':
      return compact({ type: 'hours', title: pick(d.title, lang), rows: d.rows.map((row) => ({ label: pick(row.label, lang), value: pick(row.value, lang) })) });
    default:
      return null;
  }
}

/**
 * pages: [{ slug, icon, coverMediaId, title: { fr, en? }, blocks: [{ id, type, data }] }], in the lodging's
 * order, already the lodging's (published placements, restricted blocks filtered).
 * context: { lang, facts: { wifi, noWifi, contacts }, mediaOf(id, lang), isAvailable(target) }
 * → [{ slug, icon, title, cover, blocks }]
 */
function resolvePages(pages, { lang, facts, mediaOf, isAvailable }) {
  const slugs = new Set(pages.map((page) => page.slug));
  const canFollow = (target) => (target.kind === 'page' ? slugs.has(target.slug) : isAvailable(target));
  const context = { lang, facts, mediaOf, canFollow };
  return pages.map((page) => ({
    slug: page.slug,
    icon: page.icon || null,
    title: pick(page.title, lang),
    cover: page.coverMediaId ? mediaOf(page.coverMediaId, lang) : null,
    blocks: page.blocks.map((block) => blockView(block, context)).filter(Boolean),
  }));
}

/** Rule 19 — the texts written in French and not in English, for the studio's « 3 textes non traduits ». */
function untranslatedCount(pages) {
  let count = 0;
  const walk = (value) => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    if (typeof value.fr === 'string') {
      if (value.fr.trim() && !String(value.en || '').trim()) count += 1;
      return;
    }
    Object.values(value).forEach(walk);
  };
  pages.forEach((page) => { walk(page.title); page.blocks.forEach((block) => walk(block.data)); });
  return count;
}

// --- Search (rule 20) ---------------------------------------------------------------------------------------

/** Accents and case folded, each folded character mapped back to the original's index. */
function fold(text) {
  let folded = '';
  const origin = [];
  Array.from(text).forEach((char, index) => {
    const base = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const c of base) { folded += c; origin.push(index); }
  });
  return { folded, origin, chars: Array.from(text) };
}

const foldQuery = (q) => String(q).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

const TEXT_KEYS = new Set(['html', 'text', 'title', 'caption', 'label', 'question', 'answer', 'name', 'address', 'role', 'value', 'note']);

/** What a guest reads on a resolved page, in order: its title, then each text of its blocks. */
function textsOf(page) {
  const texts = [page.title];
  const walk = (value, key) => {
    if (typeof value === 'string') {
      if (TEXT_KEYS.has(key)) texts.push(key === 'html' ? plainText(value) : value);
      return;
    }
    if (Array.isArray(value)) { value.forEach((v) => walk(v, key)); return; }
    if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => walk(v, k));
  };
  page.blocks.forEach((block) => walk(block, null));
  return texts.filter(Boolean);
}

/** The sentence holding the match at `start`, with the match's place inside it. */
function sentenceAround(chars, start, length) {
  const isEnd = (c) => /[.!?…\n]/.test(c);
  let from = start;
  while (from > 0 && !isEnd(chars[from - 1])) from -= 1;
  let to = start + length;
  while (to < chars.length && !isEnd(chars[to - 1])) to += 1;
  while (from < start && /\s/.test(chars[from])) from += 1;
  if (to - from > MAX_EXCERPT) {
    from = Math.max(from, start - Math.floor((MAX_EXCERPT - length) / 2));
    to = Math.min(to, from + MAX_EXCERPT);
  }
  const head = from > 0 && !isEnd(chars[from - 1]) && !/\s/.test(chars[from - 1]) ? '…' : '';
  const sentence = chars.slice(from, to).join('').trimEnd();
  const tail = to < chars.length && !isEnd(chars[to - 1]) ? '…' : '';
  const at = head.length + (start - from);
  return { excerpt: `${head}${sentence}${tail}`, highlight: { start: at, length } };
}

/** → { error: 'searchLength', params } (a refusal key, refusals.js) for a query too short or too long, else { results: [{ slug, title, excerpt, highlight }] }. */
function searchPages(pages, q) {
  const query = foldQuery(q || '');
  if (query.length < MIN_QUERY || query.length > MAX_QUERY) return { error: 'searchLength', params: { min: MIN_QUERY, max: MAX_QUERY } };
  const results = [];
  for (const page of pages) {
    for (const text of textsOf(page)) {
      const single = text.replace(/\s+/g, (s) => (s.includes('\n') ? '\n' : ' '));
      const { folded, origin, chars } = fold(single);
      const at = folded.indexOf(query);
      if (at !== -1) {
        const start = origin[at];
        const end = origin[at + query.length - 1] + 1;
        results.push({ slug: page.slug, title: page.title, ...sentenceAround(chars, start, end - start) });
        break;
      }
    }
    if (results.length === MAX_RESULTS) break;
  }
  return { results };
}

module.exports = { resolvePages, searchPages, untranslatedCount };
