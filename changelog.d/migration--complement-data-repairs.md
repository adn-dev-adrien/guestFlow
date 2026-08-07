- Deux réparations de données au démarrage, sur les réservations touchées par les doublons de
  complément corrigés ci-dessus. La base est sauvegardée avant migration par le déploiement.
  - `endOfStayComplementDetail` / `endOfStayComplementAmount` : les lignes « linge de toilette »
    écrites par l'ancien report en fin de séjour sont supprimées et le montant recalculé sur les
    lignes restantes (les marqueurs de paiement ne sont jamais touchés). Idempotent.
  - `complementAmount` : un complément d'arrivée encaissé qui avait absorbé une vente en séjour est
    réduit de la part déjà facturée par le complément de fin de séjour. **Passage unique**, verrouillé
    par la table `migrations` (`frozen_complement_midstay_repair_v1`) — la correction soustrait, la
    rejouer entamerait le montant à chaque démarrage.
