/**
 * The arrival SAS commit contract of plugin steps (specs/plugins-phase-3c-hourly-resources.md rules
 * 6–8). A plugin declares a hook with `ctx.sasCommit({ step, validate, complementItems, write })`;
 * the SAS controller runs them around the core commit, only while the plugin is live.
 *
 *   validate(reservation, payload)        → { ok: true } | { ok: false, status, body }   (step ran)
 *   complementItems(reservation, payload) → [{ key, label, amount }]                     (every commit)
 *   write(db, reservation, payload)       → void, inside the commit's transaction         (step ran)
 *
 * `payload` is `pluginSteps[step]` of the commit body; `undefined` when the step did not run.
 */

const registry = require('../plugins/sdk/registry');

function liveHooks() {
  return registry.all()
    .filter((record) => record.sasCommits.length > 0 && registry.isLive(record.id))
    .flatMap((record) => record.sasCommits.map((hook) => ({ pluginId: record.id, hook })));
}

const hasColumn = (db, table, column) => {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column); } catch { return false; }
};

// The lines plugins billed on this stay before. Their labels let the commit drop a copy an older
// dialog carries back (rule 7); those of a plugin that is not live are kept as stored (rule 8).
function storedPluginLines(db, reservationId) {
  if (!hasColumn(db, 'reservation_custom_options', 'sasLineKey')) return [];
  return db.prepare('SELECT description, amount, offered, sasLineKey FROM reservation_custom_options WHERE reservationId = ? AND sasLineKey IS NOT NULL')
    .all(Number(reservationId));
}

/**
 * Everything the plugins add to an arrival commit. Returns `{ refusal }` on the first refusal, or
 * `{ items, writes, labels }`: the complement items they bill (tagged `sasLineKey`), the writes to run
 * inside the transaction, and every label a plugin line goes by on this stay.
 */
function prepare({ reservation, pluginSteps = {}, db = require('../database') }) {
  const items = [];
  const writes = [];
  const hooks = liveHooks();
  const live = new Set(hooks.map((h) => h.pluginId));
  const stored = storedPluginLines(db, reservation.id);
  // Rule 8 (P10) — what a plugin billed stays, at its amount, while that plugin is off: the commit
  // rewrites every SAS line, so it is re-sent as stored.
  for (const row of stored) {
    if (live.has(String(row.sasLineKey).split(':')[0])) continue;
    items.push({ label: String(row.description).trim(), amount: Number(row.amount), offered: Number(row.offered) === 1, sasLineKey: row.sasLineKey });
  }
  for (const { pluginId, hook } of hooks) {
    const payload = pluginSteps && Object.prototype.hasOwnProperty.call(pluginSteps, hook.step)
      ? pluginSteps[hook.step]
      : undefined;
    if (payload !== undefined) {
      const verdict = hook.validate(reservation, payload) || { ok: true };
      if (!verdict.ok) return { refusal: { status: verdict.status || 409, body: verdict.body || {} } };
      writes.push((db) => hook.write(db, reservation, payload));
    }
    for (const item of hook.complementItems(reservation, payload) || []) {
      const amount = Math.round(Number(item.amount) * 100) / 100;
      if (!(amount > 0)) continue;
      items.push({ label: String(item.label || '').trim(), amount, sasLineKey: `${pluginId}:${item.key}` });
    }
  }
  const labels = new Set([...stored.map((row) => String(row.description).trim()), ...items.map((i) => i.label)]);
  return { items, writes, labels };
}

module.exports = { prepare, liveHooks };
