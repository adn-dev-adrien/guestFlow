// specs/arrival-moment-is-the-check-in.md — « le client est arrivé » est un acte de l'opérateur
// (check-in ou SAS d'arrivée), pas une date de calendrier. Bug remonté sur la prod le 2026-08-24 :
// une option ajoutée à la main le jour de l'arrivée, avant tout check-in, partait au complément de
// FIN de séjour, et restait affichée en double (une fois à l'arrivée, une fois au départ).

const test = require('node:test');
const assert = require('node:assert/strict');

const { hasGuestArrived, arrivalBaselineDue } = require('../utils/arrivalMoment');
const { __test: { arrivalComplementDetailFromReservation } } = require('../models/reservationsModel');

// ── Le signal d'arrivée ─────────────────────────────────────────────────────────────────────────
test('hasGuestArrived — seul un acte d\'arrivée compte, jamais la date', () => {
  assert.equal(hasGuestArrived({ startDate: '2020-01-01' }), false, 'un séjour passé sans check-in : pas arrivé');
  assert.equal(hasGuestArrived({ checkInDone: 1 }), true);
  assert.equal(hasGuestArrived({ arrivalSasDoneAt: '2026-08-24 15:02:00' }), true);
  assert.equal(hasGuestArrived({ checkInDone: 0, arrivalSasDoneAt: null }), false);
});

test('arrivalBaselineDue — un complément déjà encaissé vaut arrivée (filet de sécurité)', () => {
  // Sans base, une vente postérieure à un complément figé n'atteindrait aucun bucket.
  assert.equal(arrivalBaselineDue({ complementPaid: 1 }), true);
  assert.equal(arrivalBaselineDue({ complementPaid: 0 }), false);
  assert.equal(arrivalBaselineDue({ checkInDone: 1, complementPaid: 0 }), true);
});

// ── Le doublon d'affichage ──────────────────────────────────────────────────────────────────────
// Le moteur retire déjà du complément d'arrivée la part vendue en séjour ; le DÉTAIL, lui, listait la
// ligne à son prix plein. La carte affichait donc plus que son propre total, et la même prestation
// apparaissait aussi dans le complément de fin de séjour.
function reservationWithMidStaySale() {
  return {
    // Repas : 25 € au moment de l'arrivée, 75 € aujourd'hui → 50 € vendus en cours de séjour.
    options: [{ optionId: 16, title: 'Le repas des trappeurs', totalPrice: 75, offered: 0, inComplement: 1, billedUnits: 3, unitPrice: 25 }],
    resources: [],
    arrivalExtrasBaseline: '{"opt:16":25}',
    endOfStayComplementDetail: '[{"label":"Le repas des trappeurs","amount":50,"source":"midStayExtra","key":"opt:16"}]',
    endOfStayComplementPaid: 0,
    touristTaxInComplementAmount: 0,
    complementAmount: 25, // le moteur a déjà carvé les 50 €
    complementPaid: 0,
  };
}

test('le détail du complément d\'arrivée ne liste que la part encaissée à l\'arrivée', () => {
  const detail = arrivalComplementDetailFromReservation(reservationWithMidStaySale());
  const repas = detail.detail.filter((l) => l.label === 'Le repas des trappeurs');
  assert.equal(repas.length, 1, 'la prestation est listée une seule fois');
  assert.equal(repas[0].amount, 25, 'à sa part d\'arrivée, pas à son prix plein');
  // Et le détail retombe exactement sur le total de la carte : plus de ligne « reste » fantôme.
  const listed = detail.detail.reduce((s, l) => s + l.amount, 0);
  assert.equal(Math.round(listed * 100) / 100, detail.amount);
});

test('sans base d\'arrivée, rien n\'est carvé : le détail liste la prestation en entier', () => {
  // C'est l'état d'un séjour où personne n'a encore fait le check-in — le cas du bug.
  const r = { ...reservationWithMidStaySale(), arrivalExtrasBaseline: null, endOfStayComplementDetail: null, complementAmount: 75 };
  const detail = arrivalComplementDetailFromReservation(r);
  assert.equal(detail.detail.length, 1);
  assert.equal(detail.detail[0].amount, 75, 'toute la prestation est au complément d\'arrivée');
});

test('une prestation vendue ENTIÈREMENT en séjour quitte le détail d\'arrivée', () => {
  const r = {
    ...reservationWithMidStaySale(),
    arrivalExtrasBaseline: '{}',
    endOfStayComplementDetail: '[{"label":"Le repas des trappeurs","amount":75,"source":"midStayExtra","key":"opt:16"}]',
    complementAmount: 0,
  };
  const detail = arrivalComplementDetailFromReservation(r);
  assert.deepEqual(detail.detail, [], 'elle est facturée au départ, et là uniquement');
});

test('une ligne offerte garde son affichage à 0 € et ne consomme pas la part vendue en séjour', () => {
  const r = {
    options: [
      { optionId: 7, title: 'Ménage', totalPrice: 0, originalTotalPrice: 30, offered: 1, inComplement: 1 },
      { optionId: 16, title: 'Le repas des trappeurs', totalPrice: 75, offered: 0, inComplement: 1 },
    ],
    resources: [],
    arrivalExtrasBaseline: '{"opt:16":25}',
    endOfStayComplementDetail: '[{"label":"Le repas des trappeurs","amount":50,"source":"midStayExtra","key":"opt:16"}]',
    endOfStayComplementPaid: 0,
    touristTaxInComplementAmount: 0,
    complementAmount: 25,
  };
  const detail = arrivalComplementDetailFromReservation(r, { includeOffered: true });
  const offert = detail.detail.find((l) => l.label === 'Ménage');
  assert.equal(offert.amount, 0);
  assert.equal(offert.originalAmount, 30);
  assert.equal(detail.detail.find((l) => l.label === 'Le repas des trappeurs').amount, 25);
});
