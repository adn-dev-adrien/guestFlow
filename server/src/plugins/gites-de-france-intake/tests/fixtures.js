// The Gîtes de France « nouvelle réservation » mail, layout of dossier 11773 (2026-10-14) as the
// mailbox renders it, with a fictitious guest (the repository is public).
const BOOKING_MAIL = `Bonjour,

Une nouvelle réservation a été effectuée pour votre logement 309700 Domaine Solio.


Réservation n° 11773-2026

État : Réservation confirmée
Gîte 309700 | Domaine Solio
picto lieu 215 Côte de Japperenard
07290 Satillieu

picto arrivee du 13/11/2026 à partir de 16h00
picto depart au 15/11/2026 avant 10h00 (2 picto lune)

picto arrivee Réservation effectuée par : DUPONT Claire
picto personnes 8 adultes, 2 enfants et 2 bébés
picto animaux Pas de chien, pas de chat
picto mail claire.dupont@example.org
picto tel 0612345678
Photo hébergement
Voir la réservation


Détail des suppléments

Forfait ménage ( 1 ) x 1	80.00 €

Détail des crédits

Montant net de la location
454.00 €
Total des options
80.00 €
Total net : 534.00 €

Information : une taxe de séjour d'un montant de 19.20 € a été calculée pour cette réservation. Nous la reverserons directement à votre mairie ou communauté de communes.


Cordialement,`;

const withTotals = (mail, { net, options, total }) => mail
  .replace('454.00 €\nTotal des options', `${net} €\nTotal des options`)
  .replace('80.00 €\nTotal net', `${options} €\nTotal net`)
  .replace('Total net : 534.00', `Total net : ${total}`);

module.exports = { BOOKING_MAIL, withTotals };
