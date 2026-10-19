/**
 * Shows the `{{token}}` of an email text as its French label, and turns the label back into the
 * token (specs/guest-email-texts-made-simple.md rule 10). Purely presentational: the labels come from
 * the server, and the server alone validates the stored `{{token}}` text.
 *
 *   {{clientFirstName}}   ⇄  ⟦Prénom du voyageur⟧
 *   {{#if hasPrice}}      ⇄  ⟦Si prix⟧
 *   {{else}} / {{/if}}    ⇄  ⟦sinon⟧ / ⟦fin si⟧
 *
 * A name the server did not label stays as typed, so the server's refusal names it.
 */

export const OPEN = '⟦';
export const CLOSE = '⟧';
const ELSE = 'sinon';
const END = 'fin si';

const asEntry = (t) => (typeof t === 'string' ? { name: t, label: t } : t);
const ifLabel = (label) => (/^si /i.test(label) ? label : `Si ${label}`);

/** `{ variables, conditions }` (or plain name arrays) → the two lookup maps. */
export function buildDictionary(tokens = [], flags = []) {
  const vars = tokens.map(asEntry);
  const conds = flags.map(asEntry);
  const toLabel = { var: new Map(), cond: new Map() };
  const toName = new Map();
  vars.forEach((v) => {
    toLabel.var.set(v.name, v.label);
    toName.set(v.label, `{{${v.name}}}`);
    if (!toLabel.cond.has(v.name)) toLabel.cond.set(v.name, ifLabel(v.label));
  });
  conds.forEach((c) => toLabel.cond.set(c.name, ifLabel(c.label)));
  toLabel.cond.forEach((label, name) => toName.set(label, `{{#if ${name}}}`));
  toName.set(ELSE, '{{else}}');
  toName.set(END, '{{/if}}');
  return { toLabel, toName };
}

export function toDisplay(raw, dict) {
  return String(raw || '').replace(/\{\{\s*(#if\s+)?([A-Za-z0-9_/]+)\s*\}\}/g, (match, cond, name) => {
    if (!cond && name === 'else') return `${OPEN}${ELSE}${CLOSE}`;
    if (!cond && name === '/if') return `${OPEN}${END}${CLOSE}`;
    const label = cond ? dict.toLabel.cond.get(name) : dict.toLabel.var.get(name);
    return label ? `${OPEN}${label}${CLOSE}` : match;
  });
}

export function toRaw(display, dict) {
  return String(display || '').replace(/⟦([^⟦⟧]*)⟧/g, (match, label) => dict.toName.get(label.trim()) || `{{${label.trim()}}}`);
}

/** What a chip inserts, and where the caret goes after it (inside a condition, before its end). */
export function chipSnippet(entry, kind, dict) {
  const name = asEntry(entry).name;
  if (kind === 'cond') {
    const opening = `${OPEN}${dict.toLabel.cond.get(name)}${CLOSE}`;
    return { snippet: `${opening}${OPEN}${END}${CLOSE}`, caret: opening.length };
  }
  const snippet = `${OPEN}${dict.toLabel.var.get(name)}${CLOSE}`;
  return { snippet, caret: snippet.length };
}

/**
 * The server's suggested fix applied to a raw text (specs/guest-email-texts-made-simple.md rule 37):
 * every `{{unknown}}` (spaces allowed inside the braces) becomes `{{name}}`.
 */
export function replaceVariable(raw, unknown, name) {
  const escaped = String(unknown).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(raw || '').replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), `{{${name}}}`);
}

/**
 * A server message as the field shows its text (specs/guest-email-texts-made-simple.md rule 27):
 * « Variable inconnue : {{Depuis le lo gement}} » reads « Variable inconnue : ⟦Depuis le lo gement⟧ »,
 * the brackets the operator sees, never the stored braces.
 */
export function displayError(message, dict) {
  return toDisplay(message, dict).replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (m, inner) => `${OPEN}${inner}${CLOSE}`);
}

/** The `[start, end)` of every ⟦…⟧ of a shown text. */
export function tokenSpans(text) {
  const spans = [];
  const re = /⟦[^⟦⟧]*⟧/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

/**
 * A token is one unit (rule 27): the caret never lands inside it — a click or an arrow selects it
 * whole — and Backspace after it, or Delete before it, removes it whole.
 *
 *   selectionAround(text, pos)  the token holding `pos` strictly inside, as [start, end], or null
 *   deletion(text, pos, key)    { text, caret } once the whole token is removed, or null
 */
export function selectionAround(text, pos) {
  return tokenSpans(text).find(([start, end]) => pos > start && pos < end) || null;
}

export function deletion(text, pos, key) {
  const span = tokenSpans(text).find(([start, end]) => (key === 'Backspace' ? end === pos : start === pos));
  if (!span) return null;
  const source = String(text || '');
  return { text: source.slice(0, span[0]) + source.slice(span[1]), caret: span[0] };
}
