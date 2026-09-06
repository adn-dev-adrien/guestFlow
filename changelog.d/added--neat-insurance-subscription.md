- **Souscription Neat automatique de l'assurance annulation** : quand l'acompte d'une réservation
  directe assurée est encaissé, GuestFlow souscrit la police auprès de Neat via leur API
  (identifiant externe unique — jamais de doublon), avec relances automatiques et notification push
  en cas d'échec. Nouvelle carte Réglages « Assurance annulation (Neat) » (identifiants chiffrés,
  environnement test/production, choix du canal/contrat/mode de paiement, mappage des champs du
  contrat) et badge d'état Neat sur la carte assurance de la fiche (« Réessayer » / « Résilier »).
  Le prix client devient « prime Neat + marge %, arrondi à l'euro supérieur » quand la marge est
  configurée (repli : dernier prix connu, puis tarif manuel des Options). La résiliation reste
  toujours un geste manuel. (specs/neat-cancellation-insurance-subscription.md)
