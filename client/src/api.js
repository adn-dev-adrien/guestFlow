const API = process.env.REACT_APP_API_URL || '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...options,
    body: options.body instanceof FormData ? options.body : (options.body ? JSON.stringify(options.body) : undefined),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

const api = {
  // Clients
  getClients: (q) => request(`/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getClient: (id) => request(`/clients/${id}`),
  createClient: (data) => request('/clients', { method: 'POST', body: data }),
  updateClient: (id, data) => request(`/clients/${id}`, { method: 'PUT', body: data }),
  deleteClient: (id) => request(`/clients/${id}`, { method: 'DELETE' }),

  // Properties
  getProperties: () => request('/properties'),
  getProperty: (id) => request(`/properties/${id}`),
  createProperty: (formData) => request('/properties', { method: 'POST', body: formData }),
  updateProperty: (id, formData) => request(`/properties/${id}`, { method: 'PUT', body: formData }),
  deleteProperty: (id) => request(`/properties/${id}`, { method: 'DELETE' }),

  // Pricing
  addPricingRule: (propId, data) => request(`/properties/${propId}/pricing`, { method: 'POST', body: data }),
  updatePricingRule: (propId, ruleId, data) => request(`/properties/${propId}/pricing/${ruleId}`, { method: 'PUT', body: data }),
  deletePricingRule: (propId, ruleId) => request(`/properties/${propId}/pricing/${ruleId}`, { method: 'DELETE' }),
  previewProgressivePricing: (propId, data) => request(`/properties/${propId}/pricing/progressive-preview`, { method: 'POST', body: data }),

  // Documents
  uploadDocument: (propId, formData) => request(`/properties/${propId}/documents`, { method: 'POST', body: formData }),
  deleteDocument: (propId, docId) => request(`/properties/${propId}/documents/${docId}`, { method: 'DELETE' }),

  // Property options
  updatePropertyOptions: (propId, optionIds) => request(`/properties/${propId}/options`, { method: 'PUT', body: { optionIds } }),

  // Options
  getOptions: () => request('/options'),
  createOption: (data) => request('/options', { method: 'POST', body: data }),
  updateOption: (id, data) => request(`/options/${id}`, { method: 'PUT', body: data }),
  deleteOption: (id) => request(`/options/${id}`, { method: 'DELETE' }),

  // Resources
  getResources: (propertyId) => request(`/resources${propertyId ? `?propertyId=${propertyId}` : ''}`),
  getResourcesAvailability: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/resources/availability${qs ? `?${qs}` : ''}`);
  },
  getBabyBedAvailability: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/resources/baby-bed-availability${qs ? `?${qs}` : ''}`);
  },
  createResource: (data) => request('/resources', { method: 'POST', body: data }),
  updateResource: (id, data) => request(`/resources/${id}`, { method: 'PUT', body: data }),
  deleteResource: (id) => request(`/resources/${id}`, { method: 'DELETE' }),

  // Reservations
  getReservations: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/reservations${qs ? `?${qs}` : ''}`);
  },
  getReservation: (id) => request(`/reservations/${id}`),
  calculatePrice: (data) => request('/reservations/calculate-price', { method: 'POST', body: data }),
  createReservation: (data) => request('/reservations', { method: 'POST', body: data }),
  updateReservation: (id, data) => request(`/reservations/${id}`, { method: 'PUT', body: data }),
  markPayment: (id, data) => request(`/reservations/${id}/payment`, { method: 'PATCH', body: data }),
  deleteReservation: (id) => request(`/reservations/${id}`, { method: 'DELETE' }),

  // Finance
  getFinanceSummary: (from, to) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request(`/finance/summary?${params}`);
  },
  getFinanceProjection: (date) => request(`/finance/projection?date=${date || ''}`),
  getPendingPayments: () => request('/finance/pending'),
  getTouristTaxExtraction: (month) => request(`/finance/tourist-tax?month=${encodeURIComponent(month)}`),

  // School holidays
  getSchoolHolidays: () => request('/school-holidays'),
  createSchoolHoliday: (data) => request('/school-holidays', { method: 'POST', body: data }),
  updateSchoolHoliday: (id, data) => request(`/school-holidays/${id}`, { method: 'PUT', body: data }),
  deleteSchoolHoliday: (id) => request(`/school-holidays/${id}`, { method: 'DELETE' }),

  // Calendar notes
  getCalendarNotes: (propertyId, from, to) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request(`/calendar-notes/${propertyId}?${params}`);
  },
  upsertCalendarNote: (propertyId, date, note) => request(`/calendar-notes/${propertyId}/${date}`, { method: 'PUT', body: { note } }),
  deleteCalendarNote: (propertyId, date) => request(`/calendar-notes/${propertyId}/${date}`, { method: 'DELETE' }),
};

export default api;
