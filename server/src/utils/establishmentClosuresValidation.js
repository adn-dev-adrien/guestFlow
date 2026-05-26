/**
 * Establishment closures validation — pure helpers, French errors.
 *
 * Overlap detection involves DB queries and lives in the model layer.
 * Only stateless range validation is here.
 */

function validateRange(startDate, endDate) {
  if (!startDate || !endDate) {
    return 'Les dates de début et de fin sont obligatoires.';
  }
  if (startDate >= endDate) {
    return 'La date de fin doit être postérieure à la date de début.';
  }
  return null;
}

module.exports = { validateRange };
