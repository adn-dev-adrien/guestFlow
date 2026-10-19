/**
 * The tags of the « Textes des emails » preview (specs/guest-email-texts-made-simple.md rule 41 —
 * UI/UX review 2026-10-18, decision 13). Pure.
 *
 * The preview lets the operator click a sentence of the rendered email to edit it, so the server says
 * which text each piece of the email comes from. It does so with three private-use characters, never
 * typed and never sent:
 *
 *   U+E000 <text key> U+E001 <the text> U+E002
 *
 * `tagText` wraps each piece of a stored text that holds words — the parts between its conditions —
 * leaving its spaces outside, so a condition left false, a trimmed paragraph or an empty text renders
 * exactly as it does untagged. `split` then turns a rendered email back into `{ plain, segments }`.
 * The preview sends the email rendered without tags, and keeps the segments only when their plain
 * text is exactly that email (a value carrying one of the characters, any surprise: not clickable).
 *
 * Only utils/emailDraftPreview.js tags, inside its rolled-back transaction: a tagged text never
 * reaches the database, the send path or a guest. The shared validator refuses the three characters
 * in anything typed (utils/templateTokens.js), and tests pin both.
 */

const OPEN = '\uE000';
const SEP = '\uE001';
const CLOSE = '\uE002';
const TAG_CHARS = /[\uE000-\uE002]/;
const TAG_CHARS_ALL = /[\uE000-\uE002]/g;
// A text key of the page (§4.3): `text:house@1`, `mention:4:booked`, `subject:arrival_reminder_1d`…
const KEY_RE = /^[a-z]+:[^\s\uE000-\uE002]+$/;

// A condition's own pieces: `{{#if x}}`, `{{else}}`, `{{/if}}`.
const CONDITION_RE = /(\{\{\s*(?:#if\s+[A-Za-z0-9_]+|else|\/if)\s*\}\})/;

/** Each piece of `text` holding words (outside the condition markers) wrapped with `key`. */
function tagText(text, key) {
  const source = String(text == null ? '' : text);
  if (!source || !key) return source;
  return source.split(CONDITION_RE).map((piece, index) => {
    if (index % 2 === 1) return piece;
    const words = piece.replace(/\{\{[^{}]*\}\}/g, '');
    if (!/[^\s]/.test(words)) return piece;
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(piece);
    return `${match[1]}${OPEN}${key}${SEP}${match[2]}${CLOSE}${match[3]}`;
  }).join('');
}

const hasTag = (text) => TAG_CHARS.test(String(text || ''));
const strip = (text) => String(text || '').replace(new RegExp(`${OPEN}[^${SEP}]*${SEP}`, 'g'), '').replace(TAG_CHARS_ALL, '');

/**
 * A tagged rendering → `{ plain, segments: [{ text, key }] }` (`key` null: the template's own words).
 * A piece of the template's words between two pieces of the same text on one line — a variable's
 * value inside a sentence — belongs to that text.
 */
function split(tagged) {
  const source = String(tagged || '');
  const raw = [];
  const stack = [];
  let buffer = '';
  const flush = () => {
    if (buffer) raw.push({ text: buffer, key: stack.length ? stack[stack.length - 1] : null });
    buffer = '';
  };
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const end = ch === OPEN ? source.indexOf(SEP, i + 1) : -1;
    const key = end > 0 ? source.slice(i + 1, end) : '';
    if (ch === OPEN && KEY_RE.test(key)) {
      flush();
      stack.push(key);
      i = end;
    } else if (ch === CLOSE && stack.length) {
      flush();
      stack.pop();
    } else {
      // A lone opener, closer or separator — one a value carried — is text like any other.
      buffer += ch;
    }
  }
  flush();
  const sandwiched = raw.map((s, i) => {
    if (s.key !== null || s.text.includes('\n')) return s;
    const before = raw[i - 1];
    const after = raw[i + 1];
    return before && after && before.key && before.key === after.key ? { ...s, key: before.key } : s;
  });
  const segments = [];
  for (const s of sandwiched) {
    const last = segments[segments.length - 1];
    if (last && last.key === s.key) last.text += s.text;
    else segments.push({ ...s });
  }
  return { plain: segments.map((s) => s.text).join(''), segments };
}

module.exports = { tagText, split, strip, hasTag, TAG_CHARS };
