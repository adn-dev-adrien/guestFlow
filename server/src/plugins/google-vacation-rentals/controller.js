/**
 * /api/google-vacation-rentals (specs/google-vacation-rentals-feed.md §4.3). Thin handlers: every
 * count, status and mismatch is shaped here or below, the settings tab only renders it.
 *
 * deps: { settings, model, pushService, accuracy, siteOrigin() → the website origin or empty }
 */

// Google's point-of-sale variables (Hotel Center): the dates and the party size of the search.
const LANDING_QUERY = 'checkin=(CHECKINDAY)%2F(CHECKINMONTH)%2F(CHECKINYEAR)'
  + '&checkout=(CHECKOUTDAY)%2F(CHECKOUTMONTH)%2F(CHECKOUTYEAR)&guests=(NUM-ADULTS)'
  + '&utm_source=google&utm_medium=vacation-rentals';

/** Rule 18 — the landing page template given to Google for one property. */
function landingUrlTemplate(siteOrigin, slug) {
  const origin = String(siteOrigin || '').replace(/\/+$/, '');
  if (!origin || !slug) return null;
  return `${origin}/${slug}/?${LANDING_QUERY}`;
}

const RESULT_LABELS = Object.freeze({
  simulated: 'Simulé',
  ok: 'Envoyé',
  warning: 'Envoyé avec avertissements',
  error: 'Échec',
  unchanged: 'Rien à envoyer',
});

function createController({ settings, model, pushService, accuracy, siteOrigin }) {
  function logView(row, names) {
    return {
      id: row.id,
      propertyId: row.propertyId,
      propertyName: names.get(row.propertyId) || null,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      mode: row.mode,
      full: Boolean(row.full),
      reason: row.reason,
      messages: row.messages,
      rates: row.rates,
      days: row.days,
      failed: row.failed,
      httpStatus: row.httpStatus,
      result: row.result,
      resultLabel: RESULT_LABELS[row.result] || (row.finishedAt ? row.result : 'En cours'),
      googleBody: row.googleBody,
    };
  }

  function status(req, res) {
    const origin = siteOrigin();
    const properties = settings.properties().map((p) => {
      const last = p.enabled ? model.lastLog(p.id) : null;
      return {
        id: p.id,
        name: p.name,
        enabled: p.enabled,
        hotelCode: p.hotelCode,
        slug: p.slug,
        landingUrl: landingUrlTemplate(origin, p.slug),
        lastRunAt: last ? last.finishedAt : null,
        lastResult: last ? last.result : null,
        lastResultLabel: last ? RESULT_LABELS[last.result] || last.result : null,
        itineraries: model.countRates(p.id),
        // What the last run could not deliver, sent again by the next one (rule 14).
        pendingDiff: last ? last.failed : 0,
        scheduled: pushService.isPending(p.id) || pushService.isRunning(p.id),
      };
    });
    const error = model.lastError();
    res.json({
      mode: settings.mode(),
      configured: Boolean(settings.partnerId()),
      enabledCount: properties.filter((p) => p.enabled).length,
      properties,
      lastError: error ? { at: error.finishedAt || error.startedAt, propertyId: error.propertyId, text: error.googleBody } : null,
      lastCheck: accuracy.last(),
    });
  }

  async function push(req, res) {
    const body = req.body || {};
    if (!settings.enabledProperties().length) return res.status(409).json({ error: 'Aucun logement activé.' });
    const propertyId = body.propertyId == null || body.propertyId === '' ? null : Number(body.propertyId);
    if (propertyId != null && !settings.enabledProperties().some((p) => p.id === propertyId)) {
      return res.status(404).json({ error: 'Logement non activé.' });
    }
    const runs = await pushService.runAll({ propertyId, full: Boolean(body.full), reason: body.full ? 'full' : 'manual' });
    return res.json({ mode: settings.mode(), runs: runs.map(({ notes, ...run }) => ({ ...run, resultLabel: RESULT_LABELS[run.result] || run.result, notes })) });
  }

  function check(req, res) {
    const body = req.body || {};
    if (!settings.enabledProperties().length) return res.status(409).json({ error: 'Aucun logement activé.' });
    const propertyId = body.propertyId == null || body.propertyId === '' ? null : Number(body.propertyId);
    return res.json(accuracy.run({ propertyId, samples: body.samples }));
  }

  function log(req, res) {
    const names = new Map(settings.properties().map((p) => [p.id, p.name]));
    res.json({ runs: model.listLog(req.query && req.query.limit).map((row) => logView(row, names)) });
  }

  return { status, push, check, log };
}

module.exports = { createController, landingUrlTemplate, RESULT_LABELS };
