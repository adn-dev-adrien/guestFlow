// The day on the server's clock (Europe/Paris in production), never the UTC one — the same rule as the
// core's utils/localDate (specs/finance-dashboard-redesign.md rule 37), kept here so the plugin package
// does not require a newer core.
const pad = (n) => String(n).padStart(2, '0');

function localIsoDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

module.exports = { localIsoDate };
