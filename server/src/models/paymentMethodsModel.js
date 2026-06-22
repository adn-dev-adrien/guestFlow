/**
 * Payment-methods model — CRUD on the direct-reservation payment-method catalogue.
 *
 * The `payment_methods` table holds the operator-managed list of means of payment for DIRECT
 * reservations (Virement, Espèces, Chèque, Carte bancaire, …). Each row carries a commission rate
 * (%) the processor retains, plus an optional commission account + VAT flag (mirroring the
 * `platforms` commission config). Invariants enforced here:
 *   - exactly one row is the default (`isDefault = 1`);
 *   - a method referenced by a reservation is DEACTIVATED (`isActive = 0`), never hard-deleted, so
 *     historical snapshots keep resolving;
 *   - the default method can be neither deactivated nor deleted.
 *
 * Spec: specs/direct-payment-method-commission.md §3.1.
 *
 * Factory `create(db)` (+ a default bound to the production DB), mirroring the other models.
 */

const db = require('../database');

const MAX_PERCENT = 99.99;

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_PERCENT, n));
}

function normalizeAccount(value) {
  return value == null || String(value).trim() === '' ? null : String(value).trim();
}

function toBool01(value) {
  return value === true || Number(value) === 1 ? 1 : 0;
}

function createPaymentMethodsModel(database) {
  const SELECT = `
    SELECT id, name, COALESCE(commissionPercent, 0) AS commissionPercent,
           commissionAccountNumber, hasVatOnCommission, isDefault, isActive, sortOrder
      FROM payment_methods
  `;
  const stmts = {
    listAll: database.prepare(`${SELECT} ORDER BY isActive DESC, sortOrder ASC, name COLLATE NOCASE ASC`),
    listActive: database.prepare(`${SELECT} WHERE isActive = 1 ORDER BY sortOrder ASC, name COLLATE NOCASE ASC`),
    findById: database.prepare(`${SELECT} WHERE id = ?`),
    findByName: database.prepare(`${SELECT} WHERE name = ? COLLATE NOCASE`),
    insert: database.prepare(`
      INSERT INTO payment_methods (name, commissionPercent, commissionAccountNumber, hasVatOnCommission, isDefault, isActive, sortOrder)
      VALUES (@name, @commissionPercent, @commissionAccountNumber, @hasVatOnCommission, @isDefault, 1, @sortOrder)
    `),
    update: database.prepare(`
      UPDATE payment_methods
         SET name = @name,
             commissionPercent = @commissionPercent,
             commissionAccountNumber = @commissionAccountNumber,
             hasVatOnCommission = @hasVatOnCommission
       WHERE id = @id
    `),
    clearDefault: database.prepare('UPDATE payment_methods SET isDefault = 0'),
    setDefault: database.prepare('UPDATE payment_methods SET isDefault = 1, isActive = 1 WHERE id = ?'),
    setActive: database.prepare('UPDATE payment_methods SET isActive = ? WHERE id = ?'),
    deleteById: database.prepare('DELETE FROM payment_methods WHERE id = ?'),
    maxSort: database.prepare('SELECT COALESCE(MAX(sortOrder), -1) AS m FROM payment_methods'),
    referencingCount: database.prepare(`
      SELECT COUNT(*) AS c FROM reservations
       WHERE depositPaymentMethodId = ? OR balancePaymentMethodId = ? OR complementPaymentMethodId = ?
    `),
  };

  function isReferenced(id) {
    return stmts.referencingCount.get(Number(id), Number(id), Number(id)).c > 0;
  }

  // Promote a fallback default when none is currently flagged (e.g. after deactivating the default
  // via raw SQL). Picks the first active row by sortOrder. No-op when a default already exists.
  function ensureDefault() {
    const hasDefault = database.prepare('SELECT 1 FROM payment_methods WHERE isDefault = 1 LIMIT 1').get();
    if (hasDefault) return;
    const fallback = stmts.listActive.all()[0];
    if (fallback) stmts.setDefault.run(fallback.id);
  }

  // Promote `id` to the sole default. Sequential (not wrapped in database.transaction) so the model
  // constructs cleanly against the lightweight DB mocks used in the controller unit tests.
  function applyDefault(id) {
    stmts.clearDefault.run();
    stmts.setDefault.run(Number(id));
  }

  return {
    listAll() {
      return stmts.listAll.all();
    },
    listActive() {
      return stmts.listActive.all();
    },
    findById(id) {
      if (id == null || id === '') return null;
      return stmts.findById.get(Number(id)) || null;
    },
    findByName(name) {
      if (name == null || name === '') return null;
      return stmts.findByName.get(String(name).trim()) || null;
    },
    // The default method row (isDefault = 1) → fallback to the first active row → null on empty table.
    getDefault() {
      return database.prepare(`${SELECT} WHERE isDefault = 1 LIMIT 1`).get()
        || stmts.listActive.all()[0]
        || null;
    },
    getDefaultId() {
      const d = this.getDefault();
      return d ? d.id : null;
    },

    // Engine-facing rate map: { id → { rate, account, hasVat } } over ALL methods (incl. inactive) so
    // a reservation referencing a now-deactivated method still resolves its commission.
    rateMap() {
      const map = {};
      for (const m of stmts.listAll.all()) {
        map[m.id] = {
          rate: Number(m.commissionPercent) || 0,
          account: m.commissionAccountNumber || null,
          hasVat: Number(m.hasVatOnCommission) === 1,
        };
      }
      return map;
    },

    create({ name, commissionPercent, commissionAccountNumber, hasVatOnCommission, isDefault }) {
      const clean = String(name == null ? '' : name).trim();
      if (!clean) throw new Error('NAME_REQUIRED');
      if (stmts.findByName.get(clean)) throw new Error('NAME_TAKEN');
      const sortOrder = stmts.maxSort.get().m + 1;
      const info = stmts.insert.run({
        name: clean,
        commissionPercent: clampPercent(commissionPercent),
        commissionAccountNumber: normalizeAccount(commissionAccountNumber),
        hasVatOnCommission: toBool01(hasVatOnCommission),
        isDefault: 0,
        sortOrder,
      });
      if (toBool01(isDefault) === 1) applyDefault(info.lastInsertRowid);
      ensureDefault();
      return stmts.findById.get(info.lastInsertRowid);
    },

    update(id, { name, commissionPercent, commissionAccountNumber, hasVatOnCommission, isDefault }) {
      const row = stmts.findById.get(Number(id));
      if (!row) return null;
      const clean = name == null ? row.name : String(name).trim();
      if (!clean) throw new Error('NAME_REQUIRED');
      const clash = stmts.findByName.get(clean);
      if (clash && clash.id !== row.id) throw new Error('NAME_TAKEN');
      stmts.update.run({
        id: row.id,
        name: clean,
        commissionPercent: commissionPercent === undefined ? row.commissionPercent : clampPercent(commissionPercent),
        commissionAccountNumber: commissionAccountNumber === undefined
          ? row.commissionAccountNumber
          : normalizeAccount(commissionAccountNumber),
        hasVatOnCommission: hasVatOnCommission === undefined ? row.hasVatOnCommission : toBool01(hasVatOnCommission),
      });
      if (isDefault !== undefined && toBool01(isDefault) === 1) applyDefault(row.id);
      ensureDefault();
      return stmts.findById.get(row.id);
    },

    // Promote a method to default (clears the previous default). Reactivates it if it was inactive.
    setDefault(id) {
      const row = stmts.findById.get(Number(id));
      if (!row) return null;
      applyDefault(row.id);
      return stmts.findById.get(row.id);
    },

    // Set active/inactive. The default method cannot be deactivated (would leave no default).
    setActive(id, active) {
      const row = stmts.findById.get(Number(id));
      if (!row) return null;
      const next = toBool01(active);
      if (next === 0 && Number(row.isDefault) === 1) throw new Error('DEFAULT_NOT_DEACTIVATABLE');
      stmts.setActive.run(next, row.id);
      return stmts.findById.get(row.id);
    },

    // Hard-delete an unused, non-default method; deactivate it instead when referenced by a reservation.
    // Returns { deleted } | { deactivated } | null (unknown id). Throws on the default method.
    remove(id) {
      const row = stmts.findById.get(Number(id));
      if (!row) return null;
      if (Number(row.isDefault) === 1) throw new Error('DEFAULT_NOT_DELETABLE');
      if (isReferenced(row.id)) {
        stmts.setActive.run(0, row.id);
        return { deactivated: true, method: stmts.findById.get(row.id) };
      }
      stmts.deleteById.run(row.id);
      return { deleted: true };
    },
  };
}

const defaultModel = createPaymentMethodsModel(db);
defaultModel.buildModel = createPaymentMethodsModel;

module.exports = defaultModel;
