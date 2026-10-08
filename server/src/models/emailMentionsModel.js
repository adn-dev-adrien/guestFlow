/**
 * Email mentions model — sole DB access for `email_mentions`, `email_mention_options` and
 * `app_settings.bookedConfirmationOrder` (specs/plugins-phase-p-productisation.md §3.B).
 *
 * The confirmation order is a JSON array of `mention:<id>`, `babyBed` and `towels` (rule 9).
 *
 * API: buildModel(db) → { list(), find(id), create(m), update(id, m), remove(id), reorder(ids),
 *      confirmationOrder(), setConfirmationOrder(items) }
 */

const FIELDS = ['section', 'offerFr', 'offerEn', 'bookedFr', 'bookedEn', 'priceSource', 'priceOptionId'];

function buildModel(database) {
  const listStmt = database.prepare('SELECT * FROM email_mentions ORDER BY sortOrder, id');
  const findStmt = database.prepare('SELECT * FROM email_mentions WHERE id = ?');
  const optionsStmt = database.prepare('SELECT mentionId, optionId FROM email_mention_options ORDER BY optionId');
  const optionsOf = database.prepare('SELECT optionId FROM email_mention_options WHERE mentionId = ? ORDER BY optionId');
  const insertStmt = database.prepare(`
    INSERT INTO email_mentions (section, offerFr, offerEn, bookedFr, bookedEn, priceSource, priceOptionId, sortOrder)
    VALUES (@section, @offerFr, @offerEn, @bookedFr, @bookedEn, @priceSource, @priceOptionId,
            (SELECT COALESCE(MAX(sortOrder), 0) + 1 FROM email_mentions))
  `);
  const updateStmt = database.prepare(`
    UPDATE email_mentions SET section = @section, offerFr = @offerFr, offerEn = @offerEn, bookedFr = @bookedFr,
      bookedEn = @bookedEn, priceSource = @priceSource, priceOptionId = @priceOptionId WHERE id = @id
  `);
  const deleteStmt = database.prepare('DELETE FROM email_mentions WHERE id = ?');
  const clearOptions = database.prepare('DELETE FROM email_mention_options WHERE mentionId = ?');
  const addOption = database.prepare('INSERT OR IGNORE INTO email_mention_options (mentionId, optionId) VALUES (?, ?)');
  const sortStmt = database.prepare('UPDATE email_mentions SET sortOrder = ? WHERE id = ?');
  const readOrder = database.prepare('SELECT bookedConfirmationOrder AS v FROM app_settings LIMIT 1');
  const writeOrder = database.prepare(`
    INSERT INTO app_settings (id, bookedConfirmationOrder) VALUES (1, ?)
    ON CONFLICT (id) DO UPDATE SET bookedConfirmationOrder = excluded.bookedConfirmationOrder
  `);

  const row = (m, optionIds) => ({ ...m, priceOptionId: m.priceOptionId == null ? null : Number(m.priceOptionId), optionIds });

  function list() {
    const links = {};
    for (const l of optionsStmt.all()) (links[l.mentionId] = links[l.mentionId] || []).push(Number(l.optionId));
    return listStmt.all().map((m) => row(m, links[m.id] || []));
  }

  function find(id) {
    const m = findStmt.get(Number(id));
    return m ? row(m, optionsOf.all(m.id).map((o) => Number(o.optionId))) : null;
  }

  const values = (m) => Object.fromEntries(FIELDS.map((f) => [f, m[f] === undefined ? null : m[f]]));

  const create = database.transaction((m) => {
    const id = Number(insertStmt.run(values(m)).lastInsertRowid);
    for (const optionId of m.optionIds || []) addOption.run(id, Number(optionId));
    return find(id);
  });

  const update = database.transaction((id, m) => {
    if (!findStmt.get(Number(id))) return null;
    updateStmt.run({ ...values(m), id: Number(id) });
    clearOptions.run(Number(id));
    for (const optionId of m.optionIds || []) addOption.run(Number(id), Number(optionId));
    return find(id);
  });

  const remove = database.transaction((id) => {
    const removed = deleteStmt.run(Number(id)).changes > 0;
    if (removed) setConfirmationOrder(confirmationOrder().filter((item) => item !== `mention:${Number(id)}`));
    return removed;
  });

  const reorder = database.transaction((ids) => {
    ids.forEach((id, index) => sortStmt.run(index + 1, Number(id)));
  });

  function confirmationOrder() {
    try {
      const parsed = JSON.parse((readOrder.get() || {}).v || '[]');
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  function setConfirmationOrder(items) {
    writeOrder.run(JSON.stringify(items.map(String)));
  }

  return { list, find, create, update, remove, reorder, confirmationOrder, setConfirmationOrder };
}

module.exports = { buildModel };
