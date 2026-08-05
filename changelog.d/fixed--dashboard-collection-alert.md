- **Tableau de bord — le rouge ne signale plus que l'argent à encaisser au comptoir** (spec
  `dashboard-collection-alert.md`, 2026-08-05). La colonne « Paiements » passait en rouge dès qu'un
  acompte ou un solde restait ouvert : une réservation plateforme, qui n'est virée qu'après le
  séjour, était donc rouge tous les jours pour un fonctionnement parfaitement normal. Pire, le
  calcul ignorait les deux compléments alors que le prix final les inclut, donc « Manquant X € »
  persistait même après encaissement du complément — et le montant affiché était faux. Désormais le
  rouge se déclenche uniquement sur le complément d'arrivée non encaissé et non reporté (liste
  Arrivées) et sur le complément de fin de séjour encore ouvert (liste Départs) ; l'acompte et le
  solde en cours s'affichent en gris, avec un badge « Réglé par la plateforme » quand la plateforme
  verse après le séjour. Nouveau bloc serveur `operationalCollection` sur `GET /reservations/:id`,
  nouveau composant `CollectionStatusCell`, et règles de solde par échéance extraites dans
  `utils/reservationSettlement.js` (partagées avec le Suivi financier, dont les chiffres sont
  inchangés). +25 tests serveur, +3 tests client.
