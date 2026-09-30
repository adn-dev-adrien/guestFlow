/**
 * The console's API client. Errors carry the server's French `message` (and `errors` per field for
 * a form); a 401 outside the login fires `console:signed-out` so the app goes back to the login.
 */

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('console:signed-out'));
    const err = new Error(data.message || `Erreur ${res.status}`);
    err.status = res.status;
    err.code = data.error;
    err.errors = data.errors || {};
    throw err;
  }
  return data;
}

const api = {
  me: () => request('GET', '/api/auth/me'),
  login: (email, password) => request('POST', '/api/auth/login', { email, password }),
  verify: (code) => request('POST', '/api/auth/verify', { code }),
  resend: () => request('POST', '/api/auth/resend', {}),
  logout: () => request('POST', '/api/auth/logout', {}),
  mfaStart: (method) => request('POST', '/api/auth/mfa/start', { method }),
  mfaConfirm: (code) => request('POST', '/api/auth/mfa/confirm', { code }),

  alerts: () => request('GET', '/api/alerts'),
  fleet: () => request('GET', '/api/customers'),
  previewCustomer: (form) => request('POST', '/api/customers/preview', form),
  createCustomer: (form) => request('POST', '/api/customers', form),
  customer: (id) => request('GET', `/api/customers/${id}`),
  stepAction: (id, step, action) => request('POST', `/api/customers/${id}/steps/${step}`, { action }),
  recordPayment: (id, body) => request('POST', `/api/customers/${id}/payment`, body),
  extend: (id, body) => request('POST', `/api/customers/${id}/extend`, body),
  forceActive: (id, body) => request('POST', `/api/customers/${id}/force-active`, body),
  changePlan: (id, body) => request('POST', `/api/customers/${id}/plan`, body),
  deprovision: (id, confirmSlug) => request('POST', `/api/customers/${id}/deprovision`, { confirmSlug }),
  reactivate: (id) => request('POST', `/api/customers/${id}/reactivate`, {}),
  cancelErase: (id) => request('POST', `/api/customers/${id}/cancel-erase`, {}),
  eraseNow: (id, confirmSlug) => request('POST', `/api/customers/${id}/erase`, { confirmSlug }),
  licenceUrl: (id) => `/api/customers/${id}/licence`,
  setBilling: (id, body) => request('POST', `/api/customers/${id}/billing`, body),
  remindPreview: (id) => request('POST', `/api/customers/${id}/remind`, { preview: true }),
  remind: (id) => request('POST', `/api/customers/${id}/remind`, {}),
  checkPayment: (id) => request('POST', `/api/customers/${id}/check-payment`, {}),
  sendEmail: (id) => request('POST', `/api/emails/${id}/send`, {}),
  ignoreEmail: (id) => request('POST', `/api/emails/${id}/ignore`, {}),

  templates: () => request('GET', '/api/templates'),
  saveTemplate: (key, body) => request('PUT', `/api/templates/${key}`, body),
  previewTemplate: (key, body) => request('POST', `/api/templates/${key}/preview`, body),

  catalogue: () => request('GET', '/api/catalogue'),
  toggleCell: (lowest, pluginId, planCode) => request('POST', '/api/catalogue/toggle', { lowest, pluginId, planCode }),
  catalogueImpact: (lowest) => request('POST', '/api/catalogue/impact', { lowest }),
  saveCatalogue: (body) => request('PUT', '/api/catalogue', body),
};

export default api;
