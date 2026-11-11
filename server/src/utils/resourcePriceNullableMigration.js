/**
 * `property_resource_prices.price` may be NULL (specs/options-resources-ux.md rule 28): a property line
 * that only carries a free first hour has no price of its own and inherits the resource's base price.
 * The column was declared `NOT NULL DEFAULT 0`; SQLite cannot relax that in place, so the table is
 * rebuilt (create new, copy every row and value, swap) inside one transaction.
 *
 * Existing rows are copied untouched. A row stored as `price 0, freeMinutes 60` may mean « blank price »
 * (saved by the former form) or « free there »: the data cannot tell, so nothing is guessed.
 *
 * The index of the baseline (`idx_property_resource_prices_resource`) goes with the dropped table and is
 * created again, so a second boot changes nothing in the schema.
 *
 * Idempotent: a table whose `price` already accepts NULL is left alone. Returns the number of rows
 * carried over, or `null` when there was nothing to do.
 */

const DDL = `
  CREATE TABLE property_resource_prices__new (
    propertyId INTEGER NOT NULL,
    resourceId INTEGER NOT NULL,
    price REAL,
    freeMinutes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (propertyId, resourceId),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE
  )`;

function priceIsNotNull(db) {
  const column = db.prepare('PRAGMA table_info(property_resource_prices)').all().find((c) => c.name === 'price');
  return Boolean(column) && Number(column.notnull) === 1;
}

function makeResourcePriceNullable(db) {
  if (!priceIsNotNull(db)) return null;
  let copied = 0;
  db.transaction(() => {
    db.exec(DDL);
    copied = db.prepare(`
      INSERT INTO property_resource_prices__new (propertyId, resourceId, price, freeMinutes)
      SELECT propertyId, resourceId, price, freeMinutes FROM property_resource_prices
    `).run().changes;
    db.exec('DROP TABLE property_resource_prices');
    db.exec('ALTER TABLE property_resource_prices__new RENAME TO property_resource_prices');
    db.exec('CREATE INDEX IF NOT EXISTS idx_property_resource_prices_resource ON property_resource_prices(resourceId)');
  })();
  return copied;
}

module.exports = { makeResourcePriceNullable, priceIsNotNull };
