/**
 * Updates the document's favicon `<link>` tag at runtime. Used by the `useDynamicFavicon` hook
 * to swap the bundled default for the configured company logo as soon as we know the logo
 * path — works in DEV (where CRA's :3000 dev server serves `public/favicon.ico` and never
 * proxies it to Node) and in PROD (belt + braces with the server-side middleware).
 *
 * Strategy:
 *   - When `href` is non-empty, install a single `<link rel="icon" data-dynamic-favicon="1">`
 *     in <head> with that href. We strip every existing `<link rel="icon">` first so the
 *     browser doesn't keep showing the bundled default (Firefox picks the first declaration,
 *     ignoring later ones — best to leave exactly one).
 *   - When `href` is empty / null, restore the bundled default `<link rel="icon" href="/favicon.ico">`
 *     so re-clearing the logo in Settings brings the default back without a hard refresh.
 *   - A cache-buster query (`?v=<token>`) defeats the browser's aggressive favicon cache;
 *     without it, Safari and Chrome happily keep the previous logo even after a real upload.
 *
 * The function is intentionally a pure DOM mutation — no React, no hooks. The hook
 * (`useDynamicFavicon`) decides WHEN to call it; this file decides HOW.
 */

export const DYNAMIC_FLAG = 'data-dynamic-favicon';
export const DEFAULT_HREF = '/favicon.ico';

function appendCacheBuster(href, version) {
  if (!version) return href;
  const sep = href.includes('?') ? '&' : '?';
  return `${href}${sep}v=${encodeURIComponent(version)}`;
}

function mimeFromHref(href) {
  const lower = String(href).toLowerCase().split('?')[0];
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.ico')) return 'image/x-icon';
  return undefined; // let the browser sniff
}

/**
 * @param {object} args
 * @param {string|null|undefined} args.href — public URL of the icon (e.g. `/uploads/company-logo.png`).
 *                                            Pass empty/null to restore the bundled default.
 * @param {string} [args.version] — version token appended as `?v=...` to bust browser cache (typically
 *                                  `updatedAt` from Settings). Optional.
 * @param {Document} [args.doc] — DOM document to mutate. Defaults to `window.document`. Exposed for tests.
 */
export function setFavicon({ href, version, doc } = {}) {
  const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
  if (!targetDoc) return;
  const head = targetDoc.head || targetDoc.getElementsByTagName('head')[0];
  if (!head) return;

  // Always strip every prior `<link rel="icon">` (dynamic or bundled-default) so the browser has
  // exactly one icon link at any time. Firefox picks the FIRST declaration; leaving the static
  // one in place defeats our dynamic update.
  const existing = targetDoc.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]');
  existing.forEach((node) => node.parentNode && node.parentNode.removeChild(node));

  const finalHref = href && String(href).trim()
    ? appendCacheBuster(String(href).trim(), version)
    : DEFAULT_HREF;

  const link = targetDoc.createElement('link');
  link.setAttribute('rel', 'icon');
  link.setAttribute('href', finalHref);
  link.setAttribute(DYNAMIC_FLAG, '1');
  const mime = mimeFromHref(finalHref);
  if (mime) link.setAttribute('type', mime);

  head.appendChild(link);
}

export const __test = { appendCacheBuster, mimeFromHref };
