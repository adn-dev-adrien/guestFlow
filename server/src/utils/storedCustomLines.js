/**
 * specs/reservation-save-keeps-pricing.md rule 19 — which stored row a posted custom line is. A custom line's id
 * rolls at every priced save, so a form loaded earlier may carry none or a stale one: by id first, over every line so
 * a new line sharing the text never takes a row another line names, then by normalised text. Each row answers once.
 * A line its caller appends (`newLine`: the fiche's typed line, a sale's line) is no stored row whatever its text
 * (pricing-components rule 94 reading, loop t16 S16-3 b): a line removed and typed again under the same label in one
 * save is a new line, never the removed row with its number, discount and money.
 */
const { extraLineKey } = require('./midStayExtras');

const textKey = (description) => extraLineKey({ isCustom: true, title: description });

function matchStoredCustomLines(postedLines, storedRows) {
  const free = [...storedRows];
  const take = (at) => (at >= 0 ? free.splice(at, 1)[0] : null);
  const matches = postedLines.map((line) => (
    line?.customOptionId != null ? take(free.findIndex((row) => row.id === Number(line.customOptionId))) : null
  ));
  return postedLines.map((line, index) => {
    if (matches[index]) return matches[index];
    if (line?.newLine) return null;
    const key = textKey(line?.description);
    return key ? take(free.findIndex((row) => textKey(row.description) === key)) : null;
  });
}

/**
 * specs/pricing-components.md rule 79 reading (loop t13 S13-1) — the engine reads a stored line's facts (its discount, moment, sale date)
 * under its text key, while a renamed line keeps its row. `renames` are `[{ id, from, to }]` (the posted lines whose text alone changed),
 * `lineIdOf` maps a stored row id to its `lineId`: each renamed line's fact moves to its new key — the old key is freed first, so a new line
 * posted under the old text, a swap of two labels, or a line renamed onto the text of a line this save removes reads only its own fact.
 * A fact that is not this row's (two rows of one text, the first holds the key) stays where it is.
 */
function renamedCustomLineFacts(facts, renames, lineIdOf) {
  const moves = (renames || [])
    .map(({ id, from, to }) => ({ from: textKey(from), to: textKey(to), lineId: lineIdOf.get(Number(id)) }))
    .filter((move) => move.from && move.to && move.from !== move.to && move.lineId != null
      && facts[move.from] && facts[move.from].table === 'custom' && Number(facts[move.from].lineId) === Number(move.lineId))
    .map((move) => ({ ...move, fact: facts[move.from] }));
  if (moves.length === 0) return facts;
  const out = { ...facts };
  for (const move of moves) delete out[move.from];
  for (const move of moves) out[move.to] = move.fact;
  return out;
}

/**
 * Pricing-components rule 94 reading (loop t16 S16-3 b) — the engine reads a free line's facts (discount, moment, sale date) under its text key.
 * A stored row the save removes leaves its fact behind under that key: a NEW posted line of the same text (no stored row answers it) would read
 * it and take the removed line's discount. The fact of a removed row is dropped when a new line takes its key; a removed row whose key no line
 * takes keeps its fact (the readers of a removed line — its payment, its refusal — still find it). `storedRows`: `[{ id, description, lineId }]`.
 */
function withoutRemovedLineFacts(facts, postedLines, storedRows) {
  const posted = Array.isArray(postedLines) ? postedLines : [];
  const rows = Array.isArray(storedRows) ? storedRows : [];
  if (posted.length === 0 || rows.length === 0) return facts;
  const matches = matchStoredCustomLines(posted, rows);
  const named = new Set(matches.filter(Boolean).map((row) => Number(row.id)));
  const removedLineIds = new Set(rows.filter((row) => !named.has(Number(row.id)) && row.lineId != null).map((row) => Number(row.lineId)));
  const freed = posted.filter((line, index) => !matches[index]).map((line) => textKey(line?.description))
    .filter((key) => key && facts[key] && facts[key].table === 'custom' && removedLineIds.has(Number(facts[key].lineId)));
  if (freed.length === 0) return facts;
  const out = { ...facts };
  for (const key of freed) delete out[key];
  return out;
}

/** The stored rows a save's posted custom lines name (`matchStoredCustomLines`), as a Set of row ids: the rows whose facts the writer carries. */
function namedStoredCustomRowIds(postedLines, storedRows) {
  return new Set(matchStoredCustomLines(Array.isArray(postedLines) ? postedLines : [], Array.isArray(storedRows) ? storedRows : [])
    .filter(Boolean).map((row) => Number(row.id)));
}

module.exports = { matchStoredCustomLines, renamedCustomLineFacts, withoutRemovedLineFacts, namedStoredCustomRowIds };
