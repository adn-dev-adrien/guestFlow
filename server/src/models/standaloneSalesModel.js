/**
 * Standalone sales model — the database side of `utils/standaloneSale.js` (specs/pricing-components.md §3 rules 53, 74, 86;
 * the outside-visit spec §5). A sale with no reservation is a document of its own: a `standalone_sales` row, its frozen
 * `standalone_sale_lines`, its payments (`standalonePaymentsModel`) and the `payment_allocations` that tie them (documentRef
 * `standalone:<id>`, lineRef `line:standalone_sale_lines:<id>`). It prices nothing and decides no refusal other than the ones about a stored row.
 *
 *   passageClientId()                 the shared « Passage » client, created once (idempotent: one row carries `isPassage`)
 *   clientsByEmail(email)             the clients whose e-mail is exactly that one (case-insensitive, trimmed) — rule 8a
 *   createClient({ firstName, lastName, email })
 *   catalogueRow(articleRef)          `{ kind, row }` of `option:<id>` | `resource:<id>`, or null
 *   externalRates()                   `{ [vatClass]: rate }` the operator set for the external customer
 *   setExternalRate(vatClass, rate)
 *   insertSale(fields) / insertLine(saleId, fields) / updateSale(id, fields) / updateLine(id, fields) / bumpVersion(id)
 *   findSale(id) / linesOf(saleId) / findLine(saleId, lineId) / byOrigin(originRef)
 *   addHistory(saleId, text, actor) / historyOf(saleId)   the words of what was done on the document (outside-visit spec rule 23)
 *   documentRef(id) / lineRef(lineId)  the names the allocations use
 */
const database = () => require('../database');

const documentRef = (id) => `standalone:${Number(id)}`;
const lineRef = (lineId) => `line:standalone_sale_lines:${Number(lineId)}`;

const KINDS = { option: { table: 'options' }, resource: { table: 'resources' } };

function passageClientId() {
  const db = database();
  const row = db.prepare('SELECT id FROM clients WHERE isPassage = 1 ORDER BY id LIMIT 1').get();
  if (row) return row.id;
  const info = db.prepare("INSERT INTO clients (lastName, firstName, notes, isPassage) VALUES ('Passage', '', 'Client partagé des ventes sans nom (ventes hors séjour).', 1)").run();
  return Number(info.lastInsertRowid);
}

function clientsByEmail(email) {
  const wanted = String(email || '').trim().toLowerCase();
  if (!wanted) return [];
  return database().prepare("SELECT id, firstName, lastName, email FROM clients WHERE isPassage = 0 AND lower(trim(email)) = ? ORDER BY id").all(wanted);
}

function clientById(id) {
  return database().prepare('SELECT id, firstName, lastName, email, isPassage FROM clients WHERE id = ?').get(Number(id)) || null;
}

function createClient({ firstName = '', lastName, email = '' }) {
  const info = database().prepare('INSERT INTO clients (lastName, firstName, email) VALUES (?, ?, ?)').run(String(lastName), String(firstName || ''), String(email || ''));
  return Number(info.lastInsertRowid);
}

function catalogueRow(articleRef) {
  const match = /^(option|resource):([1-9]\d*)$/.exec(String(articleRef || ''));
  if (!match) return null;
  const row = database().prepare(`SELECT * FROM ${KINDS[match[1]].table} WHERE id = ?`).get(Number(match[2]));
  return row ? { kind: match[1], row } : null;
}

function externalRates() {
  const rates = {};
  for (const row of database().prepare('SELECT vatClass, rate FROM vat_external_rates').all()) rates[row.vatClass] = Number(row.rate);
  return rates;
}

function setExternalRate(vatClass, rate) {
  database().prepare('INSERT INTO vat_external_rates (vatClass, rate) VALUES (?, ?) ON CONFLICT(vatClass) DO UPDATE SET rate = excluded.rate').run(String(vatClass), Number(rate));
}

const COLUMNS = {
  sale: ['soldAt', 'clientId', 'customerName', 'customerEmail', 'totalCents', 'vatJson', 'status', 'settlementRef', 'originRef', 'createdBy', 'cancelledAt', 'noShowAt'],
  line: ['articleRef', 'kind', 'family', 'label', 'quantity', 'unitPrice', 'totalCents', 'catalogueCents', 'offered', 'discountCents', 'vatClass', 'vatRate', 'components', 'fulfilmentRef', 'soldAt', 'source', 'cancelledAt'],
};

function insert(table, parentColumn, parentId, columns, fields) {
  const names = [...(parentColumn ? [parentColumn] : []), ...columns.filter((c) => fields[c] !== undefined)];
  const values = [...(parentColumn ? [parentId] : []), ...columns.filter((c) => fields[c] !== undefined).map((c) => fields[c])];
  const info = database().prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...values);
  return Number(info.lastInsertRowid);
}

function update(table, columns, id, fields) {
  const names = columns.filter((c) => fields[c] !== undefined);
  if (!names.length) return;
  database().prepare(`UPDATE ${table} SET ${names.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...names.map((c) => fields[c]), Number(id));
}

const insertSale = (fields) => insert('standalone_sales', null, null, COLUMNS.sale, fields);
const updateSale = (id, fields) => update('standalone_sales', COLUMNS.sale, id, fields);

// The line number of a standalone line is its own row id (rule 79): stable, never reused.
function insertLine(saleId, fields) {
  const id = insert('standalone_sale_lines', 'saleId', saleId, COLUMNS.line, fields);
  database().prepare('UPDATE standalone_sale_lines SET lineId = id WHERE id = ?').run(id);
  return id;
}
const updateLine = (id, fields) => update('standalone_sale_lines', COLUMNS.line, id, fields);

const bumpVersion = (id) => database().prepare('UPDATE standalone_sales SET version = version + 1 WHERE id = ?').run(Number(id));

const findSale = (id) => database().prepare('SELECT * FROM standalone_sales WHERE id = ?').get(Number(id)) || null;
const linesOf = (saleId) => database().prepare('SELECT * FROM standalone_sale_lines WHERE saleId = ? ORDER BY id').all(Number(saleId));
const findLine = (saleId, lineId) => database().prepare('SELECT * FROM standalone_sale_lines WHERE saleId = ? AND id = ?').get(Number(saleId), Number(lineId)) || null;
function addHistory(saleId, text, actor = null) {
  database().prepare('INSERT INTO standalone_sale_history (saleId, at, text, actor) VALUES (?, ?, ?, ?)').run(Number(saleId), new Date().toISOString(), String(text), actor);
}
const historyOf = (saleId) => database().prepare('SELECT at, text, actor FROM standalone_sale_history WHERE saleId = ? ORDER BY id').all(Number(saleId));

const byOrigin = (originRef) => database().prepare('SELECT * FROM standalone_sales WHERE originRef = ? ORDER BY id').all(String(originRef));

module.exports = {
  documentRef, lineRef, passageClientId, clientsByEmail, clientById, createClient, catalogueRow, externalRates, setExternalRate,
  insertSale, updateSale, insertLine, updateLine, bumpVersion, findSale, linesOf, findLine, byOrigin, addHistory, historyOf,
};
