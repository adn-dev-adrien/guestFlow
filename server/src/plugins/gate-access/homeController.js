/**
 * The house's half of the « Domotique » channel (specs/guest-app-home-automation.md §3.A-§3.B, §4.3). Sowel's
 * `guestflow` plugin calls these routes with the gate's key and signature; guestFlow never calls the house.
 *
 * `commands` is a long poll: the house keeps one request open up to `wait` seconds, and a guest's tap answers it at
 * once. Waiters live in memory — one process, one house.
 */

const payloads = require('./homePayloads');

const MAX_WAIT_S = 25;

function invalid(res, parsed) {
  return res.status(400).json({
    error: { code: 'INVALID_PAYLOAD', message: parsed.message, details: { field: parsed.field } },
  });
}

// deps: { model(), selection(), clock() } — the plugin's register passes the real ones; tests pass fakes.
function buildHomeController({ model, selection, clock = () => new Date() }) {
  const waiters = new Set();

  const wake = () => {
    [...waiters].forEach((waiter) => waiter.flush());
  };

  return {
    /** GET /public/v1/home/ping */
    ping(_req, res) {
      return res.json({ ok: true, contract: 1, now: clock().toISOString() });
    },

    /** PUT /public/v1/home/catalog — rules 3-4: stored whole, answered with what the lodgings use. */
    catalog(req, res) {
      const parsed = payloads.parseCatalog(req.body);
      if (!parsed.ok) return invalid(res, parsed);
      model().replaceCatalog(parsed.value, clock());
      return res.json({ selection: selection() });
    },

    /** POST /public/v1/home/readings — rules 5-6. */
    readings(req, res) {
      const parsed = payloads.parseReadings(req.body);
      if (!parsed.ok) return invalid(res, parsed);
      return res.json(model().storeReadings(parsed.value, selection(), clock()));
    },

    /** POST /public/v1/home/series — rule 5. */
    series(req, res) {
      const parsed = payloads.parseSeries(req.body);
      if (!parsed.ok) return invalid(res, parsed);
      return res.json(model().storeSeries(parsed.value, selection(), clock()));
    },

    /** GET /public/v1/home/commands?wait=25 — rule 8. */
    commands(req, res) {
      const wait = Math.max(0, Math.min(MAX_WAIT_S, Math.floor(Number(req.query.wait) || 0)));
      const answer = (list) => res.json({
        commands: list.map((c) => ({
          id: c.id, propertyId: c.propertyId, equipmentId: c.equipmentId, value: c.value, issuedAt: c.issuedAt,
        })),
      });
      const now = model().collect(clock());
      if (now.length || wait === 0) return answer(now);
      // A collect that throws from a timer or a wake (tables gone with an uninstall) still answers the house.
      const collected = () => {
        try {
          return model().collect(clock());
        } catch (err) {
          console.error('[gate-access] home commands could not be collected:', err.message);
          return [];
        }
      };

      let done = false;
      const waiter = {
        flush() {
          if (done) return;
          const list = collected();
          if (!list.length) return;
          finish(list);
        },
      };
      const timer = setTimeout(() => finish(collected()), wait * 1000);
      function finish(list) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        waiters.delete(waiter);
        answer(list);
      }
      waiters.add(waiter);
      req.on('close', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        waiters.delete(waiter);
      });
      return undefined;
    },

    /** POST /public/v1/home/commands/results — rule 9: the house's verdict, never retried. */
    results(req, res) {
      const parsed = payloads.parseResults(req.body);
      if (!parsed.ok) return invalid(res, parsed);
      return res.json(model().storeResults(parsed.value, clock()));
    },

    /** The `homeData` provider guest-app reads through `ctx.core.homeData()` (SDK 2.28.0). */
    provider() {
      return {
        channel: () => model().channel(),
        catalog: () => model().catalog(),
        readings: (pairs) => model().readings(pairs),
        series: (pairs) => model().series(pairs),
        queueCommand: (command) => {
          const queued = model().queueCommand(command, clock());
          wake();
          return queued;
        },
        command: (id) => model().command(id, clock()),
        confirmed: (equipmentIds) => model().confirmed(equipmentIds),
      };
    },

    waiting: () => waiters.size,
  };
}

module.exports = { buildHomeController, MAX_WAIT_S };
