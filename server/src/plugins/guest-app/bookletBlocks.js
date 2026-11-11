/**
 * The booklet's blocks (specs/guest-app.md rule 18): the closed list of types, the shape of each one's data and
 * the server-side sanitising of rich text. Pure: a body comes in, a stored shape or a French message goes out.
 *
 * Every text a guest reads is bilingual, `{ fr, en? }` (rule 19). Rich text keeps only paragraphs, line
 * breaks, bold, italic, lists and links to `https:`, `tel:` or `mailto:` — the rest of the markup is dropped,
 * its text kept and escaped; script-like elements lose their content too.
 */

const BLOCK_TYPES = Object.freeze(['text', 'image', 'gallery', 'callout', 'steps', 'wifi', 'contact', 'place', 'faq', 'button', 'hours']);
const ITEM_KINDS = Object.freeze(['option', 'breakfast', 'resource']);
const CALLOUT_TONES = Object.freeze(['info', 'warning']);

const MAX = Object.freeze({
  short: 120, text: 2000, rich: 20000, list: 30, faq: 50, hours: 14, address: 300, phone: 30, email: 120, href: 2000,
});

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PHONE = /^\+?[0-9][0-9 ().-]{1,28}$/;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;

class BlockError extends Error {}
const fail = (message) => { throw new BlockError(message); };

function onlyKeys(object, allowed, what) {
  if (!isPlainObject(object)) fail(`${what} est invalide.`);
  if (Object.keys(object).some((key) => !allowed.includes(key))) fail(`${what} contient un champ inconnu.`);
}

// --- Rich text ----------------------------------------------------------------------------------------------

const ALLOWED_TAGS = Object.freeze({ p: 'p', br: 'br', strong: 'strong', b: 'strong', em: 'em', i: 'em', ul: 'ul', ol: 'ol', li: 'li', a: 'a' });
const VOID_TAGS = new Set(['br']);
// Their content is code or chrome, never text for the guest.
const DROPPED_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'textarea', 'title', 'svg', 'math', 'select']);
const SAFE_LINK = /^(https:\/\/[^\s]+|tel:\+?[0-9 ().-]{2,30}|mailto:[^\s@]+@[^\s@]+)$/i;

const escapeText = (text) => String(text)
  .replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const decodeEntities = (text) => String(text)
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&quot;/g, '"')
  .replace(/&apos;|&#39;/g, '\'')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');

function hrefOf(attributes) {
  const found = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
  if (!found) return null;
  // Control characters and spaces inside a scheme (`java\nscript:`) are how a filter is fooled: none survive.
  const href = decodeEntities(found[1] ?? found[2] ?? found[3]).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return href.length <= MAX.href && SAFE_LINK.test(href) ? href : null;
}

const TOKEN = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

/** Rich text reduced to the allow-list, every tag balanced, every text escaped. */
function sanitizeRichText(input) {
  const html = String(input ?? '');
  const out = [];
  const open = [];
  let dropping = null;
  let last = 0;
  const closeTo = (tag) => {
    const at = open.lastIndexOf(tag);
    if (at === -1) return;
    while (open.length > at) out.push(`</${open.pop()}>`);
  };
  for (const match of html.matchAll(TOKEN)) {
    const [whole, slash, rawName = '', attributes = ''] = match;
    const name = rawName.toLowerCase();
    if (!dropping) out.push(escapeText(html.slice(last, match.index)));
    last = match.index + whole.length;
    if (!rawName) continue;
    if (dropping) {
      if (slash && name === dropping) dropping = null;
      continue;
    }
    if (DROPPED_WITH_CONTENT.has(name)) {
      if (!slash && !/\/\s*$/.test(attributes)) dropping = name;
      continue;
    }
    const tag = ALLOWED_TAGS[name];
    if (!tag) continue;
    if (VOID_TAGS.has(tag)) {
      if (!slash) out.push(`<${tag}>`);
    } else if (slash) {
      closeTo(tag);
    } else if (tag === 'a') {
      const href = hrefOf(attributes);
      // A link without a safe target keeps its text; its closing tag then finds nothing open to close.
      if (href && !open.includes('a')) {
        out.push(`<a href="${escapeText(href)}" rel="noopener noreferrer">`);
        open.push('a');
      }
    } else {
      out.push(`<${tag}>`);
      open.push(tag);
    }
  }
  if (!dropping) out.push(escapeText(html.slice(last)));
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('');
}

/** What a guest reads of rich text, for search and the untranslated count. */
function plainText(html) {
  return decodeEntities(String(html ?? '')
    .replace(/<br>/g, '\n')
    .replace(/<\/(p|li)>/g, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .trim();
}

// --- Fields -------------------------------------------------------------------------------------------------

/** `{ fr, en? }`: French required unless `optional`, English may be left to fall back (rule 19). */
function bilingual(value, what, { max = MAX.text, optional = false, rich = false } = {}) {
  if (value === undefined && optional) return undefined;
  onlyKeys(value, ['fr', 'en'], what);
  // Markup with no text in it (`<p></p>`) is an empty field: the English then falls back to the French.
  const clean = (text) => {
    if (!rich) return String(text).trim();
    const html = sanitizeRichText(text);
    return plainText(html) ? html : '';
  };
  ['fr', 'en'].forEach((lang) => {
    const text = value[lang];
    if (text !== undefined && text !== null && (typeof text !== 'string' || text.length > max)) fail(`${what} est trop long ou invalide.`);
  });
  const fr = typeof value.fr === 'string' ? clean(value.fr) : '';
  const en = typeof value.en === 'string' ? clean(value.en) : '';
  if (!fr && (!optional || en)) fail(`${what} est obligatoire en français.`);
  if (!fr && !en) return undefined;
  return en ? { fr, en } : { fr };
}

function plain(value, what, { max = MAX.short, optional = false, pattern = null } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${what} est invalide.`);
  if (pattern && !pattern.test(value.trim())) fail(`${what} est invalide.`);
  return value.trim();
}

function mediaId(value, what, { optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (!isPositiveInt(value)) fail(`${what} est invalide.`);
  return value;
}

function list(value, what, max, each) {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) fail(`${what} doit compter de 1 à ${max} éléments.`);
  return value.map((item, index) => each(item, index));
}

const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));

function buttonTarget(target) {
  if (!isPlainObject(target)) fail('La cible du bouton est invalide.');
  if (target.kind === 'page') {
    onlyKeys(target, ['kind', 'slug'], 'La cible du bouton');
    return { kind: 'page', slug: plain(target.slug, 'La page visée', { max: 60, pattern: SLUG }) };
  }
  if (target.kind === 'item') {
    onlyKeys(target, ['kind', 'itemKind', 'itemId'], 'La cible du bouton');
    if (!ITEM_KINDS.includes(target.itemKind) || !isPositiveInt(target.itemId)) fail('L’article visé est invalide.');
    return { kind: 'item', itemKind: target.itemKind, itemId: target.itemId };
  }
  if (target.kind === 'url') {
    onlyKeys(target, ['kind', 'href'], 'La cible du bouton');
    const href = plain(target.href, 'L’adresse du bouton', { max: MAX.href });
    if (!/^https:\/\/[^\s]+$/i.test(href)) fail('L’adresse du bouton doit commencer par https://.');
    return { kind: 'url', href };
  }
  return fail('La cible du bouton est une page, un article ou une adresse.');
}

// --- Types --------------------------------------------------------------------------------------------------

const SHAPES = Object.freeze({
  text: (d) => {
    onlyKeys(d, ['html'], 'Le texte');
    return { html: bilingual(d.html, 'Le texte', { max: MAX.rich, rich: true }) };
  },
  image: (d) => {
    onlyKeys(d, ['mediaId', 'caption'], 'L’image');
    return compact({ mediaId: mediaId(d.mediaId, 'La photo'), caption: bilingual(d.caption, 'La légende', { optional: true, max: MAX.short * 2 }) });
  },
  gallery: (d) => {
    onlyKeys(d, ['items'], 'La galerie');
    return {
      items: list(d.items, 'La galerie', MAX.list, (item) => {
        onlyKeys(item, ['mediaId', 'caption'], 'Une photo de la galerie');
        return compact({ mediaId: mediaId(item.mediaId, 'La photo'), caption: bilingual(item.caption, 'La légende', { optional: true, max: MAX.short * 2 }) });
      }),
    };
  },
  callout: (d) => {
    onlyKeys(d, ['tone', 'title', 'text'], 'L’encadré');
    if (!CALLOUT_TONES.includes(d.tone)) fail('L’encadré est une information ou un avertissement.');
    return compact({ tone: d.tone, title: bilingual(d.title, 'Le titre de l’encadré', { optional: true, max: MAX.short }), text: bilingual(d.text, 'Le texte de l’encadré') });
  },
  steps: (d) => {
    onlyKeys(d, ['steps'], 'Les étapes');
    return {
      steps: list(d.steps, 'Les étapes', MAX.list, (step) => {
        onlyKeys(step, ['text', 'mediaId'], 'Une étape');
        return compact({ text: bilingual(step.text, 'Le texte de l’étape'), mediaId: mediaId(step.mediaId, 'La photo de l’étape', { optional: true }) });
      }),
    };
  },
  // Rule 11ter — the network, the password and the note are the lodging's facts, never the booklet's text.
  wifi: (d) => {
    onlyKeys(d, [], 'Le bloc wifi');
    return {};
  },
  contact: (d) => {
    if (isPlainObject(d) && d.source === 'lodging') {
      onlyKeys(d, ['source'], 'Le contact');
      return { source: 'lodging' };
    }
    onlyKeys(d, ['source', 'name', 'role', 'phone', 'whatsapp', 'email'], 'Le contact');
    if (d.source !== 'inline') fail('Le contact vient du logement ou est saisi ici.');
    const contact = compact({
      source: 'inline',
      name: plain(d.name, 'Le nom du contact', { max: 80 }),
      role: bilingual(d.role, 'Le rôle du contact', { optional: true, max: 80 }),
      phone: plain(d.phone, 'Le téléphone', { max: MAX.phone, optional: true, pattern: PHONE }),
      whatsapp: plain(d.whatsapp, 'Le numéro WhatsApp', { max: MAX.phone, optional: true, pattern: PHONE }),
      email: plain(d.email, 'L’e-mail', { max: MAX.email, optional: true, pattern: EMAIL }),
    });
    if (!contact.phone && !contact.whatsapp && !contact.email) fail('Un contact a au moins un téléphone, un WhatsApp ou un e-mail.');
    return contact;
  },
  place: (d) => {
    onlyKeys(d, ['name', 'address', 'lat', 'lng'], 'Le lieu');
    const hasPoint = d.lat !== undefined || d.lng !== undefined;
    if (hasPoint && !(Number.isFinite(d.lat) && Math.abs(d.lat) <= 90 && Number.isFinite(d.lng) && Math.abs(d.lng) <= 180)) fail('Les coordonnées du lieu sont invalides.');
    return compact({
      name: bilingual(d.name, 'Le nom du lieu', { max: MAX.short }),
      address: plain(d.address, 'L’adresse', { max: MAX.address }),
      lat: hasPoint ? d.lat : undefined,
      lng: hasPoint ? d.lng : undefined,
    });
  },
  faq: (d) => {
    onlyKeys(d, ['items'], 'La FAQ');
    return {
      items: list(d.items, 'La FAQ', MAX.faq, (item) => {
        onlyKeys(item, ['question', 'answer'], 'Une question');
        return { question: bilingual(item.question, 'La question', { max: MAX.short * 2 }), answer: bilingual(item.answer, 'La réponse') };
      }),
    };
  },
  button: (d) => {
    onlyKeys(d, ['label', 'target'], 'Le bouton');
    return { label: bilingual(d.label, 'Le libellé du bouton', { max: 60 }), target: buttonTarget(d.target) };
  },
  hours: (d) => {
    onlyKeys(d, ['title', 'rows'], 'Les horaires');
    return compact({
      title: bilingual(d.title, 'Le titre des horaires', { optional: true, max: MAX.short }),
      rows: list(d.rows, 'Les horaires', MAX.hours, (row) => {
        onlyKeys(row, ['label', 'value'], 'Une ligne d’horaires');
        return { label: bilingual(row.label, 'Le jour', { max: 60 }), value: bilingual(row.value, 'L’horaire', { max: MAX.short }) };
      }),
    });
  },
});

/** → `{ data }` (the stored shape) or `{ error }`. */
function validateBlockData(type, data) {
  if (!BLOCK_TYPES.includes(type)) return { error: 'Type de bloc inconnu.' };
  try {
    return { data: SHAPES[type](data) };
  } catch (error) {
    if (error instanceof BlockError) return { error: error.message };
    throw error;
  }
}

/** A bilingual field outside a block (a page title): → `{ value }` or `{ error }`. */
function validateText(value, what, options) {
  try {
    return { value: bilingual(value, what, options) };
  } catch (error) {
    if (error instanceof BlockError) return { error: error.message };
    throw error;
  }
}

/** The photos a stored block points at, for the boundary's existence check. */
function mediaIdsOf(type, data) {
  if (type === 'image') return [data.mediaId];
  if (type === 'gallery') return data.items.map((item) => item.mediaId);
  if (type === 'steps') return data.steps.map((step) => step.mediaId).filter(Boolean);
  return [];
}

module.exports = {
  BLOCK_TYPES, SLUG, mediaIdsOf, plainText, sanitizeRichText, validateBlockData, validateText,
};
