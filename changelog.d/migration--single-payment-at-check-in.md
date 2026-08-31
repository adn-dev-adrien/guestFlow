- **`reservations`** gagne deux colonnes : `arrivalPaymentGroup` (TEXT, NULL) qui enregistre le
  paiement unique fait à l'arrivée — sa date, son moyen, son montant et les postes qu'il couvre — et
  `complementPaidAtArrival` (0 par défaut), le marqueur disant que c'est le SAS qui a encaissé le
  complément, comme les deux marqueurs équivalents de l'acompte et du solde. Aucune donnée existante
  n'est modifiée : une réservation sans groupe se lit exactement comme avant. Le groupe est dissous
  dès qu'un des postes qu'il nomme cesse d'être encaissé, y compris depuis la fiche.
