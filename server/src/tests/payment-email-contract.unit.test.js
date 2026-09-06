// specs/payment-schedule-and-cancellation.md §3.7 — le contrat des emails d'argent, tenu par le
// registre des modèles.
//
// Pourquoi ce fichier existe : §3.7 décrit quatre modèles et un cinquième d'annulation, chacun avec
// son ancre, son décalage et son mode d'envoi, et RIEN ne vérifiait cette table. Or c'est une table
// que personne ne relit : le jour où un modèle repasse en `auto` ou change d'ancre, l'erreur ne se
// voit qu'au courrier reçu par un client — et il est alors trop tard, il est parti.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_TEMPLATES,
  EVENT_TRIGGERED_STABLE_KEYS,
  PAYMENT_STABLE_KEYS,
} = require('../utils/defaultEmailTemplatesRegistry');
const { buildContext } = require('../utils/emailContextBuilder');

const byKey = (k) => DEFAULT_TEMPLATES.find((t) => t.stableKey === k);

// specs/payment-schedule-and-cancellation.md rule 36 — `deposit_request` n'est JAMAIS envoyé par le
// serveur : il est déclenché par le geste de l'opérateur (« Envoyer la demande »), donc exclu de la
// file d'attente comme du cron.
test('rule 36 — la demande d’acompte est déclenchée par un geste, jamais par une date', () => {
  const t = byKey('deposit_request');
  assert.equal(t.sendMode, 'manual');
  assert.ok(EVENT_TRIGGERED_STABLE_KEYS.includes('deposit_request'), 'exclu de la file et du cron');
});

// specs/payment-schedule-and-cancellation.md rule 37 — la relance d'acompte est ancrée sur la
// deadline de l'ACOMPTE (et non sur l'arrivée, comme avant), au jour même, et reste manuelle.
test('rule 37 — la relance d’acompte tombe sur la deadline de l’acompte, et attend l’opérateur', () => {
  const t = byKey('deposit_reminder');
  assert.equal(t.anchor, 'depositDueDate');
  assert.equal(t.dayOffset, 0);
  assert.equal(t.sendMode, 'manual');
});

// specs/payment-schedule-and-cancellation.md rule 38 — la passe quotidienne du solde est SUPPRIMÉE :
// les mêmes réservations sont désormais *montrées* sur le tableau de bord au lieu d'être *postées*.
test('rule 38 — plus aucune passe quotidienne ne demande le solde', () => {
  assert.throws(
    () => require.resolve('../utils/balanceRequestRunner'),
    'le runner de 08:00 doit rester supprimé',
  );
  const t = byKey('balance_request');
  assert.equal(t.sendMode, 'manual');
  assert.ok(EVENT_TRIGGERED_STABLE_KEYS.includes('balance_request'));
});

// specs/payment-schedule-and-cancellation.md rule 39 — la relance de solde : 3 jours après la
// deadline, avant les 7 jours qui coûtent le séjour, et manuelle.
test('rule 39 — la relance de solde arrive 3 jours après la deadline, et reste manuelle', () => {
  const t = byKey('balance_reminder');
  assert.equal(t.anchor, 'balanceDueDate');
  assert.equal(t.dayOffset, 3);
  assert.equal(t.sendMode, 'manual');
});

// specs/payment-schedule-and-cancellation.md rule 40 — l'avis d'annulation existe, et il est émis par
// l'annulation que l'opérateur confirme : jamais mis en file, jamais planifié.
test('rule 40 — l’avis d’annulation existe et n’entre ni dans la file ni dans le cron', () => {
  const t = byKey('cancellation_notice');
  assert.ok(t, 'le modèle doit être au registre');
  assert.equal(t.sendMode, 'manual');
  assert.equal(t.anchor, undefined, 'aucune ancre : ce n’est pas un email de calendrier');
  assert.ok(EVENT_TRIGGERED_STABLE_KEYS.includes('cancellation_notice'));
});

// specs/payment-schedule-and-cancellation.md rule 43 — les jetons que les corps de §3.7 emploient.
// `daysLate` figure dans la règle mais n'a jamais été construit : aucun corps ne l'utilise, la
// relance de solde disant la DATE d'échéance plutôt qu'un nombre de jours. La règle a été corrigée
// le 2026-09-01 pour dire ce qui existe.
test('rule 43 — les jetons d’annulation sont fournis par le contexte, calculés côté serveur', () => {
  const { vars } = buildContext({
    reservation: { depositAmount: 300, depositPaid: 1, balanceDueDate: '2026-07-01' },
    client: null, property: null, options: [], settings: {},
  });
  assert.ok('cancelOnDate' in vars);
  assert.equal(vars.retainedDepositAmount, '300,00 €');
});

test('rule 43 — un acompte non encaissé n’est pas annoncé comme conservé', () => {
  const { vars } = buildContext({
    reservation: { depositAmount: 300, depositPaid: 0 },
    client: null, property: null, options: [], settings: {},
  });
  assert.equal(vars.retainedDepositAmount, '0,00 €');
});

// specs/payment-schedule-and-cancellation.md rule 46 — la restriction s'arrête au chemin de l'argent.
// Les emails d'arrivée, du SAS et du petit-déjeuner ne sont pas concernés par `PAYMENT_STABLE_KEYS`.
// (Ils sont depuis passés eux aussi en `manual` par specs/no-automatic-dunning-emails — une décision
// PLUS LARGE, prise ailleurs ; ce test épingle seulement que celle-ci ne les visait pas.)
test('rule 46 — la restriction de cette spec ne déborde pas sur les emails hors argent', () => {
  for (const key of ['arrival_reminder_7d', 'arrival_reminder_1d', 'reservation_confirmation']) {
    assert.ok(byKey(key), `${key} doit exister`);
    assert.equal(PAYMENT_STABLE_KEYS.includes(key), false, `${key} n’est pas un email d’argent`);
  }
});

// specs/payment-schedule-and-cancellation.md rule 17bis — la carte du tableau de bord est la SEULE
// chose qui fasse partir un email d'argent. Mécaniquement : aucun des cinq modèles ne peut être
// envoyé par une tâche planifiée, puisque le cron n'envoie que du `auto` — les quatre modèles
// d'argent sont donc, tous, proposés à l'opérateur et jamais expédiés derrière son dos.
test('rule 17bis — aucun modèle d’argent ne peut partir sans un geste d’opérateur', () => {
  const auto = PAYMENT_STABLE_KEYS
    .map(byKey)
    .filter((t) => t && t.sendMode !== 'manual')
    .map((t) => t.stableKey);
  assert.deepEqual(auto, [], 'un seul « auto » ici et un cron reprend la main sur l’argent');
});
