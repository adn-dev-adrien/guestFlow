/**
 * A Lucide glyph as an SVG string, for what Leaflet draws from HTML (the markers). `data` is a Lucide icon's drawing data
 * (`__iconData` of `lucide-react/icons/<name>`: `{ node: [[tag, attrs], …] }`); the stroke is white, the page's own glyphs
 * being the components.
 */

const attributes = (attrs) => Object.entries(attrs)
  .filter(([name]) => name !== 'key')
  .map(([name, value]) => `${name}="${String(value).replace(/"/g, '&quot;')}"`)
  .join(' ');

export function glyphSvg(data, size = 18, stroke = '#FFFFFF') {
  const shapes = data.node.map(([tag, attrs]) => `<${tag} ${attributes(attrs)}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shapes}</svg>`;
}
