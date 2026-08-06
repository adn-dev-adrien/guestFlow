- **Prestations vendues en cours de séjour → complément de fin de séjour** (spec
  `mid-stay-extras-to-end-of-stay-complement.md`, 2026-08-06). Une option, une ressource ou une ligne
  personnalisée ajoutée **après l'arrivée du client** est désormais facturée dans le **complément de
  fin de séjour**, détaillée ligne par ligne (« Petit-déjeuner : 2 × 12 € = 24 € »), visible sur la
  fiche de réservation et dans le SAS de départ, et encaissée au check-out. Auparavant cet argent
  n'était réclamé nulle part : les quatre buckets se figent dès qu'ils sont réglés, donc le total du
  séjour montait sans qu'aucune échéance ne bouge (réservation soldée à tort, CA sous-évalué, et
  écriture comptable `complement` qui créditait plus de produit qu'elle ne débitait). Le découpage se
  fait **au montant** : passer une option de 1 à 2 unités pendant le séjour ne bascule que l'unité
  ajoutée. Le « Total du séjour » de la fiche intègre maintenant tout le complément de fin de séjour,
  comme la page Finances le faisait déjà. Un montant déjà encaissé n'est jamais modifié
  automatiquement. +34 tests serveur, +2 tests client.
