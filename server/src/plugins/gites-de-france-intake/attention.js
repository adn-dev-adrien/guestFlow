/** The Gîtes de France mails to check, as a subject of the home (specs/shell-and-home-day-first.md rules 6, 9). */
const plural = (n) => `${n} ${n > 1 ? 'mails' : 'mail'}`;

// Rule 32 — a pass that hit the mail cap leaves `unread` mails behind: the line says it instead of the log alone.
function summarize(payload) {
  const n = Array.isArray(payload && payload.items) ? payload.items.length : 0;
  const unread = Number(payload && payload.unread) || 0;
  if (!n && !unread) return null;
  if (!n) return { count: unread, title: `Mails non lus : ${unread} (afflux).`, detail: 'Plafond de lecture atteint', severity: 'todo' };
  return { count: n, title: 'Mails Gîtes de France à vérifier', detail: unread ? `${plural(n)} · ${unread} non lus (afflux)` : plural(n), severity: 'todo' };
}

module.exports = { summarize };
