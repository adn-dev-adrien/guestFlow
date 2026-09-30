/**
 * Customers, their billing identity, their subscription, their add-ons and their grandfathered
 * plugins (rules 4, 5, 7, 20).
 */

function buildCustomersModel(db) {
  const insertCustomerStmt = db.prepare(`INSERT INTO customers (slug, companyName, contactName, contactEmail, state, stateSince, createdAt,
    billingStreet, billingPostcode, billingCity, billingCountry, vatNumber)
    VALUES (@slug, @companyName, @contactName, @contactEmail, @state, @stateSince, @createdAt,
    @billingStreet, @billingPostcode, @billingCity, @billingCountry, @vatNumber)`);
  const insertSubStmt = db.prepare(`INSERT INTO subscriptions (customerId, planCode, billing, periodMonths, startsAt, endsAt, trialEndsAt, catalogueVersion)
    VALUES (@customerId, @planCode, @billing, @periodMonths, @startsAt, @endsAt, @trialEndsAt, @catalogueVersion)`);
  const insertAddonStmt = db.prepare('INSERT OR IGNORE INTO customer_addons (customerId, pluginId, since) VALUES (?, ?, ?)');
  const clearAddonsStmt = db.prepare('DELETE FROM customer_addons WHERE customerId = ?');
  const getStmt = db.prepare(`SELECT c.*, s.planCode, s.billing, s.periodMonths, s.startsAt, s.endsAt, s.trialEndsAt,
    s.forceActiveUntil, s.catalogueVersion FROM customers c JOIN subscriptions s ON s.customerId = c.id WHERE c.id = ?`);
  const listStmt = db.prepare(`SELECT c.*, s.planCode, s.billing, s.periodMonths, s.startsAt, s.endsAt, s.trialEndsAt,
    s.forceActiveUntil, s.catalogueVersion FROM customers c JOIN subscriptions s ON s.customerId = c.id
    WHERE c.erasedAt IS NULL ORDER BY c.companyName COLLATE NOCASE`);
  const slugTakenStmt = db.prepare('SELECT 1 FROM customers WHERE slug = ? AND erasedAt IS NULL');
  const addonsStmt = db.prepare('SELECT pluginId FROM customer_addons WHERE customerId = ? ORDER BY pluginId');
  const grandfatheredStmt = db.prepare('SELECT pluginId FROM grandfathered_plugins WHERE customerId = ? ORDER BY pluginId');
  const insertGrandfatheredStmt = db.prepare('INSERT OR IGNORE INTO grandfathered_plugins (customerId, pluginId, since) VALUES (?, ?, ?)');
  const clearGrandfatheredStmt = db.prepare('DELETE FROM grandfathered_plugins WHERE customerId = ?');
  const setStateStmt = db.prepare('UPDATE customers SET state = ?, stateSince = ? WHERE id = ?');
  const setEndsAtStmt = db.prepare('UPDATE subscriptions SET endsAt = ? WHERE customerId = ?');
  const setForceStmt = db.prepare('UPDATE subscriptions SET forceActiveUntil = ? WHERE customerId = ?');
  const setPlanStmt = db.prepare('UPDATE subscriptions SET planCode = ?, billing = ?, periodMonths = ?, catalogueVersion = ? WHERE customerId = ?');
  const archiveStmt = db.prepare('UPDATE customers SET archivedAt = ?, eraseAt = ? WHERE id = ?');
  const unarchiveStmt = db.prepare('UPDATE customers SET archivedAt = NULL, eraseAt = NULL WHERE id = ?');
  const setEraseAtStmt = db.prepare('UPDATE customers SET eraseAt = ? WHERE id = ?');
  const erasedStmt = db.prepare('UPDATE customers SET erasedAt = ?, eraseAt = NULL WHERE id = ?');
  const setBillingStmt = db.prepare(`UPDATE customers SET billingStreet = @billingStreet, billingPostcode = @billingPostcode,
    billingCity = @billingCity, billingCountry = @billingCountry, vatNumber = @vatNumber, qontoClientId = NULL WHERE id = @id`);
  const setQontoClientStmt = db.prepare('UPDATE customers SET qontoClientId = ? WHERE id = ?');
  const setSlugStmt = db.prepare('UPDATE customers SET slug = ? WHERE id = ?');
  const bySlugStmt = db.prepare('SELECT id FROM customers WHERE slug = ? AND erasedAt IS NULL');
  const dueErasureStmt = db.prepare('SELECT id FROM customers WHERE archivedAt IS NOT NULL AND erasedAt IS NULL AND eraseAt IS NOT NULL AND eraseAt <= ?');

  const withLists = (row) => row && ({
    ...row,
    addons: addonsStmt.all(row.id).map((r) => r.pluginId),
    grandfathered: grandfatheredStmt.all(row.id).map((r) => r.pluginId),
  });

  return {
    create({ customer, subscription, addons, since }) {
      return db.transaction(() => {
        const id = Number(insertCustomerStmt.run({
          billingStreet: '', billingPostcode: '', billingCity: '', billingCountry: 'FR', vatNumber: '', ...customer,
        }).lastInsertRowid);
        insertSubStmt.run({ ...subscription, customerId: id });
        for (const a of addons) insertAddonStmt.run(id, a, since);
        return id;
      })();
    },
    get: (id) => withLists(getStmt.get(Number(id))),
    list: () => listStmt.all().map(withLists),
    slugTaken: (slug) => Boolean(slugTakenStmt.get(slug)),
    setState: (id, state, since) => setStateStmt.run(state, since, id),
    setEndsAt: (id, endsAt) => setEndsAtStmt.run(endsAt, id),
    setForceActiveUntil: (id, day) => setForceStmt.run(day, id),
    // Rule 5: a plan change withdraws what was only kept as grandfathered.
    changePlan({ id, planCode, billing, periodMonths, catalogueVersion, addons, since }) {
      db.transaction(() => {
        setPlanStmt.run(planCode, billing, periodMonths, catalogueVersion, id);
        clearGrandfatheredStmt.run(id);
        clearAddonsStmt.run(id);
        for (const a of addons) insertAddonStmt.run(id, a, since);
      })();
    },
    // A changed billing identity forgets the Qonto client, so the next invoice goes to one created
    // from the new address (rule 7).
    setBilling: (id, billing) => setBillingStmt.run({ ...billing, id }),
    setQontoClientId: (id, clientId) => setQontoClientStmt.run(clientId, id),
    setSlug: (id, slug) => setSlugStmt.run(slug, id),
    idOfSlug: (slug) => (bySlugStmt.get(slug) || {}).id || null,
    addGrandfathered: (id, pluginId, since) => insertGrandfatheredStmt.run(id, pluginId, since),
    archive: (id, at, eraseAt) => archiveStmt.run(at, eraseAt, id),
    unarchive: (id) => unarchiveStmt.run(id),
    setEraseAt: (id, day) => setEraseAtStmt.run(day, id),
    markErased: (id, at) => erasedStmt.run(at, id),
    dueForErasure: (today) => dueErasureStmt.all(today).map((r) => r.id),
  };
}

module.exports = { buildCustomersModel };
