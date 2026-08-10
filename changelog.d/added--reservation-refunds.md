- **Remboursements — rendre de l'argent sans toucher à la vente** (spec `reservation-refunds.md`, 2026-08-10).
  Un départ anticipé où la nuit reste facturée mais les petits-déjeuners non pris sont rendus n'avait
  aucune représentation : réduire la ligne cassait le « reste à payer » et laissait la compta au prix
  fort. La fiche gagne un bloc **« Remboursements »** (total, historique, suppression) et une fenêtre
  qui liste les prestations facturées avec leur plafond, accepte une ligne libre, et se ferme sur une
  date + un moyen (virement / espèces / caisse interne, cette dernière hors compta comme les
  compléments en liquide). La vente, les échéances et les flags « payé » ne bougent jamais : le
  montant rendu est déduit du « total de séjour », de l'encaissé et du CA, et l'export mensuel du
  comptable porte une **écriture d'avoir** datée du virement (crédit compte client / débit 70xxx +
  TVA, la taxe de séjour sur le 46710000). Plafonds serveur par ligne et sur le séjour, TVA figée à
  l'émission, admin uniquement, disponible sur une réservation passée verrouillée.
  **La taxe de séjour se rembourse à la nuit** et la déclaration suit : la nuit rendue sort des
  « Nuits », des « Adultes-nuits » et du montant de la page Taxe de séjour — ligne, récap par logement
  et totaux du mois — avec la mention « dont 1 nuit remboursée (− 4,40 €) ». Tous moyens confondus,
  caisse interne comprise : ce qui est reparti chez le client n'est pas dû à la commune. Une taxe
  entièrement rendue fait sortir la réservation de la déclaration.
  +47 tests serveur, +18 tests client.
