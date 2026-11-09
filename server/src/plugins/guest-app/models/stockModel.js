/**
 * The stock of the articles the app sells (specs/guest-app.md rules 37bis-37quater): one count per article for the
 * whole estate, what the reservations have already taken from it, and what the unpaid card orders hold.
 *
 *   `guest_app_items.stockQuantity`  what is left in the cellar now — set at a restock, then moved by the counts;
 *   `guest_app_stock_counts`         what each reservation has taken of each article: a later reading moves the
 *                                    stock by the difference only, so an event read twice moves nothing.
 *
 * A reservation takes its lines on its arrival day (and at once for a line written later, which can only happen
 * once the stay has started): before its start date, cancelled, superseded or deleted it takes nothing, so what it
 * had taken goes back. An app order is a line on the fiche like any other, counted in its commit's transaction.
 * Only tracked articles are counted. The breakfast and the hourly resources have no stock (rules 27bis, 28).
 *
 * A factory: the plugin builds it on `ctx.db`, tests on an in-memory database.
 */

const HOURLY = 'per_hour';
const BREAKFAST = 'breakfast';

const keyOf = (kind, id) => `${kind}:${Number(id)}`;

function parseLines(text) {
  try {
    const lines = JSON.parse(text);
    return Array.isArray(lines) ? lines : [];
  } catch {
    return [];
  }
}

/** The units of an order line on the stock: an option's or a non-hourly resource's quantity. */
function orderLineUnits(line) {
  if (!line || !['option', 'resource'].includes(line.kind)) return null;
  if (Array.isArray(line.sessions) && line.sessions.length) return null;
  const units = Number(line.quantity);
  return Number.isFinite(units) && units > 0 ? { key: keyOf(line.kind, line.id), units } : null;
}

function createStockModel(db) {
  const tracked = () => db.prepare('SELECT * FROM guest_app_items WHERE stockTracked = 1').all();
  const trackedRow = (kind, id) => db.prepare('SELECT * FROM guest_app_items WHERE kind = ? AND itemId = ? AND stockTracked = 1').get(kind, Number(id)) || null;
  // Rule 37bis — « En rupture » stops the app whatever the count says, even on an article whose stock is not followed.
  const limited = () => db.prepare('SELECT * FROM guest_app_items WHERE stockTracked = 1 OR soldOut = 1').all();
  const limitedRow = (kind, id) => db.prepare('SELECT * FROM guest_app_items WHERE kind = ? AND itemId = ? AND (stockTracked = 1 OR soldOut = 1)').get(kind, Number(id)) || null;

  /** Rule 37ter — the units every unpaid card order holds at `at`, by `kind:id`. */
  function heldByKey(at) {
    const held = new Map();
    db.prepare("SELECT linesJson FROM guest_orders WHERE status = 'awaiting_payment' AND heldUntil > ?").all(at.toISOString())
      .forEach((row) => parseLines(row.linesJson).forEach((line) => {
        const units = orderLineUnits(line);
        if (units) held.set(units.key, (held.get(units.key) || 0) + units.units);
      }));
    return held;
  }

  function stateOf(row, held) {
    const quantity = Number(row.stockQuantity || 0);
    const holding = held.get(keyOf(row.kind, row.itemId)) || 0;
    const left = quantity - holding;
    const soldOut = Number(row.soldOut) === 1;
    return {
      kind: row.kind,
      id: Number(row.itemId),
      quantity,
      held: holding,
      left,
      soldOut,
      out: soldOut || left <= 0,
      alertBelow: row.stockAlertBelow === null || row.stockAlertBelow === undefined ? null : Number(row.stockAlertBelow),
      setAt: row.stockSetAt || null,
      setBy: row.stockSetBy || null,
    };
  }

  /** Rule 37quater — a tracked or « En rupture » article's stock now, or null when nothing limits it. */
  function state(kind, id, at) {
    const row = limitedRow(kind, id);
    return row ? stateOf(row, heldByKey(at)) : null;
  }

  /** Every tracked or « En rupture » article's stock now, by `kind:id`. */
  function states(at) {
    const held = heldByKey(at);
    return new Map(limited().map((row) => [keyOf(row.kind, row.itemId), stateOf(row, held)]));
  }

  /**
   * Rule 37ter — what the reservation takes of each tracked article today: its lines once its start date is
   * reached, nothing for a stay to come, cancelled, superseded or deleted.
   */
  function targetFor(reservationId, today, keys) {
    const target = new Map();
    const stay = db.prepare('SELECT kind, startDate FROM reservations WHERE id = ?').get(Number(reservationId));
    if (!stay || stay.kind !== 'reservation' || String(stay.startDate) > today) return target;
    db.prepare(`
      SELECT ro.optionId AS id, SUM(ro.quantity) AS units FROM reservation_options ro
      JOIN options o ON o.id = ro.optionId
      WHERE ro.reservationId = ? AND COALESCE(o.autoOptionType, '') <> ? GROUP BY ro.optionId
    `).all(Number(reservationId), BREAKFAST).forEach((r) => {
      if (keys.has(keyOf('option', r.id))) target.set(keyOf('option', r.id), Math.max(0, Math.round(Number(r.units) || 0)));
    });
    db.prepare(`
      SELECT rr.resourceId AS id, SUM(rr.quantity) AS units FROM reservation_resources rr
      JOIN resources r ON r.id = rr.resourceId
      WHERE rr.reservationId = ? AND r.priceType <> ? GROUP BY rr.resourceId
    `).all(Number(reservationId), HOURLY).forEach((r) => {
      if (keys.has(keyOf('resource', r.id))) target.set(keyOf('resource', r.id), Math.max(0, Math.round(Number(r.units) || 0)));
    });
    return target;
  }

  const countsOf = (reservationId) => new Map(db.prepare('SELECT kind, itemId, quantity FROM guest_app_stock_counts WHERE reservationId = ?')
    .all(Number(reservationId)).map((r) => [keyOf(r.kind, r.itemId), Number(r.quantity)]));

  const writeCount = db.prepare(`
    INSERT INTO guest_app_stock_counts (reservationId, kind, itemId, quantity) VALUES (@reservationId, @kind, @itemId, @quantity)
    ON CONFLICT (reservationId, kind, itemId) DO UPDATE SET quantity = excluded.quantity
  `);
  const moveStock = db.prepare('UPDATE guest_app_items SET stockQuantity = COALESCE(stockQuantity, 0) - ? WHERE kind = ? AND itemId = ? AND stockTracked = 1');

  /**
   * Rule 37ter — the reservation's counts brought to what it takes today; the stock moves by the difference.
   * → the `kind:id` of the articles that moved. Idempotent: a second reading moves nothing.
   */
  function reconcile(reservationId, today) {
    return db.transaction(() => {
      const keys = new Set(tracked().map((row) => keyOf(row.kind, row.itemId)));
      if (!keys.size) return [];
      const target = targetFor(reservationId, today, keys);
      const counted = countsOf(reservationId);
      const moved = [];
      keys.forEach((key) => {
        const want = target.get(key) || 0;
        const had = counted.get(key) || 0;
        if (want === had) return;
        const [kind, id] = key.split(':');
        moveStock.run(want - had, kind, Number(id));
        writeCount.run({ reservationId: Number(reservationId), kind, itemId: Number(id), quantity: want });
        moved.push(key);
      });
      return moved;
    })();
  }

  /** Rule 37ter — the stays in progress today, read by the arrival sweep. */
  function staysInProgress(today) {
    return db.prepare("SELECT id FROM reservations WHERE kind = 'reservation' AND startDate <= ? AND endDate >= ?").all(today, today).map((r) => Number(r.id));
  }

  /** The reservations that have taken something, whatever they are now: a cancelled one gives it back. */
  function countedReservations() {
    return db.prepare('SELECT DISTINCT reservationId FROM guest_app_stock_counts WHERE quantity <> 0').all().map((r) => Number(r.reservationId));
  }

  /**
   * Rule 37bis — a restock: « En stock » is what the cellar holds now. What the reservations took before is already
   * out of it, so their counts are brought to date without moving the stock again; the low / out pushes are re-armed.
   */
  function restock(kind, id, { quantity, by, at, today }) {
    return db.transaction(() => {
      const key = keyOf(kind, id);
      const keys = new Set([key]);
      const reservations = new Set([
        ...db.prepare(kind === 'option'
          ? 'SELECT DISTINCT reservationId AS id FROM reservation_options WHERE optionId = ?'
          : 'SELECT DISTINCT reservationId AS id FROM reservation_resources WHERE resourceId = ?').all(Number(id)).map((r) => Number(r.id)),
        ...db.prepare('SELECT reservationId AS id FROM guest_app_stock_counts WHERE kind = ? AND itemId = ?').all(kind, Number(id)).map((r) => Number(r.id)),
      ]);
      reservations.forEach((reservationId) => {
        writeCount.run({ reservationId, kind, itemId: Number(id), quantity: targetFor(reservationId, today, keys).get(key) || 0 });
      });
      db.prepare(`
        UPDATE guest_app_items SET stockQuantity = ?, stockSetAt = ?, stockSetBy = ?, stockLowPushedAt = NULL, stockOutPushedAt = NULL
         WHERE kind = ? AND itemId = ?
      `).run(Number(quantity), at.toISOString(), by || null, kind, Number(id));
    })();
  }

  /**
   * Rule 37quater — the pushes now due on these articles: « Stock bas » once the threshold is reached, « épuisé »
   * once nothing is left, each once until the next restock. Marked sent here. → [{ key, kind: 'low' | 'out', left }]
   */
  function alertsDue(keys, at) {
    if (!keys.length) return [];
    const held = heldByKey(at);
    const due = [];
    keys.forEach((key) => {
      const [kind, id] = key.split(':');
      const row = trackedRow(kind, id);
      if (!row) return;
      const { left, alertBelow } = stateOf(row, held);
      if (left <= 0 && !row.stockOutPushedAt) {
        db.prepare('UPDATE guest_app_items SET stockOutPushedAt = ?, stockLowPushedAt = COALESCE(stockLowPushedAt, ?) WHERE kind = ? AND itemId = ?')
          .run(at.toISOString(), at.toISOString(), kind, Number(id));
        due.push({ key, kind: 'out', left });
      } else if (left > 0 && alertBelow !== null && left <= alertBelow && !row.stockLowPushedAt) {
        db.prepare('UPDATE guest_app_items SET stockLowPushedAt = ? WHERE kind = ? AND itemId = ?').run(at.toISOString(), kind, Number(id));
        due.push({ key, kind: 'low', left });
      }
    });
    return due;
  }

  /** The units an order's lines take of the tracked articles, by `kind:id`. */
  function unitsOfLines(lines) {
    const units = new Map();
    (lines || []).forEach((line) => {
      const u = orderLineUnits(line);
      if (u) units.set(u.key, (units.get(u.key) || 0) + u.units);
    });
    return units;
  }

  return {
    alertsDue, countedReservations, reconcile, restock, state, states, staysInProgress, unitsOfLines,
  };
}

module.exports = createStockModel;
module.exports.keyOf = keyOf;
