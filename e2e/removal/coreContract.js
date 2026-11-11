// The core's API contract for the removal matrix (specs/plugin-removal-resilience.md rule 9): every
// endpoint answers 200 with its documented top-level keys (`keys`) or as a list (`array`), whichever
// plugin is gone. One entry per read the core pages make.
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function coreContract({ stays }) {
  const now = new Date();
  const from = isoDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = isoDay(new Date(now.getFullYear(), now.getMonth() + 3, 0));
  const weekEnd = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 13));
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = `${last.getFullYear()}-${pad(last.getMonth() + 1)}`;
  return [
    { path: '/api/dashboard/attention', keys: ['pinned', 'items', 'total'] },
    { path: '/api/today', keys: ['today'] },
    { path: '/api/reservations', array: true },
    { path: `/api/reservations/${stays.direct.id}`, keys: ['id', 'finalPrice', 'resources', 'options'] },
    { path: `/api/reservations/${stays.platform.id}`, keys: ['id', 'finalPrice', 'resources', 'options'] },
    { path: `/api/calendar?from=${from}&to=${to}`, keys: ['stays', 'closures'] },
    { path: '/api/planning/today', keys: ['arrivals', 'departures'] },
    { path: `/api/planning/days?from=${isoDay(now)}&to=${weekEnd}`, keys: ['days', 'alerts'] },
    { path: '/api/clients', array: true },
    { path: '/api/devis', array: true },
    { path: '/api/finance/dashboard', keys: ['window', 'fiscalYear', 'months'] },
    { path: `/api/finance/tourist-tax?month=${lastMonth}`, keys: [] },
    { path: '/api/finance/vat-franchise', keys: ['applies'] },
    { path: '/api/finance/pace', keys: ['summary', 'pickup'] },
    { path: `/api/accounting/cancellation-compensations?month=${now.getMonth() + 1}&year=${now.getFullYear()}`, keys: ['pending', 'received', 'totals'] },
    { path: '/api/email-templates', array: true },
    { path: '/api/emails/pending', array: true },
    { path: '/api/emails/history', keys: ['rows', 'total'] },
    { path: '/api/properties', array: true },
    { path: '/api/options', array: true },
    { path: '/api/resources', array: true },
    { path: '/api/settings', keys: ['company', 'smtp', 'emails'] },
    { path: '/api/users', keys: ['users'] },
    { path: '/api/platforms', keys: ['platforms'] },
    { path: '/api/plugins', array: true },
    { path: '/api/plugins/status', keys: ['mode'] },
  ];
}

module.exports = { coreContract };
