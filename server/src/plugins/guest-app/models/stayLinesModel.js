/**
 * What the shop needs to know of a stay to sell to it (specs/guest-app.md rules 25, 27): its channel and
 * the free units it was granted, the extras it already carries, and the end-of-stay complement state that
 * closes the mid-stay window, and the lines the app's orders sold. Read on the server only: none of it reaches a guest payload (rule 8).
 */

function parseJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function createStayLinesModel(db) {
  return {
    ofStay(reservationId) {
      const id = Number(reservationId);
      const row = db.prepare(`
        SELECT id, kind, startDate, platform, tariffSnapshot, endOfStayComplementPaid, endOfStayComplementPaidCash
        FROM reservations WHERE id = ?
      `).get(id);
      if (!row) return null;
      const snapshot = parseJson(row.tariffSnapshot, null);
      const granted = snapshot && snapshot.grantedFreeUnitsByOption;
      return {
        window: {
          kind: row.kind,
          startDate: row.startDate,
          endOfStayComplementPaid: row.endOfStayComplementPaid,
          endOfStayComplementPaidCash: row.endOfStayComplementPaidCash,
        },
        platform: row.platform,
        grantedFreeUnitsByOption: granted && typeof granted === 'object' && !Array.isArray(granted) ? granted : null,
        optionLines: db.prepare('SELECT optionId, quantity, billedUnits, offered, cardOccurrences FROM reservation_options WHERE reservationId = ?').all(id)
          .map((line) => ({ ...line, cardOccurrences: parseJson(line.cardOccurrences, []) })),
        resourceLines: db.prepare('SELECT resourceId, quantity, sessions FROM reservation_resources WHERE reservationId = ?').all(id)
          .map((line) => ({ ...line, sessions: parseJson(line.sessions, []) })),
      };
    },

    /**
     * Rule 87 — the stored lines an order of this plugin sold (`orderRef = order:<id>:<n>`, pricing-components rule 13): which line of the fiche
     * each of its articles became, `{ orderId, kind, articleId, lineId, ref }`, the order's own lines first. A breakfast merged into the stay's
     * own line has none.
     */
    orderLines(reservationId) {
      const id = Number(reservationId);
      const read = (table, column, kind) => db.prepare(`SELECT lineId, ${column} AS articleId, orderRef FROM ${table} WHERE reservationId = ? AND orderRef LIKE 'order:%'`).all(id)
        .map((row) => ({
          orderId: Number(/^order:(\d+)/.exec(row.orderRef)[1]), kind, articleId: Number(row.articleId), lineId: Number(row.lineId), orderRef: row.orderRef, ref: `${kind}:${row.lineId}`,
        }));
      return [...read('reservation_options', 'optionId', 'option'), ...read('reservation_resources', 'resourceId', 'resource')].sort((a, b) => a.lineId - b.lineId);
    },
  };
}

module.exports = createStayLinesModel;
