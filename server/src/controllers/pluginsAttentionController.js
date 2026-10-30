/**
 * The plugins the system switched off at a core update because a requirement they now need is off
 * (specs/plugins-phase-4-registry.md rule 57), as the home's attention subject `plugins-switched-off` reads them:
 * [{ id, name, requires }] with display names. A notice ends when the operator switches the plugin back on, and also when anything touched the row after the
 * switch-off (`updatedAt` moved past `offAt`): a core older than the column toggles rows without clearing the reason.
 */
const { findPlugin } = require('../constants/plugins');

const nameOf = (id, rows) => {
  const row = rows.find((r) => r.id === id);
  return (findPlugin(id) || {}).name || (row && row.manifest && row.manifest.name) || id;
};

function switchedOffNotices(model) {
  const rows = model.list();
  return rows.filter((r) => !r.enabled && r.offReason && r.offAt && r.offAt === r.updatedAt).map((r) => ({ id: r.id, name: nameOf(r.id, rows), requires: nameOf(r.offReason, rows) }));
}

/** Express handler for the attention source: `{ items }`. */
const handler = (model, managed = () => false) => (req, res) => res.json({ items: switchedOffNotices(model), managed: managed() });

module.exports = { switchedOffNotices, handler };
