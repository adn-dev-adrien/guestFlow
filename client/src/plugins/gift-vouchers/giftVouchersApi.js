// The gift-vouchers plugin's admin endpoints (`/api/gift-vouchers/**`, specs/gift-vouchers/gift-vouchers.md §4.3, specs/gift-vouchers/gift-voucher-campaigns.md §4.4), kept in the plugin
// and reached through the core's generic `api.pluginRequest` (same session, errors and data-changed event).
import { api } from '../sdk';

const call = (path, options) => api.pluginRequest(`/gift-vouchers${path}`, options);
const PLUGIN_ID = 'gift-vouchers';
const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Fetched rather than linked so the session cookie travels and a refusal is a message, not a browser error page.
async function fetchFile(path) {
  const res = await fetch(`${API_BASE}/gift-vouchers${path}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw Object.assign(new Error((body && body.error) || 'Le téléchargement n’a pas abouti.'), { code: body && body.code, field: body && body.field });
  }
  const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
  return { blob: await res.blob(), filename: match ? match[1] : null };
}

function saveBlob({ blob, filename }, fallbackName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// The print sheets (week-weekend-and-print spec rules 22-27): the layout the dialog previews and the PDF drawn from it, by the options of the dialog.
const printQuery = ({ mode, perSheet, count, flip }) => {
  const params = new URLSearchParams({ mode, perSheet: String(perSheet), count: String(count) });
  if (flip) params.set('flip', flip);
  return `?${params.toString()}`;
};

const download = async (path, fallbackName) => { saveBlob(await fetchFile(path), fallbackName); };

const upload = (path, method, { file, fields = {} }) => {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => { if (value !== undefined && value !== null) form.append(key, value); });
  if (file) form.append('file', file);
  return call(path, { method, body: form });
};

const giftVouchersApi = {
  list: ({
    q = '', state = '', campaignId = '', kind = '',
  } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (state) params.set('state', state);
    if (campaignId) params.set('campaignId', String(campaignId));
    if (kind) params.set('kind', kind);
    const query = params.toString();
    return call(query ? `?${query}` : '');
  },
  get: (id) => call(`/${id}`),
  create: (body) => call('', { method: 'POST', body }),
  extend: (id, expiresOn) => call(`/${id}/extend`, { method: 'POST', body: { expiresOn } }),
  cancel: (id, { force = false, reason = '' } = {}) => call(`/${id}/cancel`, { method: 'POST', body: force ? { force: true, reason } : {} }),
  settleRefund: (id, refundId) => call(`/${id}/refunds/${refundId}/settle`, { method: 'POST', body: {} }),
  adjust: (id, amountCents, reason) => call(`/${id}/adjust`, { method: 'POST', body: { amountCents, reason } }),
  resend: (id, email) => call(`/${id}/resend`, { method: 'POST', body: email ? { email } : {} }),
  reveal: (id) => call(`/${id}/reveal`, { method: 'POST', body: {} }),
  downloadVoucher: (id, number) => download(`/${id}/pdf`, `${number || 'bon'}.pdf`),
  voucherPrintLayout: (id, options) => call(`/${id}/print-layout${printQuery(options)}`, { readOnly: true }),
  downloadVoucherPrint: (id, number, options) => download(`/${id}/print.pdf${printQuery(options)}`, `${number || 'bon'}-impression.pdf`),
  // A voucher on a fiche (rules 40-41): what the card shows, the payment, its undo, the re-credit of a cancelled stay.
  getStay: (reservationId) => call(`/stays/${reservationId}`),
  payStay: (reservationId, { code, amountCents }) => call(`/stays/${reservationId}/pay`, { method: 'POST', body: { code, amountCents } }),
  undoStayPayment: (reservationId, ref) => call(`/stays/${reservationId}/payments/${ref}`, { method: 'DELETE' }),
  recreditStay: (reservationId) => call(`/stays/${reservationId}/recredit`, { method: 'POST', body: {} }),

  // Campaigns, catalogue and offer (specs/gift-vouchers/gift-voucher-campaigns.md rules 2-10, 41, 46).
  catalogue: () => call('/catalogue'),
  listCampaigns: () => call('/campaigns'),
  getCampaign: (id) => call(`/campaigns/${id}`),
  createCampaign: (body) => call('/campaigns', { method: 'POST', body }),
  updateCampaign: (id, body) => call(`/campaigns/${id}`, { method: 'PUT', body }),
  duplicateCampaign: (id) => call(`/campaigns/${id}/duplicate`, { method: 'POST', body: {} }),
  previewPrice: (body, options = {}) => call('/campaigns/preview-price', { method: 'POST', body, readOnly: true, ...options }),
  importRecipe: (file) => upload('/campaigns/import', 'POST', { file }),
  downloadMerchantCard: (id, slug) => download(`/campaigns/${id}/merchant-card.pdf`, `carte-commercant-${slug || id}.pdf`),
  campaignPrintLayout: (id, options) => call(`/campaigns/${id}/print-layout${printQuery(options)}`, { readOnly: true }),
  downloadCampaignPrint: (id, slug, options) => download(`/campaigns/${id}/print.pdf${printQuery(options)}`, `cartes-commercant-${slug || id}.pdf`),
  downloadRecipe: (id, slug) => download(`/campaigns/${id}/recipe.zip`, `recette-${slug || id}.zip`),
  getOffer: () => call('/offer'),
  offerPrice: (body, options = {}) => call('/offer/price', { method: 'POST', body, readOnly: true, ...options }),

  // The visual library (rules 47-48).
  listVisuals: () => call('/visuals'),
  createVisual: ({ file, name, use }) => upload('/visuals', 'POST', { file, fields: { name, use } }),
  updateVisual: (id, { file, name, use }) => upload(`/visuals/${id}`, 'PUT', { file, fields: { name, use } }),
  deleteVisual: (id) => call(`/visuals/${id}`, { method: 'DELETE' }),
  visualImageUrl: (visual) => `${API_BASE}/gift-vouchers/visuals/${visual.id}/image?version=${visual.versionId}`,

  getSettings: () => api.getPluginSettings(PLUGIN_ID),
  saveSettings: (values) => api.savePluginSettings(PLUGIN_ID, values),
  getProperties: () => api.getProperties(),
};

export default giftVouchersApi;
