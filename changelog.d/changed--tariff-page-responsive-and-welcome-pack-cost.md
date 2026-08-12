- Page **Gestion tarifaire** : une date de saison ne se coupe plus jamais en deux lignes (la puce
  d'événement perd son icône et passe à la ligne si besoin). Sous 900 px, les saisons s'affichent en
  cartes au lieu d'un tableau de 980 px qu'il fallait faire défiler sur 2,6 écrans, et les trois
  boutons de la barre d'actions se replient en menu « … » au lieu de s'empiler en escalier en
  écrasant le titre.
- Le **coût de revient du pack accueil** quitte les réglages du logement : il appartient désormais à
  la recette (`welcomePack.cost`), qui l'écrit à l'application. C'est une donnée de marge — elle sert
  uniquement à charger le prix direct affiché dans la grille plateformes — et jamais un montant vu
  par le client.
