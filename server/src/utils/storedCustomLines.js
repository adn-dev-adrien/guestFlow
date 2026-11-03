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

module.exports = { matchStoredCustomLines };
