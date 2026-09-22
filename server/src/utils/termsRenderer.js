/**
 * CGV rendering (specs/terms-acceptance-record.md §3.1).
 *
 * Escape-first Markdown subset: every character of the source is HTML-escaped BEFORE any tag is
 * produced, so no HTML written by the operator can ever reach the site. Supported: `##`/`###`
 * headings, paragraphs, `-` lists, `**bold**`, `*italic*`, `[text](https://…)`. Anything else stays
 * literal text. Pure functions — no DB access.
 */

const crypto = require('crypto');

const VARIABLE_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g;

/** Names the operator may use, in the order the editor lists them. */
const TERMS_VARIABLES = ['raisonSociale', 'adresse', 'siret', 'email', 'telephone', 'cautions'];

function formatEuro(amount) {
  const n = Number(amount || 0);
  const fixed = Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  return `${fixed} €`;
}

/**
 * Values of the CGV variables from GuestFlow's own data. `cautions` is a Markdown list, one line per
 * property, so it renders as a list wherever it stands on its own line.
 */
function buildTermsVariables(settings, properties) {
  const s = settings || {};
  const cautions = (properties || [])
    .map((p) => `- ${p.name} : ${formatEuro(p.defaultCautionAmount)}`)
    .join('\n');
  return {
    raisonSociale: String(s.companyName || ''),
    adresse: String(s.companyAddress || ''),
    siret: String(s.companySiret || ''),
    email: String(s.companyEmail || ''),
    telephone: String(s.companyPhone || ''),
    cautions,
  };
}

/** Replaces `{{name}}` by its value; unknown names are left in place and reported. */
function resolveVariables(markdown, vars) {
  const unknown = [];
  const text = String(markdown || '').replace(VARIABLE_RE, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
    if (!unknown.includes(name)) unknown.push(name);
    return match;
  });
  return { text, unknown };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Runs on already-escaped text: the only characters it can emit as markup are the tags below.
function renderInline(escaped) {
  return escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function renderMarkdown(text) {
  const out = [];
  let paragraph = [];
  let list = null;
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`<ul>${list.map((li) => `<li>${li}</li>`).join('')}</ul>`);
    list = null;
  };
  String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach((raw) => {
    const line = raw.trimEnd();
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph(); flushList();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`);
    } else if (item) {
      flushParagraph();
      if (!list) list = [];
      list.push(renderInline(escapeHtml(item[1])));
    } else if (line.trim() === '') {
      flushParagraph(); flushList();
    } else {
      flushList();
      paragraph.push(renderInline(escapeHtml(line.trim())));
    }
  });
  flushParagraph(); flushList();
  return out.join('\n');
}

function hashHtml(htmlFr, htmlEn) {
  return crypto.createHash('sha256').update(`${htmlFr}\n\u0000\n${htmlEn}`, 'utf8').digest('hex');
}

/** Freezes a FR/EN pair: variables resolved, Markdown rendered, SHA-256 of the result. */
function renderVersion({ fr, en }, vars) {
  const rFr = resolveVariables(fr, vars);
  const rEn = resolveVariables(en, vars);
  const unknown = [...new Set([...rFr.unknown, ...rEn.unknown])];
  const htmlFr = renderMarkdown(rFr.text);
  const htmlEn = renderMarkdown(rEn.text);
  return { htmlFr, htmlEn, contentHash: hashHtml(htmlFr, htmlEn), unknown };
}

module.exports = {
  TERMS_VARIABLES,
  buildTermsVariables,
  resolveVariables,
  renderMarkdown,
  renderVersion,
  hashHtml,
  escapeHtml,
};
