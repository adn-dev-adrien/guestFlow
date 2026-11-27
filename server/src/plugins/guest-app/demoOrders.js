/**
 * The simulated orders of the demo sessions (specs/guest-app/guest-app-demo-mode.md rule 11): kept in memory, keyed by the session,
 * at most `cap` per session (the oldest goes first) and `maxSessions` sessions (the least recently used goes first), dropped with the
 * session or a server restart. Nothing here touches a database: a demo order is never a `guest_orders` row.
 */

const DEFAULT_CAP = 20;
const DEFAULT_MAX_SESSIONS = 200;

function createDemoOrders({ cap = DEFAULT_CAP, maxSessions = DEFAULT_MAX_SESSIONS } = {}) {
  // Map keeps insertion order: re-inserting a session on every use makes the first key the least recently used.
  const sessions = new Map();

  function bookOf(sessionId) {
    const key = Number(sessionId);
    const book = sessions.get(key) || { next: 1, orders: [] };
    sessions.delete(key);
    sessions.set(key, book);
    while (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value);
    return book;
  }

  return {
    /** → the order as stored: `order` plus its id, in this session's own numbering. */
    add(sessionId, order) {
      const book = bookOf(sessionId);
      const stored = { ...order, id: book.next, demo: true };
      book.next += 1;
      book.orders.push(stored);
      while (book.orders.length > cap) book.orders.shift();
      return stored;
    },

    /** The simulated order a replayed `Idempotency-Key` names, or null. */
    findByClientKey: (sessionId, key) => bookOf(sessionId).orders.find((o) => o.clientKey === key) || null,

    /** Newest first, like the real list. */
    list: (sessionId) => bookOf(sessionId).orders.slice().reverse(),

    find: (sessionId, id) => bookOf(sessionId).orders.find((o) => o.id === Number(id)) || null,

    /** → the order removed, or null. */
    remove(sessionId, id) {
      const book = bookOf(sessionId);
      const index = book.orders.findIndex((o) => o.id === Number(id));
      return index < 0 ? null : book.orders.splice(index, 1)[0];
    },

    drop: (sessionId) => sessions.delete(Number(sessionId)),

    dropMany: (sessionIds) => sessionIds.forEach((id) => sessions.delete(Number(id))),
  };
}

module.exports = { DEFAULT_CAP, createDemoOrders };
