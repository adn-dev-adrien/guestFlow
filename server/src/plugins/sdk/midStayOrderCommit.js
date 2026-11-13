/**
 * `coreModule('midStayOrderCommit')` — the SDK name a plugin's order is priced and written under, kept thin over `extraSale`
 * (specs/pricing-components.md D24, Q-C10; the module `utils/midStayOrderCommit.js` was deleted by C30). Names and shapes are the
 * SDK 2.26.0 contract; the work is `extraSale`'s:
 *
 *   priceOrder(reservationId, lines)   → { status: 200, byKey, total } | { status, body }     `extraSale.quote`, nothing written
 *   commitOrder(reservationId, { source, ref, history: { field, label, text }, lines, paid?, within? })
 *                                      → { status: 200, byKey, total, settledCents, overpaidCents } | { status, body }   `extraSale.sell`
 *   mergeOrderLines(body, lines, rows?, nextLineId?)   the fiche body with the lines appended (`utils/stayOrderLines`)
 *
 * `lines` are `{ kind: 'option', id, quantity }`, `{ kind: 'breakfast', id, mornings, time, persons }` and
 * `{ kind: 'resource', id, quantity?, sessions? }`; `byKey` is what the order adds per article (`opt:<id>`, `res:<id>`), in euros.
 * The sale is one of source `shop`; the caller's `source` and `ref` mark the settled note of a paid order and name the sale (`<source>:<ref>`).
 */
const extraSale = require('../../utils/extraSale');
const { mergeOrderLines } = require('../../utils/stayOrderLines');

const minutesOf = (time) => {
  const [h, m] = String(time || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
};
const hoursOf = (sessions) => (sessions || []).reduce((sum, s) => sum + Math.max(0, minutesOf(s.end) - minutesOf(s.start)), 0) / 60;

function requestOf(line) {
  if (line.kind === 'breakfast') return { articleRef: `option:${line.id}`, quantity: line.mornings.length, mornings: line.mornings, time: line.time, persons: line.persons };
  if (line.kind === 'resource') {
    const sessions = Array.isArray(line.sessions) ? line.sessions : [];
    return {
      articleRef: `resource:${line.id}`, quantity: sessions.length ? hoursOf(sessions) : Number(line.quantity || 0), sessions, ...(line.placeOnHeld ? { placeOnHeld: true } : {}),
    };
  }
  return { articleRef: `option:${line.id}`, quantity: line.quantity, ...(line.noFreeUnits ? { noFreeUnits: true } : {}) };
}

function byKeyOf(answered) {
  const byKey = {};
  (answered || []).forEach(({ articleRef, totalCents }) => {
    const [kind, id] = String(articleRef).split(':');
    const key = `${kind === 'resource' ? 'res' : 'opt'}:${id}`;
    byKey[key] = Math.round(((byKey[key] || 0) * 100) + totalCents) / 100;
  });
  Object.keys(byKey).forEach((key) => { if (!(byKey[key] > 0)) delete byKey[key]; });
  return byKey;
}

function priceOrder(reservationId, lines) {
  const quoted = extraSale.quote(reservationId, lines.map(requestOf), { source: 'shop' });
  if (quoted.status !== 200) return quoted;
  return { status: 200, byKey: byKeyOf(quoted.lines), total: quoted.totalCents / 100 };
}

function commitOrder(reservationId, {
  source, ref, history, lines, paid = null, within = null,
} = {}) {
  if (!/^[a-z][a-zA-Z0-9-]{0,39}$/.test(String(source || ''))) throw new Error('commitOrder needs the caller\'s source');
  if (ref === undefined || ref === null || String(ref) === '') throw new Error('commitOrder needs the order\'s ref');
  if (!history || typeof history !== 'object' || !history.field || !history.label || !history.text) throw new Error('commitOrder needs a history entry { field, label, text }');
  const shaped = (sold) => ({
    status: 200, byKey: byKeyOf(sold.lines), total: sold.totalCents / 100, settledCents: sold.settledCents || 0, overpaidCents: sold.overpaidCents || 0,
  });
  const outcome = extraSale.sell(reservationId, lines.map(requestOf), {
    source: 'shop',
    orderRef: `${source}:${ref}`,
    history: { field: String(history.field), label: String(history.label), from: null, to: String(history.text) },
    ...(paid ? { paid: { ...paid, source, ref: String(ref) } } : {}),
    ...(typeof within === 'function' ? { within: (sold) => within(shaped(sold)) } : {}),
  });
  return outcome.status === 200 ? shaped(outcome) : outcome;
}

module.exports = { priceOrder, commitOrder, mergeOrderLines };
