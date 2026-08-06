- `reservations.midStaySettledNotes TEXT DEFAULT NULL` — registre JSON des notes encaissées pendant
  le séjour (`[{ id, paidDate, paidCash, total, lines[] }]`). Ajout idempotent au boot, purement
  additif : les réservations existantes valent `NULL` (aucune note), donc comportement inchangé.
  Encaisser une note ne fait que **déplacer** des montants déjà stockés entre le détail du complément
  de fin de séjour et le registre, dans une seule transaction — l'invariant « reste + registre = tout
  ce qui a été vendu en cours de séjour » tient à chaque étape. Aucun backfill, aucune perte.
