/**
 * The simulated light commands of the demo sessions (specs/guest-app/guest-app-demo-mode.md rule 13): a tap is accepted, reads
 * `pending` for `settleMs`, then `done` with the switched state. Kept in memory, per session, bounded; the house is never called.
 */

const SETTLE_MS = 1000;
const MAX_COMMANDS = 50;
const MAX_SESSIONS = 200;

function createDemoCommands({ now = () => new Date(), settleMs = SETTLE_MS } = {}) {
  const sessions = new Map();

  function bookOf(sessionId) {
    const key = Number(sessionId);
    const book = sessions.get(key) || { next: 1, commands: [] };
    sessions.delete(key);
    sessions.set(key, book);
    while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    return book;
  }

  const stateOf = (command) => (now().getTime() - command.at >= settleMs ? 'done' : 'pending');
  const viewOf = (command) => ({ id: command.id, state: stateOf(command), value: command.value });

  return {
    queue(sessionId, { equipmentId, value }) {
      const book = bookOf(sessionId);
      const command = {
        id: `demo-${book.next}`, equipmentId, value, at: now().getTime(),
      };
      book.next += 1;
      book.commands.push(command);
      while (book.commands.length > MAX_COMMANDS) book.commands.shift();
      return viewOf(command);
    },

    read(sessionId, id) {
      const command = bookOf(sessionId).commands.find((c) => c.id === String(id));
      return command ? viewOf(command) : null;
    },

    /** The last settled value of each equipment this session switched: the page shows it instead of the house's reading. */
    settled(sessionId) {
      const last = new Map();
      bookOf(sessionId).commands.filter((c) => stateOf(c) === 'done').forEach((c) => last.set(c.equipmentId, c.value));
      return [...last].map(([equipmentId, value]) => ({ equipmentId, value }));
    },

    dropMany: (sessionIds) => sessionIds.forEach((id) => sessions.delete(Number(id))),
  };
}

module.exports = { SETTLE_MS, createDemoCommands };
