/**
 * What the operator must look at today (specs/control-plane-plans-and-access.md rule 18, the screen
 * part; C2b adds the daily email and the failed payments): the customers who entered a state that
 * matters today, the customers already in read-only or suspended, and the failed steps.
 */

const { STATE_LABELS } = require('../utils/lifecycle');
const { parisDay, frDay } = require('../utils/days');

const WATCHED = ['due', 'grace', 'read_only', 'suspended'];
const SEVERITY = { due: 'info', grace: 'warning', read_only: 'error', suspended: 'error' };

function createAlertsController(ctx, customersController) {
  const { models, now } = ctx;
  const { customers, audit, provisioning } = models;

  function list() {
    const today = parisDay(now());
    const live = customers.list().filter((c) => !c.archivedAt);
    const byId = new Map(customers.list().map((c) => [c.id, c]));
    const alerts = [];
    const entered = new Set();
    for (const row of audit.onDay(today, 'state')) {
      const c = byId.get(row.customerId);
      if (!c || !WATCHED.includes(c.state) || entered.has(c.id)) continue;
      entered.add(c.id);
      alerts.push({ customerId: c.id, severity: SEVERITY[c.state], text: `${c.companyName} passe aujourd’hui en « ${STATE_LABELS[c.state]} ».` });
    }
    for (const c of live) {
      if (entered.has(c.id) || !['read_only', 'suspended'].includes(c.state)) continue;
      alerts.push({ customerId: c.id, severity: 'error', text: `${c.companyName} est en « ${STATE_LABELS[c.state]} » depuis le ${frDay(c.stateSince)}.` });
    }
    const labels = new Map([...customersController.CREATE_STEPS, ...customersController.DEPROVISION_STEPS].map((s) => [s.step, s.label]));
    for (const s of provisioning.failed()) {
      const c = byId.get(s.customerId);
      if (!c) continue;
      alerts.push({ customerId: c.id, severity: 'error', text: `${c.companyName} : étape « ${labels.get(s.step) || s.step} » en échec.` });
    }
    return { alerts };
  }

  return { list };
}

module.exports = { createAlertsController };
