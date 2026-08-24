// specs/arrival-moment-is-the-check-in.md — « le client est arrivé » est un acte de l'opérateur
// (check-in ou SAS d'arrivée), jamais une date de calendrier. Bug remonté sur la prod le 2026-08-24 :
// une option ajoutée à la main le jour de l'arrivée, avant tout check-in, partait au complément de
// FIN de séjour.
//
// Le prédicat vit dans son propre util parce que trois règles s'y adossent et divergeaient : ce qui
// ouvre la fenêtre « vendu en cours de séjour » doit se lire au même endroit pour tout le monde.
// L'effet de bout en bout (base posée ou non) est couvert par
// `settled-complement-closes-bucket.unit.test.js`, avec le reste du cycle du complément.

const test = require('node:test');
const assert = require('node:assert/strict');

const { hasGuestArrived } = require('../utils/arrivalMoment');

test('la date ne vaut jamais arrivée, même très en retard', () => {
  assert.equal(hasGuestArrived({ startDate: '2020-01-01' }), false);
  assert.equal(hasGuestArrived({ checkInDone: 0, arrivalSasDoneAt: null }), false);
  assert.equal(hasGuestArrived({}), false);
  assert.equal(hasGuestArrived(null), false, 'appel défensif : pas de ligne, pas d\'arrivée');
});

test('chacun des deux signaux suffit — les deux flux sont utilisés en parallèle', () => {
  assert.equal(hasGuestArrived({ checkInDone: 1 }), true, 'la case check-in');
  assert.equal(hasGuestArrived({ arrivalSasDoneAt: '2026-08-24 15:02:00' }), true, 'le SAS d\'arrivée');
});
