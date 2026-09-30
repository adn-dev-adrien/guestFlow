/**
 * The console's journal (rule 6, 19, 20): every catalogue change, state transition, override and
 * deprovisioning, with who did it and a French sentence ready for the customer's history. Overrides
 * also keep their reason in their own table.
 */

function buildAuditModel(db) {
  const insertStmt = db.prepare('INSERT INTO audit (at, day, operator, customerId, kind, text) VALUES (@at, @day, @operator, @customerId, @kind, @text)');
  const forCustomerStmt = db.prepare('SELECT at, day, operator, kind, text FROM audit WHERE customerId = ? ORDER BY id DESC');
  const onDayStmt = db.prepare('SELECT * FROM audit WHERE day = ? AND kind = ? ORDER BY id');
  const insertOverrideStmt = db.prepare('INSERT INTO overrides (customerId, kind, reason, operator, at) VALUES (?, ?, ?, ?, ?)');
  const overridesStmt = db.prepare('SELECT * FROM overrides WHERE customerId = ? ORDER BY id DESC');
  return {
    log: (entry) => insertStmt.run({ customerId: null, ...entry }),
    forCustomer: (customerId) => forCustomerStmt.all(customerId),
    onDay: (day, kind) => onDayStmt.all(day, kind),
    override: ({ customerId, kind, reason, operator, at }) => insertOverrideStmt.run(customerId, kind, reason, operator, at),
    overrides: (customerId) => overridesStmt.all(customerId),
  };
}

module.exports = { buildAuditModel };
