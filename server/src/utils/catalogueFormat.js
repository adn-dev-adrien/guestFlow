/**
 * Display strings shared by the option and resource catalogue views
 * (specs/options-resources-ux.md rules 3, 18). Pure — the client renders what these return.
 */

const { emailAmount } = require('./emailMoney');

const EURO_UNITS = Object.freeze({
  per_stay: '/ séjour',
  per_person: '/ pers.',
  per_night: '/ jour',
  per_person_per_night: '/ pers. / jour',
  per_hour: '/ h',
});

const euros = (amount) => emailAmount(amount, 'fr');
const percent = (value) => `${String(Math.round(Number(value) * 100) / 100).replace('.', ',')} %`;

/**
 * « 25 € », or « 25 € – 80 € » when the values differ.
 * @param {number[]} values
 * @param {(n:number)=>string} format
 */
function range(values, format) {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? format(min) : `${format(min)} – ${format(max)}`;
}

/** Names of a set of properties: « tous les logements » when it is the whole set, else « A, B », past two « N logements ». */
function propertiesPhrase(propertyIds, properties) {
  const ids = new Set((propertyIds || []).map(Number));
  const concerned = properties.filter((p) => ids.has(Number(p.id)));
  if (concerned.length === 0) return '';
  if (concerned.length === properties.length) return 'tous les logements';
  if (concerned.length <= 2) return concerned.map((p) => p.name).join(', ');
  return `${concerned.length} logements`;
}

module.exports = {
  EURO_UNITS, euros, percent, range, propertiesPhrase,
};
