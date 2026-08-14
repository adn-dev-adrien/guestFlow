// Tariff change journal — specs/tariff-change-journal.md
//
// A tariff change happens in two beats: the recipe is applied inside GuestFlow, then the new grid is
// pushed to the booking platforms. Only the second one changes what a traveller sees, so only the
// second one can explain a swing in reservations — and neither was recorded anywhere. This model is
// the sole gateway to `tariff_change_events`.
//
// The table is a REGISTER: nothing here feeds a price. `occurredAt` is when the change took effect,
// `createdAt` is when the row was written — deliberately two columns, because a rollout is often
// declared after the fact (spec rule 4). Statistics read `occurredAt`.

const KINDS = Object.freeze(['recipe', 'platforms']);
const SOURCES = Object.freeze(['apply', 'manual', 'backfill']);

const KIND_LABELS = Object.freeze({
  recipe: 'Recette appliquée',
  platforms: 'Mise en ligne sur les plateformes',
});

// Accepts 'YYYY-MM-DD' and 'YYYY-MM-DD HH:MM[:SS]' (also with the ISO 'T'), and normalises to the
// SQLite shape used everywhere else in the schema. Returns null when the input cannot be trusted:
// a wrong date is worse than a refused one, since the whole point is to date things exactly.
function normalizeOccurredAt(value) {
  const raw = String(value == null ? '' : value).trim().replace('T', ' ');
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
  if (!match) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = match;
  const year = Number(y); const month = Number(mo); const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  // Reject impossible days (31 April, 29 February on a common year) rather than let SQLite store them.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

function createTariffChangeJournalModel(database) {
  // Recipe + version come from the property, never from the caller: the journal must describe what
  // was actually applied, not what a form said.
  function propertyRecipe(propertyId) {
    const row = database
      .prepare('SELECT id, tariffRecipeId, tariffRecipeVersion FROM properties WHERE id = ?')
      .get(Number(propertyId));
    return row || null;
  }

  function list({ propertyId } = {}) {
    const where = propertyId ? 'WHERE e.propertyId = ?' : '';
    const params = propertyId ? [Number(propertyId)] : [];
    return database.prepare(`
      SELECT e.id, e.propertyId, p.name AS propertyName, e.kind, e.recipeId, e.recipeVersion,
             e.occurredAt, e.source, e.note, e.createdAt
      FROM tariff_change_events e
      JOIN properties p ON p.id = e.propertyId
      ${where}
      ORDER BY e.occurredAt DESC, e.id DESC
    `).all(...params).map((row) => ({
      ...row,
      kindLabel: KIND_LABELS[row.kind] || row.kind,
      // A backfilled date is inferred from the property's last modification, not observed. The client
      // must be able to say so without re-deriving the rule.
      inferred: row.source === 'backfill',
    }));
  }

  // Called by the recipe apply. Never throws: losing a line of history must not be able to fail an
  // apply that has already written the seasons (spec §4.1).
  function recordRecipeApply({ propertyId, recipeId, recipeVersion, note = '' }) {
    try {
      return insert({
        propertyId, kind: 'recipe', recipeId, recipeVersion, source: 'apply', note,
        occurredAt: null, // now
      });
    } catch (err) {
      console.error('[tariff-change-journal] écriture ignorée :', err.message);
      return null;
    }
  }

  function insert({ propertyId, kind, occurredAt, note = '', source = 'manual', recipeId, recipeVersion }) {
    const property = propertyRecipe(propertyId);
    if (!property) return { error: 'Logement introuvable' };
    if (!KINDS.includes(kind)) return { error: 'Nature de changement inconnue' };
    if (!SOURCES.includes(source)) return { error: 'Provenance inconnue' };

    const when = occurredAt == null
      ? database.prepare("SELECT datetime('now') AS now").get().now
      : normalizeOccurredAt(occurredAt);
    if (!when) return { error: "Date d'effet invalide" };

    const info = database.prepare(`
      INSERT INTO tariff_change_events (propertyId, kind, recipeId, recipeVersion, occurredAt, source, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(propertyId),
      kind,
      String(recipeId ?? property.tariffRecipeId ?? ''),
      String(recipeVersion ?? property.tariffRecipeVersion ?? ''),
      when,
      source,
      String(note || '').slice(0, 500),
    );
    return { event: getById(info.lastInsertRowid) };
  }

  function getById(id) {
    return database.prepare(`
      SELECT e.id, e.propertyId, p.name AS propertyName, e.kind, e.recipeId, e.recipeVersion,
             e.occurredAt, e.source, e.note, e.createdAt
      FROM tariff_change_events e JOIN properties p ON p.id = e.propertyId
      WHERE e.id = ?
    `).get(Number(id)) || null;
  }

  // Deleting is the only correction path (spec rule 9): editing in place would let a wrong date be
  // rewritten into a plausible one, and the register would stop being a register.
  function remove(id) {
    return database.prepare('DELETE FROM tariff_change_events WHERE id = ?').run(Number(id)).changes > 0;
  }

  return { list, insert, remove, getById, recordRecipeApply };
}

let defaultModel = null;
function getDefaultModel() {
  if (!defaultModel) defaultModel = createTariffChangeJournalModel(require('../database'));
  return defaultModel;
}

module.exports = {
  createTariffChangeJournalModel,
  getDefaultModel,
  normalizeOccurredAt,
  KINDS,
  KIND_LABELS,
};
