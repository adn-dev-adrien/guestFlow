/**
 * The line a Clients row prints under the name: when the guest comes, or came, or what is pending
 * (specs/clients-upcoming-past-directory.md rule 14). Pure and French, so the page renders it as is.
 */

const { bookingDayOf } = require('./vatRegime');

const MS_PER_DAY = 86400000;
const DEVIS_STATUS_LABEL = {
  draft: 'brouillon', sent: 'envoyé', accepted: 'accepté', converted: 'converti',
};

const dayNumber = (iso) => Math.round(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / MS_PER_DAY);
const shortDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const longDate = (iso) => `${shortDate(iso)}/${iso.slice(0, 4)}`;

function upcomingLabel(stay, today) {
  const untilStart = dayNumber(stay.startDate) - dayNumber(today);
  if (untilStart < 0) return `En séjour · départ le ${shortDate(stay.endDate)}`;
  if (untilStart === 0) return "Arrive aujourd'hui";
  if (untilStart === 1) return 'Arrive demain';
  if (untilStart <= 60) return `Arrive dans ${untilStart} j`;
  return `Arrive le ${longDate(stay.startDate)}`;
}

function pastLabel(stay, today) {
  const days = dayNumber(today) - dayNumber(stay.endDate);
  if (days < 7) return `Parti le ${shortDate(stay.endDate)}`;
  if (days < 61) return `Parti il y a ${Math.floor(days / 7)} sem.`;
  if (days < 730) return `Parti il y a ${Math.floor(days / 30.4375)} mois`;
  const years = Math.floor(days / 365.25);
  return `Parti il y a ${years} an${years > 1 ? 's' : ''}`;
}

function noStayLabel(latestDevis, createdAt) {
  if (latestDevis) {
    const status = DEVIS_STATUS_LABEL[latestDevis.status];
    const number = latestDevis.number || `#${latestDevis.id}`;
    return `Devis ${number}${status ? ` · ${status}` : ''}`;
  }
  const createdOn = bookingDayOf(createdAt);
  return createdOn ? `Créé le ${longDate(createdOn)}` : '';
}

/**
 * @param {'upcoming'|'past'|'none'} bucket
 * @param {{startDate: string, endDate: string}|null} stay   the stay that qualifies the client
 * @param {{id: number, number: string|null, status: string|null}|null} latestDevis
 * @param {string|null} createdAt
 * @param {string} today   YYYY-MM-DD
 */
function clientWhenLabel(bucket, stay, latestDevis, createdAt, today) {
  if (bucket === 'upcoming' && stay) return upcomingLabel(stay, today);
  if (bucket === 'past' && stay) return pastLabel(stay, today);
  return noStayLabel(latestDevis, createdAt);
}

/** « 06/11 → 08/11/2026 »: the year is said once when both days are in it. */
function stayDatesLabel(stay) {
  if (!stay) return '';
  const start = stay.startDate.slice(0, 4) === stay.endDate.slice(0, 4) ? shortDate(stay.startDate) : longDate(stay.startDate);
  return `${start} → ${longDate(stay.endDate)}`;
}

module.exports = { clientWhenLabel, stayDatesLabel };
