/**
 * GET /api/dashboard/attention — what asks for the operator on the home, counted and ordered here
 * (specs/shell-and-home-day-first.md §3.B).
 *
 * Every subject is read through the handler its own card calls (rule 7), so the box and the card can
 * never disagree; a source that fails is simply absent (rule 4). Core sources are wired by the route;
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

async function readSource(source, req) {
  try {
    const payload = await payloadOf(source.handler, req, { query: source.query ? source.query() : undefined });
    if (payload === null) return null;
    const summarize = source.summarize || CORE_SUMMARIES[source.key];
    return summarize ? summarize(payload) : null;
  } catch {
    return null;
  }
}

/**
 * coreSources   () → [{ key, rank, handler, query?, skip?(req) }] — resolved per request, so the
 *               heavy controllers load only when the home asks
 * pluginSources () → the plugin subjects (default: the live plugins' declarations)
 */
function buildController({ coreSources = () => [], pluginSources = () => livePluginSources() } = {}) {
  return {
    async attention(req, res) {
      const sources = [...coreSources(), ...pluginSources()].filter((source) => !(source.skip && source.skip(req)));
      const summaries = await Promise.all(sources.map((source) => readSource(source, req)));
      return res.json(buildAttention(sources.map((source, i) => ({ key: source.key, rank: source.rank, summary: summaries[i] }))));
    },
  };
}

module.exports = { buildController, livePluginSources };
