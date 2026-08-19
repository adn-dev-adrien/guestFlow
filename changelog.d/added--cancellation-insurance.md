- **Assurance annulation de séjour** (spec `cancellation-insurance.md`, 2026-08-19). Nouvelle option
  « Assurance annulation » au catalogue, avec un nouveau type de prix générique **« % du montant du
  séjour »** : la prime se calcule sur l'hébergement du séjour (nuits après remise + supplément
  voyageurs, hors options, ressources et taxe de séjour), avec un pourcentage paramétrable — global
  ou par logement — ou, au choix, un montant fixe. Tant que le tarif est à 0, l'assurance n'est
  proposée nulle part. Sur le site WordPress, elle sort de la liste « Options & suppléments » pour
  avoir **son propre encart, avec un choix Oui / Non obligatoire** avant validation : le montant réel
  du séjour y est affiché, calculé par le serveur. Prime figée une fois le séjour vendu, jamais
  proposée au check-in. +35 tests serveur, +4 tests client, plugin WordPress 1.5.0.
