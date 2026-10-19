/**
 * GET /api/dashboard/attention — what asks for the operator on the home, counted and ordered here
 * (specs/shell-and-home-day-first.md §3.B).
 *
 * Every subject is read through the handler its own card calls (rule 7), so the box and the card can
 * never disagree; a source that fails is logged and named in `unavailable` (rule 20). Core sources are wired by the route;
 * plugin sources come from `ctx.attention(...)` of the live plugins (rule 9).
 */

const pluginRegistry = require('../plugins/sdk/registry');
const { payloadOf } = require('../utils/handlerPayload');
const { CORE_SUMMARIES, buildAttention } = require('../utils/dashboardAttention');

/** The subjects the live plugins declared: [{ key, rank, handler, summarize }]. */
function livePluginSources(registry = pluginRegistry) {
  return registry.all()
    .filter((record) => !record.failed && Array.isArray(record.attention) && registry.isLive(record.id))
    .flatMap((record) => record.attention);
}

/** → { summary, failed }. A failure is logged with its reason, never swallowed (rule 20). */
async function readSource(source, req, logger) {
  const fail = (reason) => {
    logger.warn(`[attention] source ${source.key} failed: ${reason}`);
    return { summary: null, failed: true };
  };
  const result = await payloadOf(source.handler, req, { query: source.query ? source.query() : undefined });
  if (!result.ok) return fail(result.reason);
  const summarize = source.summarize || CORE_SUMMARIES[source.key];
  if (!summarize) return fail('no summary');
  try {
    return { summary: summarize(result.body), failed: false };
  } catch (err) {
    return fail((err && err.message) || String(err));
  }
}

/**
 * coreSources   () → [{ key, rank, handler, query?, skip?(req) }] — resolved per request, so the
 *               heavy controllers load only when the home asks
 * pluginSources () → the plugin subjects (default: the live plugins' declarations)
 * logger        where a failed source is reported (default: console)
 */
function buildController({ coreSources = () => [], pluginSources = () => livePluginSources(), logger = console } = {}) {
  return {
    async attention(req, res) {
      const sources = [...coreSources(), ...pluginSources()].filter((source) => !(source.skip && source.skip(req)));
      const reads = await Promise.all(sources.map((source) => readSource(source, req, logger)));
      return res.json(buildAttention(sources.map((source, i) => ({ key: source.key, rank: source.rank, ...reads[i] }))));
    },
  };
}

module.exports = { buildController, livePluginSources };
