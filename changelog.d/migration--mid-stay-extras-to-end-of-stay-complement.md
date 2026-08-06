- `reservations.arrivalExtrasBaseline TEXT DEFAULT NULL` — instantané JSON des extras au démarrage du
  séjour (`{ "opt:9": 24, "custom:linge manquant": 18 }`), base de comparaison pour détecter les
  prestations vendues en cours de séjour. Ajout idempotent au boot, purement additif : les
  réservations existantes valent `NULL`, donc rien n'est requalifié rétroactivement et aucun montant
  déjà enregistré n'est recalculé. Aucun backfill.
