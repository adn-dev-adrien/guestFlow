/**
 * The booklet's rich text as the operator types it (rule 18): a light notation, turned into the markup the server
 * accepts and sanitises again (paragraphs, line breaks, bold, italic, lists, links `https:` / `tel:` / `mailto:`).
 *
 *   **gras**   *italique*   [Appeler](tel:+33612345678)
 *   - un point de liste            1. une étape numérotée
 *   a blank line separates two paragraphs; a single line break stays a line break.
 *
 * `toNotation(html)` reads stored markup back into the notation, so a page round-trips without loss.
 */

const SAFE_LINK = /^(https:\/\/\S+|tel:\+?[0-9 ().-]{2,30}|mailto:\S+@\S+)$/i;

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  const parts = [];
  let rest = text;
  const link = /\[([^\]]+)\]\(([^)\s]+)\)/;
  while (rest) {
    const m = link.exec(rest);
    if (!m) { parts.push(emphasis(escapeHtml(rest))); break; }
    parts.push(emphasis(escapeHtml(rest.slice(0, m.index))));
    parts.push(SAFE_LINK.test(m[2]) ? `<a href="${escapeHtml(m[2])}">${emphasis(escapeHtml(m[1]))}</a>` : emphasis(escapeHtml(m[0])));
    rest = rest.slice(m.index + m[0].length);
  }
  return parts.join('');
}

function emphasis(html) {
  return html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

/** The notation → the markup stored on the server. Empty notation → empty string. */
export function toHtml(notation) {
  const blocks = String(notation || '').replace(/\r\n?/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

function walk(node) {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeType !== 1) return '';
  const inner = () => Array.from(node.childNodes).map(walk).join('');
  switch (node.tagName.toLowerCase()) {
    case 'br': return '\n';
    case 'strong': case 'b': return `**${inner()}**`;
    case 'em': case 'i': return `*${inner()}*`;
    case 'a': return `[${inner()}](${node.getAttribute('href') || ''})`;
    case 'p': return `${inner()}\n\n`;
    case 'ul': return `${Array.from(node.children).map((li) => `- ${Array.from(li.childNodes).map(walk).join('')}`).join('\n')}\n\n`;
    case 'ol': return `${Array.from(node.children).map((li, i) => `${i + 1}. ${Array.from(li.childNodes).map(walk).join('')}`).join('\n')}\n\n`;
    default: return inner();
  }
}

/** Stored markup → the notation, for editing. */
export function toNotation(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return Array.from(doc.body.childNodes).map(walk).join('').replace(/\n{3,}/g, '\n\n').trim();
}
