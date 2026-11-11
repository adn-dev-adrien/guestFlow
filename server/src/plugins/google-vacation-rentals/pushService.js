/**
 * One run for one property: compute → diff → build → send → commit → log
 * (specs/google-vacation-rentals-feed.md rules 10-16), and the triggers that start it.
 *
 * Runs of a property are serialized: a run asked while another is in progress waits for it. The
 * triggers (rules 11-13) only fire once a partner id is set (rule 2); a manual run works without it,
 * in simulation, to check the feed before Google opens the account.
 *
 * deps:
 *   settings     createSettings(…) of settings.js
 *   model        buildModel(db) of model.js
 *   client       createGoogleClient(…) of googleClient.js
 *   loadState    async (property, { today, horizonDays, maxLos, reuse }) → computePropertyState(…)
 *   capacityOf   (propertyId) → the public guest cap (the listing's capacity)
 *   today        () → 'YYYY-MM-DD', the operator's day
 *   now          () → Date
 *   timers       { setTimeout, clearTimeout } — injectable for the debounce tests
 */

const xml = require('./ariXml');
const { diffState, isEmptyDiff } = require('./snapshot');

const DEBOUNCE_MS = Object.freeze({
  // Rule 12 — a recipe writing dozens of rules triggers one run.
  pricing: 30 * 1000,
  // Rule 11 — within a minute of the reservation.
  availability: 10 * 1000,
});
const RATE_GROUPS_PER_MESSAGE = 500;

function createPushService({
  settings, model, client, loadState, capacityOf, today, now = () => new Date(), timers = { setTimeout, clearTimeout }, log = console,
}) {
  const chains = new Map();
  const pending = new Map();
  const running = new Set();

  async function runOnce(property, { full, reason }) {
    const mode = settings.mode();
    const startedAt = now().toISOString();
    const started = Date.now();
    const logId = model.startLog({ propertyId: property.id, mode, full, reason, startedAt });
    const summary = {
      propertyId: property.id, mode, full: Boolean(full), reason, messages: 0, rates: 0, days: 0, failed: 0, result: 'unchanged',
    };
    const notes = [];
    let httpStatus = null;
    try {
      const day = today();
      model.dropPast(property.id, day);
      const sent = model.rateSnapshot(property.id);
      // Rule 11 — a booking moves no price: a run it causes keeps the amounts already sent.
      const state = await loadState(property, {
        today: day, horizonDays: settings.horizonDays(), maxLos: settings.maxLos(), reuse: !full && reason === 'availability' ? sent : null,
      });
      summary.quotes = state.quotes;
      const diff = diffState(state, { rates: sent, days: model.daySnapshot(property.id) }, { full });

      // Every party size of an (arrival, length) travels together: one message carries the whole stay.
      const groups = new Map();
      diff.rates.forEach((r) => groups.set(`${r.checkin}|${r.nights}`, []));
      state.rates.forEach((r) => { const g = groups.get(`${r.checkin}|${r.nights}`); if (g) g.push(r); });
      const groupList = [...groups.values()];

      if (isEmptyDiff(diff) && !full) return summary;

      const partnerId = settings.partnerId() || 'simulation';
      const folder = `property-${property.id}`;
      client.beginRun(folder);
      const stamp = startedAt.replace(/\.\d{3}Z$/, 'Z');
      let seq = 0;
      const send = async (path, body, file) => {
        seq += 1;
        summary.messages += 1;
        const res = await client.send({ path, xml: body, folder, file: `${String(seq).padStart(3, '0')}-${file}.xml` });
        if (res.status != null) httpStatus = res.status;
        res.errors.forEach((e) => notes.push(`${file} : ${e}`));
        res.warnings.forEach((w) => notes.push(`${file} (avertissement) : ${w}`));
        if (!res.ok && !res.errors.length) notes.push(`${file} : HTTP ${res.status}`);
        return res;
      };
      const header = (suffix) => ({ partnerId, hotelCode: property.hotelCode, timestamp: stamp, echoToken: `${property.hotelCode}-${startedAt}-${suffix}` });

      if (full) {
        await send(xml.PATHS.propertyData, xml.propertyDataXml({ ...header('property'), name: property.name, capacity: capacityOf(property.id) }), 'property-data');
      }

      const ackDays = [];
      if (diff.days.length) {
        const inv = await send(xml.PATHS.invCount, xml.invCountXml({ ...header('inv'), days: diff.days }), 'inventory');
        const avail = await send(xml.PATHS.avail, xml.availXml({ ...header('avail'), days: diff.days }), 'restrictions');
        if (inv.ok && avail.ok) ackDays.push(...diff.days); else summary.failed += diff.days.length;
      }

      const ackRates = [];
      for (let i = 0; i < groupList.length; i += RATE_GROUPS_PER_MESSAGE) {
        const chunk = groupList.slice(i, i + RATE_GROUPS_PER_MESSAGE).flat();
        const res = await send(xml.PATHS.rateAmount, xml.rateAmountXml({ ...header(`rates-${i}`), rates: chunk }), `rates-${i / RATE_GROUPS_PER_MESSAGE + 1}`);
        if (res.ok) ackRates.push(...chunk); else summary.failed += chunk.length;
      }

      // Rule 14 — what failed stays out of the snapshot, so the next run sends it again.
      model.commit(property.id, { rates: ackRates, removedRates: diff.removedRates, days: ackDays }, startedAt);
      summary.rates = ackRates.length;
      summary.days = ackDays.length;
      if (mode === 'simulation') summary.result = 'simulated';
      else if (summary.failed) summary.result = 'error';
      else summary.result = notes.length ? 'warning' : 'ok';
      return summary;
    } catch (err) {
      summary.result = 'error';
      notes.push(String((err && err.message) || err));
      log.error(`[google-vacation-rentals] run failed for property ${property.id}:`, err && err.message ? err.message : err);
      return summary;
    } finally {
      summary.durationMs = Date.now() - started;
      summary.notes = notes;
      model.finishLog(logId, {
        finishedAt: now().toISOString(),
        messages: summary.messages,
        rates: summary.rates,
        days: summary.days,
        failed: summary.failed,
        httpStatus,
        result: summary.result,
        googleBody: notes.join('\n'),
      });
      model.purgeLog(startedAt);
    }
  }

  /** One property now, after any run of it already in progress. → the run summary. */
  function runProperty(propertyId, { full = false, reason = 'manual' } = {}) {
    const id = Number(propertyId);
    const previous = chains.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const property = settings.enabledProperties().find((p) => p.id === id);
      if (!property) return { propertyId: id, result: 'disabled' };
      running.add(id);
      try { return await runOnce(property, { full, reason }); } finally { running.delete(id); }
    });
    chains.set(id, next);
    return next;
  }

  /** Every enabled property, one after the other (or only `propertyId`). */
  async function runAll({ propertyId = null, full = false, reason = 'manual' } = {}) {
    const ids = propertyId != null ? [Number(propertyId)] : settings.enabledProperties().map((p) => p.id);
    const out = [];
    for (const id of ids) out.push(await runProperty(id, { full, reason }));
    return out;
  }

  /**
   * Rules 11-12 — a trigger ('availability' | 'pricing'): the run starts after the debounce. A trigger
   * arriving while one is already waiting for that property joins it, and a price change makes the
   * waiting run a pricing one. `propertyId` null = every enabled property.
   */
  function schedule(propertyId, kind) {
    if (!settings.partnerId()) return [];
    const ids = propertyId == null
      ? settings.enabledProperties().map((p) => p.id)
      : settings.enabledProperties().filter((p) => p.id === Number(propertyId)).map((p) => p.id);
    ids.forEach((id) => {
      const waiting = pending.get(id);
      if (waiting) {
        if (kind === 'pricing') waiting.kind = 'pricing';
        return;
      }
      const entry = { kind };
      entry.handle = timers.setTimeout(() => {
        pending.delete(id);
        runProperty(id, { reason: entry.kind }).catch(() => {});
      }, DEBOUNCE_MS[kind] || DEBOUNCE_MS.pricing);
      if (entry.handle && typeof entry.handle.unref === 'function') entry.handle.unref();
      pending.set(id, entry);
    });
    return ids;
  }

  /**
   * Rule 13 — the hourly job: at `fullResendHour`, once a day, every enabled property is re-sent in
   * full. → true when it ran.
   */
  async function nightlyTick() {
    if (!settings.partnerId()) return false;
    const at = now();
    if (at.getHours() !== settings.fullResendHour()) return false;
    const last = model.lastNightlyStart();
    if (last && new Date(last).toDateString() === at.toDateString()) return false;
    await runAll({ full: true, reason: 'nightly' });
    return true;
  }

  /**
   * specs/plugin-removal-resilience.md rule 17 — the plugin came back (activated or reinstalled): its triggers
   * were dropped while it was off, so everything is re-sent now instead of at the nightly pass.
   */
  async function catchUp() {
    if (!settings.partnerId()) return false;
    await runAll({ full: true, reason: 'catch-up' });
    return true;
  }

  function cancelPending() {
    pending.forEach((entry) => timers.clearTimeout(entry.handle));
    pending.clear();
  }

  return {
    runProperty, runAll, schedule, nightlyTick, catchUp, cancelPending,
    isPending: (id) => pending.has(Number(id)),
    pendingKind: (id) => (pending.get(Number(id)) || {}).kind || null,
    isRunning: (id) => running.has(Number(id)),
  };
}

module.exports = { createPushService, DEBOUNCE_MS, RATE_GROUPS_PER_MESSAGE };
