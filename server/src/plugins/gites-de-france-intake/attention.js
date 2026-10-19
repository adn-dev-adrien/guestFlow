/** The Gîtes de France mails to check, as a subject of the home (specs/shell-and-home-day-first.md rules 6, 9). */
function summarize(payload) {
  const n = Array.isArray(payload && payload.items) ? payload.items.length : 0;
  return n ? { count: n, title: 'Mails Gîtes de France à vérifier', detail: `${n} ${n > 1 ? 'mails' : 'mail'}`, severity: 'todo' } : null;
}

module.exports = { summarize };
