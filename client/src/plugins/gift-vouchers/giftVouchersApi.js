// The gift-vouchers plugin's admin endpoints (`/api/gift-vouchers/**`, specs/gift-vouchers.md §4.3), kept in the plugin
// and reached through the core's generic `api.pluginRequest` (same session, errors and data-changed event).
import { api } from '../sdk';

const call = (path, options) => api.pluginRequest(`/gift-vouchers${path}`, options);
const PLUGIN_ID = 'gift-vouchers';
const API_BASE = import.meta.env.VITE_API_URL || '/api';

const giftVouchersApi = {
  list: ({ q = '', state = '' } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (state) params.set('state', state);
    const query = params.toString();
    return call(query ? `?${query}` : '');
  },
  get: (id) => call(`/${id}`),
  create: (body) => call('', { method: 'POST', body }),
  extend: (id, expiresOn) => call(`/${id}/extend`, { method: 'POST', body: { expiresOn } }),
  cancel: (id) => call(`/${id}/cancel`, { method: 'POST', body: {} }),
  adjust: (id, amountCents, reason) => call(`/${id}/adjust`, { method: 'POST', body: { amountCents, reason } }),
  resend: (id) => call(`/${id}/resend`, { method: 'POST', body: {} }),
  reveal: (id) => call(`/${id}/reveal`, { method: 'POST', body: {} }),
  // Fetched rather than linked so the session cookie travels and a refusal is a message, not a browser error page.
  openPdf: async (id) => {
    const res = await fetch(`${API_BASE}/gift-vouchers/${id}/pdf`, { credentials: 'include' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error((body && body.error) || 'Le PDF n’a pas pu être ouvert.');
    }
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  getSettings: () => api.getPluginSettings(PLUGIN_ID),
  saveSettings: (values) => api.savePluginSettings(PLUGIN_ID, values),
  getProperties: () => api.getProperties(),
};

export default giftVouchersApi;
