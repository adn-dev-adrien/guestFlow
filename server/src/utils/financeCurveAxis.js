// Graduations of the hero's cumulative curve (specs/finance-dashboard-redesign.md rule 30): on the
// calendar, never on the sampled points — the 1st of each month past 62 days, the 1st, 8th, 15th,
// 22nd and 29th below. January is named by its year once a month name could appear twice. Pure;
// positions are days since the window's first day.

const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WEEKLY_DAYS = [1, 8, 15, 22, 29];

const toTime = (day) => Date.parse(`${day}T00:00:00Z`);
const dayOffset = (from, day) => Math.round((toTime(day) - toTime(from)) / 86400000);
const iso = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/**
 * @param {string} from  window's first day, YYYY-MM-DD
 * @param {string} to    window's last day, YYYY-MM-DD
 * @param {boolean} daily  true when the curve has a point per day (short window)
 * @returns {{ x: number, label: string }[]}
 */
function curveAxis(from, to, daily) {
  const ticks = [];
  const repeatsMonths = dayOffset(from, to) > 366;
  const y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7)) - 1;
  for (let first = iso(y, m, 1); first <= to; m += 1, first = iso(y, m, 1)) {
    const [yy, mm] = [Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1];
    if (daily) {
      for (const d of WEEKLY_DAYS) {
        const day = iso(yy, mm, d);
        if (day.slice(5, 7) === first.slice(5, 7) && day >= from && day <= to) {
          ticks.push({ x: dayOffset(from, day), label: `${d} ${SHORT_MONTHS[mm]}` });
        }
      }
    } else if (first >= from) {
      ticks.push({ x: dayOffset(from, first), label: repeatsMonths && mm === 0 ? String(yy) : SHORT_MONTHS[mm] });
    }
  }
  return ticks;
}

module.exports = { curveAxis, dayOffset };
