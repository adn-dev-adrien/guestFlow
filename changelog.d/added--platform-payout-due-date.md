- **Échéance de virement plateforme.** Une réservation OTA porte désormais une échéance de solde qui a
  un sens : le virement de la plateforme, attendu `payoutDueDays` jours après le départ du client
  (10 par défaut, réglable par plateforme sur la fiche logement). Elle est posée dès la création de la
  réservation, import iCal compris, et suit le départ quand les dates bougent.
- **Alerte « Virement plateforme en retard »** sur le tableau de bord : la carte « Échéances de
  paiement » liste maintenant les virements de plateforme non reçus passé leur échéance, avec le nom de
  la plateforme. Ni relance client ni annulation sur ces lignes — l'argent est dû par la plateforme et
  le séjour a déjà eu lieu.
- **Alerte « Montant manquant »** : une réservation importée d'une plateforme dont le montant n'a
  jamais été saisi (aucun prix, aucun acompte, aucun solde) remonte sur la même carte à l'échéance de
  virement — quand l'argent aurait dû arriver, la réservation doit être complète. C'est la seule ligne
  sans date de péremption : un montant absent des comptes ne devient pas acceptable en vieillissant.
