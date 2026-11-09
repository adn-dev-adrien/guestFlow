// The guest-app plugin's own admin endpoints (`/api/guest-app/**`, specs/guest-app.md §4.3), kept in the plugin and
// reached through the core's generic `api.pluginRequest` (same session, errors and data-changed event).
import { api } from '../sdk';

const call = (path, options) => api.pluginRequest(`/guest-app${path}`, options);

const guestAppApi = {
  // Rules 1, 9bis — the stay's « Mon séjour » link, shown by the arrival SAS and the fiche, created by the server on
  // first need; regenerating kills the old link and its sessions.
  getStayLink: (id) => call(`/reservations/${id}/stay-link`),
  regenerateStayLink: (id) => call(`/reservations/${id}/stay-link/regenerate`, { method: 'POST' }),
  // Rules 22, 37bis — the sell switch, the article's presentation and its stock, saved apart from the core's row.
  getItem: (kind, id) => call(`/items/${kind}/${id}`),
  saveItem: (kind, id, patch) => call(`/items/${kind}/${id}`, { method: 'PUT', body: patch }),
  // Rule 37quater — the tracked articles' stock, for the fiche's non-blocking « Stock : épuisé ».
  getStock: () => call('/stock'),
  // The studio's photo library, reused by the editors' « Photo » field.
  getMedia: () => call('/studio/media'),
  uploadMedia: (file, { altFr = '', altEn = '' } = {}) => {
    const body = new FormData();
    body.append('file', file);
    body.append('altFr', altFr);
    body.append('altEn', altEn);
    return call('/studio/media', { method: 'POST', body });
  },
  // Rules 41bis, 43, 45 — « Commandes clients », « Marquer livrée / retirée », the planning cards.
  getOrders: (status = 'todo') => call(`/orders?status=${encodeURIComponent(status)}`),
  markDelivered: (id) => call(`/orders/${id}/delivered`, { method: 'POST' }),
  getOrderCards: (from, to) => call(`/planning/order-cards?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
};

export default guestAppApi;
