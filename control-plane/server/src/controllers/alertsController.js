/**
 * What the operator must look at today (specs/control-plane-plans-and-access.md rule 18): the
 * customers who entered a state that matters today, the customers already in read-only or
 * suspended, the failed steps, and from the billing (C2b) the missing Qonto connection, the invoices
 * not created, the failed payments and the emails awaiting approval. The home page shows it; the
 * daily email sends the same lines.
 */

const { STATE_LABELS } = require('../utils/lifecycle');
const { parisDay, frDay } = require('../utils/days');

const WATCHED = ['due', 'grace', 'read_only', 'suspended'];
const SEVERITY = { due: 'info', grace: 'warning', read_only: 'error', suspended: 'error' };

function createAlertsController(ctx, customersController, billingController) {
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
    for (const c of customersController.erasureBlocked()) {
      alerts.push({ customerId: c.id, severity: 'warning', text: `${c.companyName} : effacement en attente de « Processus et route arrêtés ».` });
    }
    alerts.push(...billingController.alerts());
    return { alerts, queue: billingController.queue() };
  }

  // Rule 18: the same lines as the home page, as the body of the operator's daily email.
  function digestLines() {
    const { alerts, queue } = list();
    const lines = [];
    if (alerts.length) lines.push('À regarder', ...alerts.map((a) => `• ${a.text}`));
    if (queue.length) {
      if (lines.length) lines.push('');
      lines.push(`Emails à valider (${queue.length})`, ...queue.map((q) => `• ${q.companyName} : ${q.name}`));
    }
    return lines;
  }

  return { list, digestLines };
}

module.exports = { createAlertsController };
