- **Plus aucune relance de paiement vers un client de plateforme.** Le cron d'envoi automatique
  n'appliquait aucun filtre de canal sur ses ancres `depositDueDate` / `balanceDueDate`, contrairement à
  la passe quotidienne de demande de solde : le modèle « Relance solde » (automatique, actif) pouvait
  donc réclamer à un client Airbnb un solde déjà réglé à la plateforme. Les deux ancres de paiement sont
  désormais restreintes aux canaux propres (direct, Lodgify) ; les emails d'arrivée, eux, partent
  toujours quel que soit le canal.
