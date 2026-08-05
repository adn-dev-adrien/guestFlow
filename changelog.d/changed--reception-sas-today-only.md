- Rôle « Accueil » : seuls les SAS **du jour** sont modifiables. Un check-in / check-out **passé**,
  **à venir** ou **déjà validé** est inerte dans l'interface (✓ grisé + info-bulle expliquant
  pourquoi) et refusé par le serveur (403 `SAS_LOCKED` avec le motif) avant la moindre écriture. Les
  cases « Prêt » / « Arrivé » / « Parti » suivent la même fenêtre (403 `STATUS_LOCKED`). La fenêtre
  court du jour concerné 00h00 au lendemain 04h00, pour couvrir les arrivées tardives et les départs
  matinaux. L'administrateur conserve la ré-édition complète, quelle que soit la date.
