/**
 * specs/reservation-save-keeps-pricing.md rule 19 — which stored row a posted custom line is. A custom line's id
 * rolls at every priced save, so a form loaded earlier may carry none or a stale one: by id first, over every line so
 * a new line sharing the text never takes a row another line names, then by normalised text. Each row answers once.
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

module.exports = { matchStoredCustomLines, renamedCustomLineFacts };
