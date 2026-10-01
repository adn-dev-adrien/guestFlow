// The months of an exercise, in exercise order (a September closing starts in October) — shared by the
// Suivi financier's month series (specs/finance-dashboard-redesign.md rule 22). Pure.

const { MONTH_NAMES } = require('./financeWindow');

function exerciseMonths(from, to) {
  const out = [];
  let year = Number(String(from).slice(0, 4));
  let month = Number(String(from).slice(5, 7));
  const endKey = String(to).slice(0, 7);
  for (let guard = 0; guard < 24; guard += 1) {
    const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    if (key > endKey) break;
    const name = MONTH_NAMES[month - 1];
    out.push({ month: key, label: `${name} ${year}`, initial: name[0].toUpperCase() });
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

module.exports = { exerciseMonths };
