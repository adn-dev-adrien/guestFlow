- **Options — colonne `isCancellationInsurance`** (spec `cancellation-insurance.md`). Ajout
  idempotent au démarrage (`0` par défaut), plus l'insertion d'une option « Assurance annulation »
  **non tarifée** (0 %) rattachée à tous les logements. Aucune donnée existante n'est modifiée : tant
  qu'aucun tarif n'est saisi, ni les fiches ni le site ne changent. Une option maison déjà nommée
  « Assurance annulation » / « Garantie annulation » est **adoptée** (prix, périmètre et libellé
  conservés) plutôt que dupliquée.
