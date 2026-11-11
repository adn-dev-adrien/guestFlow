/**
 * The email templates and their mode, and every email a customer was sent or is waiting to be sent
 * (specs/control-plane-plans-and-access.md rules 17, 33).
 *
 * A `reminders` row is created once per invoice and scheduled kind (unique index), with its text
 * frozen when it is prepared: what the operator approves is what leaves.
 */

function buildEmailsModel(db) {
  const templatesStmt = db.prepare('SELECT * FROM email_templates');
  const templateStmt = db.prepare('SELECT * FROM email_templates WHERE key = ?');
  const saveTemplateStmt = db.prepare('UPDATE email_templates SET subject = ?, body = ?, sendMode = ?, updatedAt = ?, updatedBy = ? WHERE key = ?');
  const insertStmt = db.prepare(`INSERT INTO reminders (customerId, invoiceId, kind, status, recipient, subject, body, preparedAt, handledAt, operator, error)
    VALUES (@customerId, @invoiceId, @kind, @status, @recipient, @subject, @body, @preparedAt, @handledAt, @operator, @error)`);
  const getStmt = db.prepare('SELECT * FROM reminders WHERE id = ?');
  const existsStmt = db.prepare('SELECT 1 FROM reminders WHERE invoiceId = ? AND kind = ?');
  const forCustomerStmt = db.prepare('SELECT * FROM reminders WHERE customerId = ? ORDER BY id DESC');
  const pendingStmt = db.prepare("SELECT * FROM reminders WHERE status = 'pending' ORDER BY id");
  const pendingOfInvoiceStmt = db.prepare("SELECT * FROM reminders WHERE invoiceId = ? AND status = 'pending'");
  const handleStmt = db.prepare("UPDATE reminders SET status = @status, handledAt = @handledAt, operator = @operator, error = @error WHERE id = @id AND status = 'pending'");
  const finishStmt = db.prepare('UPDATE reminders SET status = @status, handledAt = @handledAt, operator = @operator, error = @error WHERE id = @id');

  return {
    templates: () => templatesStmt.all(),
    template: (key) => templateStmt.get(key),
    saveTemplate: ({ key, subject, body, sendMode, at, operator }) => saveTemplateStmt.run(subject, body, sendMode, at, operator, key),

    insert: (row) => Number(insertStmt.run({ handledAt: null, operator: null, error: null, ...row }).lastInsertRowid),
    get: (id) => getStmt.get(Number(id)),
    exists: (invoiceId, kind) => Boolean(existsStmt.get(invoiceId, kind)),
    forCustomer: (customerId) => forCustomerStmt.all(customerId),
    pending: () => pendingStmt.all(),
    pendingOfInvoice: (invoiceId) => pendingOfInvoiceStmt.all(invoiceId),
    // Moves a pending email to its outcome; false when someone else handled it first.
    handle: ({ id, status, at, operator = null, error = null }) => handleStmt.run({ id, status, handledAt: at, operator, error }).changes === 1,
    finish: ({ id, status, at, operator = null, error = null }) => finishStmt.run({ id, status, handledAt: at, operator, error }),
  };
}

module.exports = { buildEmailsModel };
