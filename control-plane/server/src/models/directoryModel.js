/**
 * The directory (rule 26): `(emailHmac, customerId)` pairs, replaced as a whole for one customer at
 * each read of its instance; never an email in clear. And the old slugs of renamed customers, kept
 * reserved and redirected for 12 months (rule 22).
 */

function buildDirectoryModel(db) {
  const clearStmt = db.prepare('DELETE FROM directory WHERE customerId = ?');
  const insertStmt = db.prepare('INSERT OR IGNORE INTO directory (emailHmac, customerId, seenAt) VALUES (?, ?, ?)');
  const lookupStmt = db.prepare('SELECT customerId FROM directory WHERE emailHmac = ? ORDER BY customerId');
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM directory WHERE customerId = ?');
  const addAliasStmt = db.prepare('INSERT INTO slug_aliases (slug, customerId, until) VALUES (?, ?, ?) ON CONFLICT (slug) DO UPDATE SET customerId = excluded.customerId, until = excluded.until');
  const aliasStmt = db.prepare('SELECT * FROM slug_aliases WHERE slug = ? AND until >= ?');
  const aliasesOfStmt = db.prepare('SELECT * FROM slug_aliases WHERE customerId = ? AND until >= ? ORDER BY until DESC');
  const dropAliasesStmt = db.prepare('DELETE FROM slug_aliases WHERE customerId = ?');

  return {
    replace: db.transaction((customerId, hmacs, at) => {
      clearStmt.run(customerId);
      for (const h of hmacs) insertStmt.run(h, customerId, at);
    }),
    customersOf: (hmac) => lookupStmt.all(hmac).map((r) => r.customerId),
    count: (customerId) => countStmt.get(customerId).n,
    removeCustomer: (customerId) => { clearStmt.run(customerId); dropAliasesStmt.run(customerId); },

    addAlias: (slug, customerId, until) => addAliasStmt.run(slug, customerId, until),
    // An old slug is reserved while its date has not passed.
    aliasTaken: (slug, today) => Boolean(aliasStmt.get(slug, today)),
    aliasesOf: (customerId, today) => aliasesOfStmt.all(customerId, today),
  };
}

module.exports = { buildDirectoryModel };
