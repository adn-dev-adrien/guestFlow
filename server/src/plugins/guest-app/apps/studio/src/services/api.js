/**
 * The studio's one door to GuestFlow: `/api/guest-app/**` with the admin session cookie (specs/guest-app.md
 * rule 47, same origin as GuestFlow). A dead session sends the operator to GuestFlow's login, which brings them
 * back here; every other refusal surfaces the server's French message as it is.
 */
const BASE = '/api/guest-app';

export const LOGIN_PATH = '/login';

/** The login URL that brings the operator back to where they were. */
export function loginUrl(location = window.location) {
  return `${LOGIN_PATH}?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
}

function toError(status, body) {
  const message = (body && (typeof body.error === 'string' ? body.error : body.message)) || 'Le serveur ne répond pas correctement.';
  return Object.assign(new Error(message), { status, code: body && body.code });
}

async function request(path, { method = 'GET', body, raw = false } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers: body instanceof FormData || body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body instanceof FormData || body === undefined ? body : JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error('Connexion au serveur impossible.'), { status: 0, code: 'NETWORK' });
  }
  if (res.status === 401) {
    window.location.assign(loginUrl());
    throw Object.assign(new Error('Session expirée.'), { status: 401 });
  }
  if (!res.ok) throw toError(res.status, await res.json().catch(() => null));
  if (raw) return res;
  return res.json();
}

const enc = encodeURIComponent;

export const api = {
  lodgings: () => request('/studio/lodgings'),
  lodging: (id) => request(`/lodgings/${enc(id)}`),
  saveLodging: (id, patch) => request(`/lodgings/${enc(id)}`, { method: 'PUT', body: patch }),
  regenerateQr: (id) => request(`/lodgings/${enc(id)}/regenerate-qr`, { method: 'POST' }),
  qrPosterUrl: (id) => `${BASE}/lodgings/${enc(id)}/qr-poster.pdf`,

  items: (propertyId) => request(`/items?propertyId=${enc(propertyId)}`),
  saveItem: (kind, id, patch) => request(`/items/${enc(kind)}/${enc(id)}`, { method: 'PUT', body: patch }),

  serviceHours: (propertyId = null) => request(`/service-hours${propertyId ? `?propertyId=${enc(propertyId)}` : ''}`),
  saveServiceHours: (config, propertyId = null) => request(`/service-hours${propertyId ? `?propertyId=${enc(propertyId)}` : ''}`, { method: 'PUT', body: config }),

  settings: () => request('/studio/settings'),
  saveSettings: (patch) => request('/studio/settings', { method: 'PUT', body: patch }),
  syncSoliomap: () => request('/studio/soliomap/sync', { method: 'POST' }),

  booklet: (propertyId) => request(`/studio/lodgings/${enc(propertyId)}/booklet`),
  saveBooklet: (propertyId, pages) => request(`/studio/lodgings/${enc(propertyId)}/booklet`, { method: 'PUT', body: { pages } }),
  preview: (propertyId, lang) => request(`/studio/lodgings/${enc(propertyId)}/preview?lang=${enc(lang)}`),
  publish: (propertyId) => request(`/studio/lodgings/${enc(propertyId)}/publish`, { method: 'POST' }),
  createPage: (propertyId, page) => request(`/studio/lodgings/${enc(propertyId)}/pages`, { method: 'POST', body: page }),
  page: (id) => request(`/studio/pages/${enc(id)}`),
  savePage: (id, patch) => request(`/studio/pages/${enc(id)}`, { method: 'PUT', body: patch }),
  deletePage: (id) => request(`/studio/pages/${enc(id)}`, { method: 'DELETE' }),
  sharePage: (id, propertyId) => request(`/studio/pages/${enc(id)}/placements`, { method: 'POST', body: { propertyId } }),
  unsharePage: (id, propertyId) => request(`/studio/pages/${enc(id)}/placements/${enc(propertyId)}`, { method: 'DELETE' }),
  duplicatePage: (id, toPropertyId) => request(`/studio/pages/${enc(id)}/duplicate`, { method: 'POST', body: { toPropertyId } }),
  createBlock: (pageId, block) => request(`/studio/pages/${enc(pageId)}/blocks`, { method: 'POST', body: block }),
  saveBlock: (id, patch) => request(`/studio/blocks/${enc(id)}`, { method: 'PUT', body: patch }),
  deleteBlock: (id) => request(`/studio/blocks/${enc(id)}`, { method: 'DELETE' }),
  orderBlocks: (pageId, blockIds) => request(`/studio/pages/${enc(pageId)}/blocks/order`, { method: 'PUT', body: { blockIds } }),

  media: () => request('/studio/media'),
  uploadMedia: (file, alt = {}) => {
    const form = new FormData();
    form.append('file', file);
    if (alt.altFr) form.append('altFr', alt.altFr);
    if (alt.altEn) form.append('altEn', alt.altEn);
    return request('/studio/media', { method: 'POST', body: form });
  },
  saveMedia: (id, alt) => request(`/studio/media/${enc(id)}`, { method: 'PUT', body: alt }),
};
