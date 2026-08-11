- Blanchisserie : le décompte du linge se base désormais uniquement sur l'option « Linge de lit » /
  « Linge de toilette » **cochée sur la réservation**. Un défaut de propriété ne crée plus de contrat
  linge sur un séjour où l'option n'a pas été cochée — le linge de lit n'étant devenu obligatoire
  qu'en juin 2026 sur la Lodge, les séjours antérieurs ne doivent pas être comptés, et retirer le
  linge d'une réservation doit rester possible. Les options **internes** (« Tapis de bain »), qui ne
  sont jamais écrites sur la réservation, continuent d'être comptées via le défaut de propriété.
  Corrige une incohérence où une réservation était comptée par le défaut de propriété alors que le
  serveur remettait sa configuration de lits à zéro à chaque enregistrement : elle apportait 0 drap
  définitivement, sans le signaler (observé en prod sur 3 séjours Aventura lodge).
- Blanchisserie : la carte du planning signale désormais les séjours qui déclarent du linge de lit
  sans quantité saisie — « N séjour(s) sans quantité de linge saisie — chiffre incomplet » avec une
  puce cliquable par réservation. La carte s'affiche même quand la semaine totalise zéro des deux
  côtés, précisément le cas où l'alerte est utile.
