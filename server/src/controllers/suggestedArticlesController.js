/**
 * Suggested articles controller — HTTP face of `utils/suggestedArticles.js` (the outside-visit spec §4.3, rules 36-37).
 *
 *   GET /api/suggested-articles?kind=&id=&customerContext=   → { suggestions: [{ articleRef, label, unitCents, max }] }
 *   GET /api/settings/suggested-articles                     → { kinds: [{ kind, label, contexts: [{ id, label, articleRefs }] }] }   (admin)
 *   PUT /api/settings/suggested-articles/:kind/:id           { articleRefs: [] } → { context }   (admin; ≤ 12, 400 ARTICLE_UNKNOWN, 404 CONTEXT_UNKNOWN)
 * Thin: parse, call the service, answer.
 */
const suggestedArticles = require('../utils/suggestedArticles');

module.exports = {
  resolved(req, res) {
    const { kind, id, customerContext } = req.query || {};
    if (!kind || id == null || id === '') return res.status(400).json({ error: 'Contexte requis.', code: 'INVALID_REQUEST' });
    if (customerContext !== undefined && !['hosted', 'external'].includes(customerContext)) return res.status(400).json({ error: 'Client inconnu.', code: 'INVALID_REQUEST' });
    return res.json({ suggestions: suggestedArticles.resolve({ context: { kind: String(kind), id: String(id) }, customerContext: customerContext || 'hosted' }) });
  },

  settings(req, res) {
    return res.json(suggestedArticles.settingsView());
  },

  save(req, res) {
    const result = suggestedArticles.save(req.params.kind, req.params.id, (req.body || {}).articleRefs);
    if (result.status !== 200) return res.status(result.status).json(result.body);
    return res.json({ context: { kind: req.params.kind, id: req.params.id, articleRefs: result.articleRefs } });
  },
};
