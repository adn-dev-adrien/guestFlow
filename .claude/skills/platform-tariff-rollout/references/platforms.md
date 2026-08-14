# Les trois plateformes — cartes, URL et pièges

Relevé pendant le déploiement tarifaire des 13 et 14 août 2026. Chaque piège listé ici a coûté du
temps ou de l'argent une fois ; aucun ne doit être redécouvert.

---

## Lodgify — le hub

Propage vers **Airbnb, Booking et Vrbo** (synchro horaire ; Vrbo ne rapatrie le contenu qu'une fois
par jour). C'est le seul canal qui a des sous-canaux, donc le seul où la notion de majoration existe.

| Écran | URL |
|---|---|
| Fiche hébergement | `app.lodgify.com/rental/<rentalId>/overview` |
| Tarifs | `app.lodgify.com/pricing/<rentalId>` |
| Saisons | `app.lodgify.com/#/properties/<rentalId>/season-rates` |
| Disponibilités | `app.lodgify.com/availability/<rentalId>` |
| Calendrier | `app.lodgify.com/calendar/single/<roomTypeId>` (vue année : `/single/year/<roomTypeId>`) |
| Devis client | `checkout.lodgify.com/fr/<slug>/<rentalId>/reservation?currency=EUR&arrival=…&departure=…&adults=N` |

Domaine Solio : rentalId **741262**, roomTypeId **808379**, slug **adrien-jouve**. Le Gîte est
741262 → non : Gîte = rental **739140**, roomType **806256**.

**Pièges**

1. **Les promotions ne se cumulent pas** — la plus avantageuse gagne. Une table croissante
   (2 n → 24 % … 7 n → 45 %) s'auto-sélectionne donc. Prouvé par devis : un séjour de 6 nuits a reçu
   −43 % et non −24 %.
2. **« Prix par durée du séjour » n'exprime pas une dégressivité** : il demande un prix total fixe en
   euros, pas un pourcentage, et Booking ne le supporte pas. Utiliser les **Promotions**
   (pourcentage + « Durée de séjour minimum »), dont les « Restrictions » cochent les quatre canaux —
   **Booking compris**, contrairement à la doc publique de Lodgify.
3. **Les tarifs de saison ignorent le supplément voyageur par défaut.** Chaque saison a sa propre
   section « Frais pour les invités supplémentaires » à activer et remplir. L'oublier fait payer le
   tarif deux personnes à une famille de quatre.
4. **La remise de durée s'applique au supplément voyageur** (fondu dans le prix par nuit :
   247 + 2×16 = 279 €/nuit) **mais pas aux « Frais »** — le formulaire de promotion dit « hors frais ».
   Ne jamais modéliser une occupation en frais. Un frais n'a d'ailleurs aucun seuil d'occupation :
   « Par invité » facture *tous* les invités, y compris les deux premiers.
5. **La majoration est un pourcentage par canal, pas par saison**, et ne s'applique pas au direct.
   Choisir celui qui ne descend jamais sous la cible nette : +8 % Airbnb, +7,5 % Booking, +5 % Vrbo.
6. **Le prix de base EST la basse saison** — le seul tarif qui porte nativement le supplément
   voyageur. Ne créer des saisons que pour les niveaux supérieurs : deux saisons au lieu de trente
   plages de dates.
7. **Le sélecteur de dates ne remonte pas avant le mois courant**, et les clics JS sur ses flèches
   sont ignorés (React exige des événements natifs). Pour une année lointaine, prévoir un clic réel
   par mois, ou passer par l'API.
8. **Superposer une plage sur une autre saison propose de l'en retirer** — c'est la bonne façon de
   découper une semaine de moyenne saison dans un bloc d'été. Vérifier les résidus : découper
   22–28 août dans 1er juillet–30 août laisse un fragment 29–30 août.
9. **Les promotions proposées à l'ajout peuvent appartenir à l'autre hébergement.** En rattacher une
   la modifie pour les deux. Toujours « Créer une nouvelle promotion ».
10. **La taxe de séjour se calcule sur le montant hors TVA** : 5,51 % de (net ÷ 1,10).
11. **Le formulaire « Créer une période indisponible » arrive pré-rempli sur le Gîte.** Basculer sur
    la Tente à chaque fois.
12. **Lodgify refuse une période indisponible qui en chevauche une autre** (« Cette période a déjà
    été fermée »), y compris un blocage **importé par iCal depuis un autre canal**. Voir « Fermeture »
    plus bas : c'est le nœud du sujet.
13. Un sondage tiers en iframe peut recouvrir le calendrier ; retirer l'iframe surdimensionnée du DOM
    le fait disparaître sans toucher aux données.
14. **La fenêtre de réservation peut annuler tout le travail sans rien afficher d'anormal.**
    `Disponibilités → Fenêtre de réservation` limite l'anticipation, par canal, et vaut 180 jours par
    défaut. Une saison N+1 parfaitement configurée est alors **invendable** : le devis client renvoie
    `0,00 €`, exactement comme des dates indisponibles. Maximums : Lodgify 720, Airbnb 365,
    Booking 360, Vrbo hérite de Lodgify. **Choisir la valeur qui s'arrête à l'intérieur d'une période
    fermée**, sinon on ouvre à la réservation des dates que la grille ne couvre pas encore, au prix de
    base. La section s'édite par son menu « ⋮ → Modifier » ; les `<select>` par canal n'existent dans
    le DOM qu'une fois ce panneau ouvert.
15. **Un prix forcé sur le calendrier bat la saison, en silence.** L'API
    `/api/availability/calendar/<rentalId>?periodStart=…&periodEnd=…&includePrices=true` le dit
    franchement (`isOverride: true`) ; le calendrier ne le signale que par une teinte bleue. Le
    supprimer : sélectionner le premier jour, puis le dernier, puis **« Supprimer le tarif
    spécifique »**. La sélection **ne peut pas enjamber une réservation existante** — découper la
    plage autour. Les nuits déjà vendues gardent leur prix forcé et c'est sans conséquence.
16. **La sélection de plage ne marche pas dans la vue Mois** (les `data-testid` `week.N.day.M` sont
    ceux d'une liste virtualisée qui tourne, donc trompeurs). Utiliser la **vue Année**, dont les
    identifiants `single-calendar.year.grid.month.<M>.day.<D>` sont stables et lisibles.
17. **La légende du sélecteur de dates ment pendant la navigation** : elle retarde de plusieurs mois
    sur la grille, donc une boucle « clique tant que la légende ≠ cible » part très loin. Déterminer
    le mois affiché en comptant les `aria-label` des cellules et en prenant le mois majoritaire.
    À l'inverse, `element.click()` en JS **fonctionne** sur les flèches ; c'est seulement la relecture
    qui est asynchrone.
18. Une saison accepte **plusieurs plages de dates** : ajouter les dates de l'année suivante à la
    saison existante plutôt que d'en créer une nouvelle — le prix, le supplément voyageur et les
    minimums sont déjà bons.

---

## Abracadaroom — administré via Unic Stay / HostRider

Marketplace d'hébergements insolites, commission **20 %**. Console : `admin.unicstay.com`.

| Écran | URL |
|---|---|
| Accueil | `admin.unicstay.com/fr/p/<propId>/d/<destId>/home` |
| Hébergements | `…/services/listing` — titre dans `…/services/<serviceId>/general` |
| Calendrier & tarifs | `…/calendar` — création groupée : `…/calendar/create-many` |

Domaine Solio : propId **2274**, destId **2439**, Lodge = service **5912**.
Annonce publique : `abracadaroom.com/fr/reservation-domaine-solio-…-lodge-6567/`.

**Pièges**

1. **La case « Appliquer à tous les hébergements » se déclenche si on clique le libellé** d'une case
   d'hébergement au lieu de sa case. Toujours cliquer le `.check`, puis relire l'état avant d'enregistrer.
2. **Il y a deux jeux de cases identiques** : celles d'affichage (filtre du calendrier, sans effet) et
   celles d'application. Les distinguer par leur section, pas par leur position.
3. **« Le tarif est pour X personnes » se pré-remplit tantôt à 0, tantôt à la capacité (5).**
   Toujours le forcer explicitement à 2.
4. **La remise de durée ne porte QUE sur l'hébergement, pas sur le supplément voyageur.** Un séjour de
   3 nuits à 3 personnes affiche donc −31 % et non −33 % : 33 % de 846 € et non de 903 €. C'est
   l'inverse de Lodgify. Conséquence : on encaisse un peu plus que la recette dès qu'il y a des
   voyageurs supplémentaires — sens acceptable puisque la cible nette prime, mais à savoir.
5. **Une promotion peut contenir plusieurs paliers** (« Ajouter une remise ») et expose un choix
   explicite **« Additionelle » / « Globale »** : prendre **Globale** pour que la remise porte sur tout
   le séjour et ne se cumule pas.
6. **Le supplément d'occupation distingue adulte, enfant et bébé** — plus fin que les autres. Mettre
   bébé à 0 € : la recette ne compte pas les bébés comme occupants.
7. **Une période parasite reste dans le formulaire** après une création : la supprimer par sa croix,
   sinon on bloque ou tarife des dates non voulues (une fois : aujourd'hui et demain).
8. **Le sélecteur de dates a des listes mois ET année** — de loin le plus rapide des trois pour aller
   dans une année lointaine.
9. **L'annonce plafonne le nombre d'adultes** (ici 3, alors que le logement accueille 5) : les places
   restantes ne sont ouvertes qu'aux enfants et bébés. Réglage d'annonce, indépendant des tarifs.
10. Le devis client ne s'obtient qu'en pilotant le widget : cliquer le champ « Date d'arrivée »
    (`div.form-control.search-control`), puis les `li` non `.closed` du calendrier, puis « Valider »
    pour les voyageurs. Le bandeau affiche prix barré, badge de remise et total.

---

## GreenGo — le mieux conçu des trois

Commission **14,5 %**. Console : `greengo.voyage/service-provider-portal`.

| Écran | URL |
|---|---|
| Annonces | `/service-provider-portal/annonce` |
| Infos générales (titre, 100 signes) | `/service-provider-portal/annonce/<annonceId>/general-information` |
| Tarification du logement | `/service-provider-portal/annonce/accommodation/<logementId>/tarification` |
| Calendrier | `/service-provider-portal/calendar/host-calendar/<logementId>` |
| Devis client | `greengo.voyage/hote/<slug>?checkIn=…&checkOut=…&numberOfAdults=N&numberOfChildren=0&numberOfBabies=0&numberOfPets=0&selectedAccommodationProductSlug=<logement-slug>` |

Domaine Solio : annonce Lodge **58dbf98b-8524-4ee9-804e-5f7f03d5d957**, logement
**e05779b2-942b-4666-a534-967f295a1566**, slug logement `aventura-lodge-tente`.

**Points forts et pièges**

1. **La page Tarification affiche le prix client ET tes revenus côte à côte.** C'est le meilleur
   contrôle disponible de toute la grille : saisir 188 € montre 161,68 € net, à comparer directement à
   la cible de 160 €. S'en servir systématiquement pour valider les calculs.
2. **Les paliers de dégressivité sont sur la page Tarification**, pas dans le calendrier, avec des
   seuils 2 à 6 jours puis « À la semaine (1 semaine) » = 7 nuits. Les `<select>` sont masqués mais
   `browser_select_option` fonctionne dessus.
3. **Les « ensembles de règles » du calendrier portent d'autres réductions** (durée, jours de semaine)
   et **elles se cumulent** avec celles de la page Tarification — attention au doublon.
4. **Le prix par période se pilote entièrement par l'URL** — c'est la découverte qui débloque tout.
   `…/calendar/host-calendar/<logementId>?startDate=AAAA-MM-JJ&endDate=AAAA-MM-JJ` ouvre le panneau
   sur la plage voulue, sans toucher au calendrier. Ensuite, en quatre gestes :
   **un vrai `browser_click` sur le `<div>` qui affiche le prix** (il n'y a aucun `<input>` dans le
   DOM avant ce clic : le composant matérialise son champ au clic, et seulement sur un événement de
   confiance), puis `browser_type` la nouvelle valeur, puis le premier bouton **« Enregistrer »**
   visible. La page affiche au passage tes revenus nets — à comparer à la cible avant d'enregistrer.
   *(Cet écran passait pour non automatisable : il ne l'est pas, il exige juste un clic réel.)*
5. **Les « Services supplémentaires » sont un piège coûteux.** Ménage, linge de lit et linge de
   toilette peuvent être en « supplément obligatoire » et s'ajoutent au devis même à deux voyageurs —
   46 € ici, invisibles depuis les autres écrans. Pour un tarif tout compris, les passer en
   « Inclus dans le prix de base » (ce que GreenGo recommande lui-même). Le petit-déjeuner reste une
   option payante légitime.
6. **La taxe de séjour est un forfait par adulte et par nuit** (5,50 €), collecté par la plateforme —
   modèle différent du pourcentage sur le HT de Lodgify. Ne pas chercher à les faire coïncider.
7. **Le devis client se pilote entièrement par l'URL** une fois le `selectedAccommodationProductSlug`
   connu — le chemin le plus rapide des trois. Le détail n'apparaît qu'après avoir sélectionné le
   logement.
8. **Le « à partir de X € » de l'annonce intègre les suppléments obligatoires.** Il affichait 121 €
   avec les 46 € de frais, et 188 € une fois nettoyé — un bon indicateur de santé de la configuration.
9. Le calendrier charge les mois progressivement : 2027 n'est pas dans le DOM tant qu'on n'a pas
   fait défiler.

---

## La fermeture hivernale — architecture

**Objectif retenu par l'opérateur (2026-08-14) : Lodgify est la source unique, et impose la fermeture
aux autres par son iCal.**

**Obstacle constaté.** Aujourd'hui les blocages circulent dans tous les sens : Lodgify importe un
blocage `channel-calendar` de GreenGo (31/10/2026 → 02/04/2027), GreenGo importe ceux d'Abracadaroom,
de Lodgify et d'Airbnb, etc. Or Lodgify **refuse** de créer une période indisponible qui chevauche un
blocage importé. Résultat : impossible d'y créer 15/10 → 31/03 tant que l'import GreenGo couvre
31/10 → 02/04. Le 2026-08-13 je n'ai donc pu poser que le trou réel, **15 → 30 octobre 2026**.

**Ce qui est vérifié (2026-08-14) :** GreenGo importe *Abracadaroom, Airbnb et Lodgify* ;
Abracadaroom importe, pour la Tente, *Lodgify Tente, AirBnB et GreenGo T*, **synchro toutes les 30
minutes**. Les deux reçoivent donc bien Lodgify — la bascule est techniquement possible. L'hiver
**2027-28 est déjà posé dans Lodgify seul** (15/10/2027 → 31/03/2028) : il n'entrait en conflit avec
aucun import, ce qui confirme que les fermetures des autres canaux ne couvrent que 2026-27.

**Marche à suivre pour basculer proprement**, dans cet ordre :

1. **Supprimer la fermeture à la source sur GreenGo et sur Abracadaroom** (celle d'Abracadaroom,
   15/10/2026 → 31/03/2027, a été créée le 2026-08-13 — elle devra partir aussi).
2. Attendre que les imports iCal se purgent côté Lodgify (synchro horaire).
3. **Créer dans Lodgify les deux périodes complètes** : 15/10/2026 → 31/03/2027 et
   15/10/2027 → 31/03/2028.
4. **Vérifier la propagation là où elle n'est pas garantie** : Airbnb, Booking et Vrbo reçoivent les
   disponibilités par le channel manager, mais **Abracadaroom et GreenGo ne les reçoivent que par
   iCal** — ce sont les deux à contrôler, par un devis client sur une date fermée (attendu : aucun
   prix, dates indisponibles).

**Risque à surveiller pendant l'opération** : entre l'étape 1 et l'étape 3, l'hiver est ouvert à la
réservation sur tous les canaux. Faire les trois étapes d'affilée, pas sur deux jours.
