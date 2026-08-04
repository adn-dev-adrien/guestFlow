- Rôle « Accueil » : un SAS d'arrivée ou de départ **déjà validé** n'est plus modifiable. Le ✓ vert du
  planning devient inerte (« Check-in déjà effectué — modification réservée à l'administrateur ») et
  le serveur refuse tout nouveau commit (403 `SAS_ALREADY_COMMITTED`) avant la moindre écriture. Un
  SAS encore en attente reste entièrement utilisable, et l'admin conserve la ré-édition complète.
