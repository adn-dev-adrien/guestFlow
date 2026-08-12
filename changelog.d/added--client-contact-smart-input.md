- Fiche client : l'adresse se saisit désormais en une seule ligne (« 12 rue des Lilas 07000 Privas ») et
  le serveur la répartit entre le numéro, la rue, le code postal et la ville — les quatre champs restent
  visibles et corrigeables.
- Fiche client : un lien déposé depuis une page web dans les champs Email ou Téléphone n'insère plus son
  `href` brut. Seule la valeur utile est conservée (`mailto:…?subject=…` → `jean.dupont@example.com`,
  `tel:+33627753922` → `0627753922`). Seul l'indicatif `+33` est ramené à `0` : les numéros étrangers
  gardent le leur (`+32475123456`).
