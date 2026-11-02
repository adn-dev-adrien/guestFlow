// A year far enough ahead that a stay in it is never past, and inside the date horizon (today + 5 years,
// specs/reservations-backend-mvc.md rule 13): three or four years from now, never a leap year — the
// server suites' tests/farYearFixture.js. The specs that wrote 2099 as « the far future » write this.
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const thisYear = new Date().getFullYear();
export const FAR_YEAR = isLeap(thisYear + 3) ? thisYear + 4 : thisYear + 3;
