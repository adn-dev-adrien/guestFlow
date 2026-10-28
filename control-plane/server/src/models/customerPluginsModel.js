/**
 * The operator's choice of modules per customer, the erase orders, and the seed marker
 * (specs/plugin-operator-provisioning.md §5).
 */

function buildCustomerPluginsModel(db) {
  const chosenStmt = db.prepare('SELECT pluginId FROM customer_plugins WHERE customerId = ? ORDER BY pluginId');
  const insertStmt = db.prepare('INSERT OR IGNORE INTO customer_plugins (customerId, pluginId, since, operator) VALUES (?, ?, ?, ?)');
  const deleteStmt = db.prepare('DELETE FROM customer_plugins WHERE customerId = ? AND pluginId = ?');
  const seededStmt = db.prepare('UPDATE customers SET pluginsSeededAt = ? WHERE id = ?');
  const unseededStmt = db.prepare('SELECT id FROM customers WHERE pluginsSeededAt IS NULL AND erasedAt IS NULL AND archivedAt IS NULL');
  const insertOrderStmt = db.prepare('INSERT INTO customer_erase_orders (orderId, customerId, pluginId, createdAt, operator) VALUES (?, ?, ?, ?, ?)');
  const pendingStmt = db.prepare('SELECT orderId, pluginId, createdAt FROM customer_erase_orders WHERE customerId = ? AND acknowledgedAt IS NULL ORDER BY createdAt, orderId');
  const orderStmt = db.prepare('SELECT orderId, customerId, pluginId FROM customer_erase_orders WHERE orderId = ?');
  const withOrdersStmt = db.prepare('SELECT DISTINCT customerId FROM customer_erase_orders WHERE acknowledgedAt IS NULL');
  const cancelStmt = db.prepare('UPDATE customer_erase_orders SET acknowledgedAt = ? WHERE customerId = ? AND pluginId = ? AND acknowledgedAt IS NULL');
  const ackStmt = db.prepare('UPDATE customer_erase_orders SET acknowledgedAt = ? WHERE orderId = ? AND acknowledgedAt IS NULL');

  return {
    chosen: (customerId) => chosenStmt.all(customerId).map((r) => r.pluginId),
    add: (customerId, pluginId, since, operator) => insertStmt.run(customerId, pluginId, since, operator),
    remove: (customerId, pluginId) => deleteStmt.run(customerId, pluginId),
    // Seeds or replaces the whole choice in one transaction.
    replace(customerId, ids, since, operator) {
      db.transaction(() => {
        chosenStmt.all(customerId).forEach((r) => deleteStmt.run(customerId, r.pluginId));
        ids.forEach((id) => insertStmt.run(customerId, id, since, operator));
      })();
    },
    markSeeded: (customerId, at) => seededStmt.run(at, customerId),
    unseededIds: () => unseededStmt.all().map((r) => r.id),
    addOrder: (order) => insertOrderStmt.run(order.orderId, order.customerId, order.pluginId, order.createdAt, order.operator),
    pendingOrders: (customerId) => pendingStmt.all(customerId),
    customersWithPendingOrders: () => withOrdersStmt.all().map((r) => r.customerId),
    orderOf: (orderId) => orderStmt.get(orderId) || null,
    cancelOrdersOf: (customerId, pluginId, at) => cancelStmt.run(at, customerId, pluginId).changes,
    acknowledge: (orderId, at) => ackStmt.run(at, orderId).changes > 0,
  };
}

module.exports = { buildCustomerPluginsModel };
