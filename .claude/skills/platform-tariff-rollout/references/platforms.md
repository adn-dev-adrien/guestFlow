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
1bis. **Booking.com n'honore PAS ces promotions**, même en cochant son canal dans les
   « Restrictions » — Lodgify affiche d'ailleurs l'avertissement « promotion susceptible de ne pas
   s'appliquer […] en raison de restrictions sur certains canaux ». Mesuré le 2026-08-14 : une nuit
   290 €, trois nuits 870 € = 3 × 290. Airbnb, lui, applique bien la remise. **Corriger une note
   antérieure de ce fichier qui affirmait le contraire.** Le seul correctif possible est une remise
   longue durée créée dans l'extranet Booking. **Toujours tester 1 nuit puis N nuits sur chaque
   canal** : c'est la seule façon de voir qu'une dégressivité n'est pas appliquée.
2. **« Prix par durée du séjour » n'exprime pas une dégressivité** : il demande un prix total fixe en
   euros, pas un pourcentage, et Booking ne le supporte pas. Utiliser les **Promotions**
   (pourcentage + « Durée de séjour minimum »), dont les « Restrictions » cochent les quatre canaux —
   **Booking compris**, contrairement à la doc publique de Lodgify.
2bis. **`stayDates` est un TABLEAU, et Lodgify exige que le séjour tienne ENTIÈREMENT dans une des
   fenêtres.** Le formulaire n'en laisse saisir qu'une à la fois, mais l'API en accepte plusieurs, et
   c'est ce qui permet de **soustraire des nuits à la dégressivité** sans multiplier les promotions :
   cinq paliers × cinq fenêtres suffisent. Mesuré le 2026-08-28 sur le Gîte — un séjour 20→23/12
   (dans la fenêtre) reçoit bien −20 %, un séjour 23→26/12 (à cheval sur le 24-25) n'en reçoit
   **aucune** et sort à 2 319 €, le plein tarif. C'est la seule façon connue de protéger des nuits
   vendues en mode `fixed` par la recette, puisque toutes les plateformes remisent le total du séjour.
2ter. **Un PUT sur une promotion la DÉTACHE de l'hébergement** (`isBound` retombe à `false`,
   `propertyId` à `null`), même en renvoyant l'objet lu tel quel, et même en forçant ces deux champs.
   Le rattachement est une opération distincte que seul le bouton « Ajouter » de
   `pricing/<id>/assign-promotion` sait faire. **Après tout PUT sur une promotion, relire
   `?onlyBound=true` et rattacher.** Payé le 2026-08-28 : les cinq paliers du Gîte se sont retrouvés
   orphelins d'un coup, donc plus aucune remise en ligne.
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
12bis. **Une `notification-toast` d'erreur reste posée par-dessus la barre d'actions** et rend
    « Ajouter une saison » inerte — Playwright dit alors « `<html>` intercepts pointer events », ce qui
    envoie chercher un problème de sticky header qui n'existe pas. Retirer les
    `.notification-toast` du DOM, ou recharger, avant de conclure quoi que ce soit sur un bouton.
12ter. **Les dates et codes promo d'une promotion s'affichent SOUS le champ, pas dedans.** Lire
    `.value` du `date-picker-input` renvoie toujours `''`, y compris quand une plage est posée : le
    « Séjour de 4 nuits » du Gîte a gardé un code `CALINS10` et une fenêtre janvier-avril invisibles
    pendant toute une passe de vérification. **Contrôler par l'API, jamais par le formulaire.**
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

## Airbnb, Booking, Vrbo — les canaux nourris par Lodgify

Ils n'ont pas de console à configurer : Lodgify y pousse prix et disponibilités. **Ils se vérifient
donc uniquement sur leur page publique**, et c'est là que les surprises apparaissent.

| Canal | Identifiants relevés le 2026-08-14 | Page publique |
|---|---|---|
| Airbnb | annonce **1576845044615216441** | `airbnb.fr/rooms/<id>?check_in=AAAA-MM-JJ&check_out=…&adults=N` |
| Booking | hôtel **15343212**, chambre 1534321201 | `booking.com/hotel/fr/tente-domaine-solio.fr.html?checkin=…&checkout=…&group_adults=N#availability` |
| Vrbo / Abritel | propriété **123465737**, unité 327755592, annonce **AB 2622643**, clé composite **731.2622643.2799576** | `abritel.fr/location-vacances/p2622643` |

Les identifiants se lisent dans `app.lodgify.com/channels/manager/<canal>`, colonne « Hébergement
sur … ». La page Booking se trouve sinon par une recherche sur le nom de l'annonce.

**Lire le prix**
- **Airbnb** : cliquer le total (`button[aria-haspopup="dialog"]` contenant « au total ») ouvre
  « Détail du prix ». Il affiche le **prix moyen après remise** (« 3 nuits x 178,67 € »), jamais le
  prix de saison : ne pas conclure trop vite que la grille est fausse. Deux modales à écarter d'abord
  (traduction, cookies).
- **Booking** : ajouter `#availability` à l'URL et lire `#hprt-table`. Booking affiche plusieurs plans
  tarifaires (5 ici, de 290 à 344 € la nuit) ; **le premier est le moins cher**, c'est celui à relever.
  Tout est « taxes et frais compris », donc non comparable tel quel à un hébergement seul.

**Le titre est une promesse contractuelle — le relire comme un voyageur pressé.** Le 2026-08-17, une
cliente a annulé son séjour parce qu'elle croyait pouvoir venir avec son animal. **Aucun canal
n'acceptait les animaux** : le réglage était juste partout. C'est le **titre Booking**,
« Aventura Lodge isolée, nature, **animaux** », qui mentait — répété dans les résultats de recherche,
l'onglet du navigateur, les avis et un bandeau « Les animaux seront vos plus proche voisins ». Le mot
désignait les animaux de la ferme ; le voyageur lit « animaux acceptés ».

Règle : **un mot du titre qui peut se lire comme un service offert au voyageur doit être désambiguïsé
par le concret.** GreenGo écrivait « ânes et chèvres » et n'a jamais posé de problème ; c'est la
formulation retenue partout le 2026-08-17. Vérifier aussi le **nom Lodgify du Gîte**, qui portait le
même piège (« Confort, Nature & Animaux »).

**Où se règle la politique animaux, par canal** (tous relevés « non acceptés » le 2026-08-17) :

| Canal | Écran | Forme |
|---|---|---|
| Lodgify | `rental/<id>/overview` → Équipements de l'hébergement | case « Animaux acceptés », **décochée** |
| Airbnb | `hosting/listings/editor/<id>/details/house-rules` | « Animaux acceptés » ✗ / ✓ |
| Booking | `extranet_ng/manage/property_policies.html` | affiché en public sous « Conditions » |
| Abritel | `lodging-supply/settings/rentalpolicy/houserules?propertyId=<id>` | radio « Non, les animaux… » |
| GreenGo | annonce publique | affiche « Animaux non acceptés » en clair |
| Abracadaroom | annonce publique | affiche « ANIMAUX NON ACCEPTÉS » en clair |

**Le réglage ne suffit pas : ce qui compte est ce qui est affiché.** GreenGo et Abracadaroom
l'annoncent en clair ; Booking l'enterre dans « Conditions » ; Airbnb dans le règlement intérieur ;
**Abritel ne l'affiche pas du tout** et la **réservation directe (Lodgify) restait muette**. Le
silence laisse le voyageur supposer. Une ligne dans la description, qui donne la raison plutôt que
l'interdiction, vaut mieux qu'une case cochée : « Nos ânes et nos chèvres vivent en liberté sur le
domaine ; pour leur tranquillité et celle de nos hôtes, les animaux de compagnie ne sont pas
acceptés. »

**Le nom Booking se change seul, sans passer par leurs éditeurs.**
`Établissement` → `Infos sur l'établissement et statut de l'établissement` → « Changer le nom de
l'établissement » : champ libre, aperçu en direct, trois étapes (saisie → « Suivant » → « Changer le
nom de l'établissement »). **À ne pas confondre avec la description**, elle, non éditable.

- **Booking refuse la ponctuation dans un nom d'hébergement.** Relevé le 2026-08-28 en essayant
  d'ajouter trois points de suspension : « Les noms des hébergements ne peuvent pas inclure de signes
  de ponctuation, d'astérisques ou de symboles », et le bouton « Suivant » **se désactive**. Le tiret
  et les virgules, eux, passent — la règle vise les points, astérisques et symboles.
- **Le délai annoncé est « sous 24 heures maximum »**, pas immédiat comme noté auparavant. Le nom
  change tout de suite dans l'extranet (onglet, en-tête) ; c'est la page publique qui attend.
- **L'aperçu montre trois lignes**, et seule la première est le titre : titre, puis note client
  (« 9,0 Fabuleux »), puis **la localité de l'adresse**. Ne pas confondre les deux dernières avec le
  nom qu'on est en train d'écrire.

**L'adresse, elle, n'est PAS en libre-service.** `Infos sur l'établissement` affiche
« Adresse de l'établissement » **sans aucun bouton de modification** — le nom en a un, l'adresse non —
et le sous-menu `Établissement` n'a pas d'entrée adresse (Note de qualité, Score de la page, Infos sur
l'établissement, TVA taxes et frais, Photos, Conditions de l'établissement, Conditions de réservation,
Équipements et services, Hébergements, Détails des hébergements). Elle passe donc par
`request_change.html`, comme la description. **Sujet ouvert au 2026-08-28** : les deux hébergements
affichent « Japperenard » — le lieu-dit — là où le voyageur attend « Satillieu ». Personne ne cherche
Japperenard.

**Titre du Gîte corrigé le 2026-08-28** : « Domaine Solio - Gite confort, nature, **animaux** » →
« … **ânes et chèvres** », la même correction que la Lodge avait reçue le 17 août après l'annulation
d'une cliente. Le Gîte portait encore le mot piégeux.

**Airbnb : la description de Lodgify n'arrive jamais.** Le Channel Manager signale en permanence
« Synchronisé avec les problèmes » → `channels/manager/<rental>/room/<room>/resolve-issues` :
« Raccourcir la description — le résumé doit comporter 500 caractères ou moins ». La description
Lodgify fait 1 743 caractères : elle ne passera jamais. **Airbnb a donc sa propre description, à
maintenir à la main**, et toute phrase ajoutée dans Lodgify doit y être recopiée séparément.
Pire : ses deux champs sont étiquetés « English » et « Français » mais **contiennent tous deux du
français** — écrire dans les deux.

**Le contenu éditorial ne suit pas les prix.** Lodgify pousse les tarifs et les disponibilités, mais
le titre et la description restent propres à chaque plateforme : le titre changé le 2026-08-13 est
arrivé sur Booking et **jamais sur Airbnb**, resté « Domaine Solio : là où la nature est à vous seul ».
Toute reformulation d'annonce se fait donc dans le back-office de chaque canal, un par un.

**Airbnb — les champs de langue peuvent être inversés.** Le titre a un champ par langue ; ici le champ
« Français » contenait la version anglaise et réciproquement, si bien que la page publique française
affichait une traduction automatique. **Toujours lire le contenu de chaque champ, pas seulement son
étiquette.** Limite : 50 caractères par titre, 500 pour « Description du logement » — prévoir une
formulation courte pour ce canal. Corollaire : l'**éditeur** affiche la version anglaise, donc y lire
« Aventura Lodge: 13 ha, alone in the wild, family » ne veut pas dire que le titre français est faux —
le vérifier sur le titre de la page `multicalendar/<id>`, qui rend le français.

**Où trouver quoi, quand la console résiste** (relevé le 2026-08-14) :

| Réglage | Airbnb | Booking | Abritel |
|---|---|---|---|
| Horaires arrivée/départ | `hosting/listings/editor/<id>/details/house-rules` | `extranet_ng/manage/property_policies.html` | `lodging-supply/settings/rentalpolicy/times?propertyId=<id>` |
| Description | `…/details/description` | **non éditable** — voir ci-dessous | `supply/pe/description/headlineDescription?propertyId=<id>` |
| Règlement intérieur | `…/details/house-rules` | `property_policies.html` | `…/rentalpolicy/houserules` |
| Fenêtre de réservation | `multicalendar/<id>/availability-settings` | — | — |

Les URL Airbnb en `…/arrival-guide/checkin-checkout` **n'existent pas** (404) ; les horaires sont dans
`house-rules`. Chez Abritel, tout part de `supply/pe?propertyId=<id>` (« Outil de gestion des
hébergements ») et des « Règles et règlements » atteintes par `rm/settings/protection/l-<clé
composite>`, qui redirige vers `lodging-supply/settings/…`.

**Booking ne laisse pas éditer sa description** : « Votre description est conçue de manière à vous
assurer le plus de réservations possible. Par conséquent, nous ne pouvons pas la modifier sauf en cas
de faute de frappe. » Elle est **générée à partir des équipements déclarés**. Pour y faire figurer une
information commerciale (ce qui est compris dans le tarif), passer par
`extranet_ng/manage/request_change.html` :
- le champ **`fine_print`** (« L'information que vous souhaitez communiquer n'est pas proposée
  ci-dessus ? ») alimente la rubrique publique « À savoir » — c'est le bon endroit ;
- le champ **`room_descriptions`** accepte une demande d'ajout, à rédiger en liste à puces selon leur
  propre exemple (« 1. Veuillez ajouter : … ») ;
- « Demander une modification » ne renvoie **aucun message de confirmation** : la seule preuve est une
  ligne « Content - request change request » horodatée dans `inbox.html`. Toujours aller la vérifier.
- Délai annoncé : traité par leurs éditeurs sous ~6 jours.
- Piège : la case « Serviettes » de `facilities.html` appartient à la section **Piscine** (chaises
  longues, toboggan) — la cocher n'a rien à voir avec le linge fourni.

**Abritel reçoit la description depuis Lodgify.** Contrairement à Airbnb et Booking, le titre **et** le
corps de l'annonce y arrivent par le canal : la phrase « tout compris » écrite dans Lodgify s'y
trouvait déjà, sans intervention. Vérifier plutôt que corriger.

**La commission Abritel est de 15 %, pas 13 %.** `p/property-details` annonce la formule
« Performance - 2 (15 % pour chaque réservation) ». La majoration Vrbo de **+5 %** posée dans Lodgify
avait été calculée pour 13 % : à 260 €/nuit en haute saison, trois nuits affichées 522,60 € laissent
444,21 € nets contre une cible recette de 452,25 €, soit **8 € sous la cible par séjour**. Il faudrait
environ **+7,3 %** pour retomber sur la cible. Vérifier la formule tarifaire de chaque canal dans son
back-office avant de figer une majoration — le taux « connu » peut dater.

**Airbnb ne vend qu'à 12 mois.** `multicalendar/<id>/availability-settings` affiche « Plage de
disponibilité : 12 mois en avance », et le réglage est **verrouillé** tant que Lodgify est connecté
(« Vous pouvez modifier les paramètres de disponibilité dans votre logiciel de gestion locative »).
Conséquence directe : la fin 2027 n'est pas réservable sur Airbnb même quand la recette et Lodgify la
couvrent. À reprendre côté Lodgify.

**Recréer la dégressivité dans l'extranet Booking** (échelle complète posée le 2026-08-14) :

1. `admin.booking.com` → le menu **Promotions** ne s'ouvre pas au clic scripté ; lire ses liens dans
   `nav.ext-navigation` **après un vrai `browser_click` sur l'entrée du menu** — sinon la nav ne
   contient que « Accueil » et « Réservations ». Les trois URL utiles :
   `promotions/list.html` (les promotions actives), `promotions/marketplace.html` (en choisir une),
   `promotions/setup.html?hotel_id=<id>&product=BASIC_DEAL` (« Offre Standard », la seule
   personnalisable). `promotions.html` et `promotions/index.html` renvoient 404.
2. Renseigner `#usp-discount-action` (le %), `#promotion-name-usp-promotion-name` (nom interne).
3. **La date de fin : format ISO, et le champ doit d'abord être ouvert.** Écrire `31 déc. 2027`
   n'entre pas dans l'état de l'application, mais **`2027-12-31` oui** — à condition d'avoir cliqué
   `#to-date` d'abord (le picker doit être monté). Un `fill()` sur un champ jamais ouvert passe
   silencieusement : le champ affiche la nouvelle date et le récapitulatif garde l'ancienne.
   **Toujours relire « Votre réduction s'appliquera aux séjours effectués aux dates suivantes »
   avant de valider** — c'est ce récapitulatif qui a rattrapé le palier 4 nuits.
   Ne **jamais** essayer de naviguer le calendrier aux flèches : il est mono-mois, les clics scriptés
   l'emballent (parti à septembre 2034), et l'entête lue en haut de page est celle du champ « Du : »,
   donc une boucle de convergence ne converge jamais.
4. « Durée de séjour → Modifier » → radio `#select_los` → `#min-length-of-stay-value` →
   « Enregistrer les modifications ». Le libellé doit ensuite afficher « Séjour de N nuits minimum ».
5. « Vérifier » ouvre un récapitulatif complet, puis « Activer ».
6. **« Créer une promotion similaire » ne clone rien** : le formulaire revient vierge (10 %,
   « Basic Deal », fin à +3 mois). Refaire les 5 étapes à chaque palier.

**Le point qui rend l'échelle possible** : le formulaire annonce « en cas de promotions non cumulables
applicables, **seule la réduction la plus importante** est affichée aux clients ». Une échelle
croissante (2 n → 24 % … 7 n → 45 %) s'auto-sélectionne donc, exactement comme sur Lodgify — il faut
une promotion par palier.

### Protéger une nuit de la dégressivité sur Booking : FERMER le plan dérivé sur cette date

Trouvé et **prouvé par devis public le 2026-08-29**. Le prix d'un plan dérivé ne peut pas être forcé
— son panneau le dit : « Pour changer les montants de ce tarif, mettez à jour Peu flexible ». Mais il
peut être **ouvert ou fermé par date**, et **un plan fermé sur une seule nuit du séjour n'est plus
proposé pour ce séjour** : le voyageur retombe sur le tarif standard, au plein tarif.

Mesuré sur le Gîte, séjour 23→26/12/2026 (Haute + Noël + Noël), après fermeture du seul palier
« 3 nuits » le seul 24/12 :

| | Prix public |
|---|---:|
| Avant | **2 047 €** (palier 3 nuits, −20 %) |
| Après | **2 557 €** (tarif standard) |

2 550,90 € d'hébergement + taxe. Net après 15 % : 2 168 € contre un plancher de 2 088,80 € — **+79 €**.

**Le chemin** : `Tarifs et disponibilités → Calendrier`, amener la plage voulue **par le sélecteur de
dates, jamais par l'URL**, puis cliquer la cellule du plan dérivé à la date visée. Les cellules
portent `data-test-id="cell-AAAA-MM-JJ"` et `data-dns="AAAA-MM-JJ"`, la ligne se reconnaît au nom du
plan. Le panneau offre `OPEN`/`CLOSED` ; valider avec `[data-test-id="submit-cta"]`.

**Trois pièges.**
- Le calendrier **n'affiche aucun marqueur visible** pour une date fermée : le prix reste affiché à
  l'identique. Le seul contrôle fiable est de **rouvrir la cellule et relire le radio**, ou de quoter
  la page publique.
- **Le panneau précédent (`#bulk-popover`) reste ouvert et intercepte les clics suivants.** Presser
  `Échap` entre deux cellules, sinon la deuxième ne s'ouvre jamais.
- La page publique **met quelques minutes à propager** : un premier devis juste après
  l'enregistrement montre encore l'ancien prix. Recharger avant de conclure à un échec.

Le levier vaut **par plan et par date** : protéger 24-25/12 et 31/12 sur deux années demande
5 plans × 6 dates = 30 fermetures.

### Les plans tarifaires dérivés — relevé d'exécution du 2026-08-28

Les cinq paliers du Gîte ont été créés et vérifiés ce jour-là. Ce que le terrain a appris :

1. **Les neuf étapes tiennent sur UNE page, pas dans un assistant.** Six réglages sont déjà bons par
   défaut : Repas Non, « À tout moment », « En fonction de l'un de mes plans existants »,
   « Peu flexible », « Moins cher que », unité `%`, et l'hébergement coché. **Seuls quatre gestes
   sont nécessaires** : la politique d'annulation, la durée minimum (Oui + valeur), le montant, le nom.
2. **L'annulation est un piège réel** : « Flexible - 21 jours » est coché à l'ouverture. Le plan
   standard est à « Flexible - 14 jours » — un palier qui change aussi la politique n'est plus une
   remise de durée mais un autre produit.
3. **La réduction n'accepte AUCUNE décimale.** Le champ est un `input[type=number]` `min=1 max=99`
   sans `step` ; saisir `42.86` fait répondre « Les deux valeurs valides les plus proches sont "42"
   et "43" ». Donc **42**, jamais 43.
4. **Le champ « durée minimum » naît à `2`** quand on répond Oui : l'écraser, sinon le palier
   doublonne le plan standard.
5. **Le menu du plan de base ne propose QUE le plan standard** — on ne peut pas dériver d'un dérivé.
6. **Booking re-catégorise un plan de 7 nuits en « À la semaine ».** C'est une étiquette, pas le type
   intégré : le détail ne montre aucune durée maximum, la colonne Tarif reste « 42 % moins cher que
   le tarif Peu flexible », et le calendrier lui donne son prix dérivé. **Le plafond de 27 nuits ne
   s'applique pas.**
7. **Le filtre « Restrictions » du calendrier revient à OFF à chaque chargement.** Sans lui, les
   lignes « Durée de séjour minimum » sont invisibles et le contrôle ne prouve rien. Sa case est
   interceptée par son label : cliquer `label[for="grid-filter-RESTRICTIONS"]`.
8. **Lire le calendrier par le DOM, pas par `innerText`.** Chaque ligne est un `.av-cal-list-grid` de
   32 enfants : le premier est l'étiquette, les 31 suivants les dates. Le découpage par texte fait
   déborder le premier prix d'une ligne dans la précédente.
9. **Les boutons du catalogue « Ajouter un plan tarifaire » sont des `<a>`, pas des `<button>`.»
   « Option personnalisable » est le dernier des sept.

**Preuve que la dégressivité est vivante** (2026-08-28, mois affiché) : tarif standard 367,40 €
poussé par Lodgify, et les cinq plans dérivés cotent 293,92 / 257,18 / 235,14 / 220,44 / 213,09 € —
exactement ×0,80 / 0,70 / 0,64 / 0,60 / 0,58, **sans aucune intervention côté canal**. Les six lignes
« Durée de séjour minimum » du calendrier lisent 2 / 3 / 4 / 5 / 6 / 7, chacune constante sur le mois :
le standard n'a pas bougé de 2.

**Identifiants** : Gîte = hôtel `14407976`, plan standard `57972851`, paliers `68725154` (3 n),
`68725190` (4 n), `68725222` (5 n), `68725254` (6 n), `68725290` (7 n et +).
Page publique du Gîte : slug `gite-a-la-ferme-domaine-solio`.

### Piloter l'extranet Booking : ne jamais taper une URL

**Relevé le 2026-08-28.** Les pages de `admin.booking.com` portent un jeton de session dans leur
URL (`?ses=<32 hexa>`). **Naviguer vers une URL construite à la main — même correcte, même avec le
bon `hotel_id` — déconnecte la session** et renvoie sur `account.booking.com/sign-in`. Il faut alors
que l'opérateur se reconnecte, et le jeton change.

Conséquence pratique : dans cet extranet, **on ne se déplace qu'en cliquant les liens de la page**.
Les URL notées ici servent à reconnaître un écran, pas à y aller. **Recopier le `ses=` de la page courante ne suffit PAS.** Refait le 2026-08-29 avec un jeton lu
à la seconde d'avant, sur la même page : déconnexion immédiate. Le jeton n'est pas la seule
condition — Booking valide aussi la façon dont on arrive sur la page. **Il n'y a pas d'exception :
dans cet extranet, on ne se déplace QU'EN CLIQUANT.** Pour changer les dates affichées du
calendrier, utiliser son sélecteur de plage (un champ au format `AAAA-MM-JJ — AAAA-MM-JJ` qu'on
ouvre au clic, puis deux clics sur les cellules `aria-label="<jour> <n> <mois> <année>"`), jamais
les paramètres `from=`/`until=` de l'URL, qui pourtant apparaissent dans la barre d'adresse.

### Contrôle obligatoire avant et après tout déploiement : le minimum de séjour

**Consigne de l'opérateur, 2026-08-28 : « il faut que tu vérifies qu'on est bien à 2 nuits minimum et
pas plus ».** Un minimum trop haut ne produit aucune erreur — il rend simplement invendables les
dates concernées, et rien ne le signale. C'est le même mode de panne que la fenêtre de réservation
(piège 14) : le devis client répond comme des dates indisponibles.

**L'enjeu est chiffré.** Sur le Gîte, les séjours de deux nuits sont **6 des 15 réservations Gîtes de
France, les 2 de Booking et celle de GreenGo**. Un minimum passé à 3 efface cette demande-là.

**Côté recette, c'est vérifiable et vérifié.** Les six saisons de `gite-2027` déclarent toutes
`minNights: 2`, et seulement **2,1 % de l'année** porte un minimum supérieur — les blocs de ponts à
3 nuits, voulus et datés. Jamais plus de 3. Un contrôle qui remonterait 4, 7 ou 14 quelque part vient
forcément de la plateforme, pas de la recette.

**Deux choses portent le même nom, et il faut les tenir séparées.**

- Une **restriction de séjour** interdit de réserver moins de N nuits à une date. Elle BLOQUE. C'est
  ce que porte le plan standard : 2 nuits, plus 3 sur les blocs de ponts.
- La **durée minimum d'un plan tarifaire** conditionne seulement l'ÉLIGIBILITÉ à ce prix — le
  formulaire dit « durée de séjour minimum **pour ce plan tarifaire** ». Elle ne bloque rien : un
  client qui veut 2 nuits ne voit pas le plan « 3 nuits et + », il voit le plan standard à son prix
  plein. Le calendrier le confirme, chaque plan ayant sa propre ligne « Durée de séjour minimum »
  avec son identifiant de tarif.

**Donc les paliers 3 à 7 nuits des plans dérivés n'obligent personne à rien.** Le danger est unique et
précis : **qu'un de ces minimums atterrisse sur le plan STANDARD**. Là il ne remiserait rien et
supprimerait d'un coup toutes les réservations de deux nuits.

**Vérification après chaque création de plan** — `Tarifs et disponibilités` → `Calendrier`, déplier
les plans : le plan standard doit toujours afficher `2` sur toutes les dates, et le nouveau plan doit
apparaître dans **sa propre ligne**. Si le minimum du nouveau palier s'est écrit dans la ligne du plan
standard, tout défaire avant d'aller plus loin.

**Où lire le minimum, canal par canal** :

| Canal | Écran | Forme |
|---|---|---|
| Booking | `Tarifs et disponibilités` → `Calendrier`, déplier le plan tarifaire | ligne « Durée de séjour minimum », une case par date |
| Lodgify | `Tarifs` puis chaque saison | minimum par saison |
| GreenGo | page Tarification du logement | minimum par palier |
| Abracadaroom | calendrier / création groupée | minimum par période |

**Relevé le 2026-08-28 sur le Gîte (Booking, plan 57972851)** : `2` sur les 31 dates du mois affiché.
Conforme.

### La dégressivité sur Booking passe par un PLAN TARIFAIRE, jamais par une promotion

**Cause trouvée le 2026-08-28.** Une promotion — poussée par Lodgify ou créée dans l'extranet en
« Basic Deal » — se place **au-dessus** du tarif. Sur un hébergement dont les prix arrivent d'un
gestionnaire de canaux, Booking ne consulte pas cette couche : sa propre documentation dit que les
promotions n'atteignent un tel hébergement que par un prestataire ayant intégré l'**API Promotions**,
ce que Lodgify n'a pas fait pour ce type d'offre. Les six paliers du 14 août ne pouvaient pas
fonctionner ; ce n'était pas un réglage raté, c'était la mauvaise couche.

**Ce que Booking honore : un plan tarifaire supplémentaire**, dont le prix dérive du tarif standard
poussé par Lodgify et qui porte sa propre durée minimum. La documentation est explicite : le
gestionnaire met à jour le tarif standard, et *« vos tarifs dérivés sont mis à jour depuis votre
tarif de base »*.

**Chemin** : `admin.booking.com` → **Tarifs et disponibilités → Plans tarifaires → Ajouter un
nouveau plan tarifaire**. **Ce n'est pas réservé à un gestionnaire de compte** — une note antérieure
issue d'une doc hôtelière l'affirmait, c'est faux pour un meublé : l'hôte crée le plan lui-même.
Booking propose deux types intégrés, **Hebdomadaire** (s'affiche pour les recherches de **7 à 27
nuits**) et **Mensuel** (**28 nuits et plus**), tous deux exprimés en pourcentage de remise sur le
tarif quotidien le moins cher. Pour les paliers intermédiaires, créer un plan par palier et lui poser
sa durée minimum.

**Procédure relevée dans l'extranet le 2026-08-28** (Gîte, hôtel `14407976` ; Lodge `15343212`).
Le Gîte n'avait qu'UN plan tarifaire : « Peu flexible », ID 57972851, annulation « Flexible -
14 jours », colonne Tarif = **« Mappage à partir de Lodgify »**. C'est le plan standard, celui que le
gestionnaire de canaux possède.

`Tarifs et disponibilités` → `Plans tarifaires` → **« Ajouter un plan tarifaire »** ouvre un
catalogue à trois sections :

| Section | Types proposés |
|---|---|
| Posez vos bases | Peu flexible *(déjà ajouté)*, Non remboursable |
| Attirez différents types de clients | **À la semaine** (« séjours de plus d'une semaine »), **Au mois** (« au moins 28 nuits »), Réservation anticipée |
| Personnalisez un plan tarifaire | **Option personnalisable** |

**L'option personnalisable fait exactement ce qu'il faut**, en neuf étapes :

1. Conditions d'annulation — Flexible 21 j / Flexible 14 j / Non remboursable. **Choisir celle du
   plan standard** (ici Flexible 14 j) : le défaut proposé est 21 j, et un palier de durée qui
   change aussi la politique d'annulation n'est plus une remise de durée, c'est un autre produit.
2. Repas — Non.
3. Avantages — aucun.
4. **« Souhaitez-vous fixer une durée de séjour minimum ? » → Oui + la valeur.** C'est le point qui
   restait à vérifier : **la durée minimum est libre**, donc les paliers 3, 4, 5 et 6 nuits sont
   faisables, pas seulement la semaine et le mois.
5. Délai avant l'arrivée — À tout moment.
6. **« Comment gérer ce plan ? » → « En fonction de l'un de mes plans tarifaires existants » → « Peu
   flexible ».** Booking l'explique lui-même : *« Le tarif sera basé sur Peu flexible, duquel sera
   déduite toute réduction configurée dans l'étape suivante. […] **Il n'est pas nécessaire de
   modifier les tarifs, d'indiquer des disponibilités ou encore d'ajouter le tarif dans votre Channel
   Manager.** »* C'est la confirmation, écrite par la plateforme, que le plan dérivé suit le tarif
   poussé par Lodgify sans aucune intervention côté canal.
7. **« Moins cher que le tarif Peu flexible » + le montant + le sélecteur `%` / `€`** — le
   pourcentage est disponible, c'est ce qu'il faut.
8. Hébergements concernés — cocher le logement.
9. Nom du plan — **référence interne, invisible pour le client**. Puis « Vérifier ».

**Le piège structurel : la limitation XML.** Pour tout plan tarifaire AUTRE que le standard, aucune
condition de réservation ne transite par la connexion du gestionnaire de canaux. **Durée minimum,
durée maximum et jours d'arrivée/départ d'un plan secondaire se règlent à la main dans l'extranet**,
et ne s'y maintiennent pas tout seuls. Le prix, lui, suit le tarif standard.

**Deux règles qui en découlent** :
- **Ne jamais modifier le tarif standard à la main dans Booking** — Lodgify en est propriétaire, et
  une saisie manuelle sera écrasée à la synchro suivante, ou pire, la bloquera.
- **Supprimer les plans périmés** avant d'en ajouter : d'anciens plans non mappés créent des conflits
  de synchronisation. Et **désactiver les six « Basic Deal » du 14 août**, qui ne font rien et
  brouillent la lecture.

**Si les réglages avancés d'un plan ne sont pas disponibles**, ils s'activent sur demande au support
Booking — c'est le seul moment où passer par eux est nécessaire.

**La seconde voie, plus puissante et plus tranchante : le LOS pricing.** Booking accepte qu'un
prestataire envoie le **prix total explicite de chaque durée de séjour jusqu'à 90 nuits**
(`developers.booking.com/connectivity/docs/csv-los_pricing`). Il reproduit n'importe quelle courbe au
centime, mais **il n'existe aucun prix par nuit par défaut : toute durée non déclarée devient
non réservable**. Et il faut que Lodgify supporte ce modèle — non vérifié. Les plans tarifaires
d'abord ; le LOS pricing seulement si Booking refuse les plans.

**Ces promotions ne s'appliquent PAS — constat définitif du 2026-08-17.** Les six paliers, créés le
14 août, toujours affichés « Activée(s) » trois jours plus tard (publics, tous les jours, tous les
plans tarifaires, séjours 14/08/2026–31/12/2027), n'ont **jamais** été appliqués sur la page
publique :

| Séjour | Palier | Attendu | Affiché le 14/08 | Affiché le 17/08 |
|---|---|---|---|---|
| 24→26 août, 2 nuits | −24 % | 386,84 € | 509 € | **509 €** |
| 24→30 août, 6 nuits | −43 % | 870,39 € | 1 486 € | — |

Trois jours écartent l'hypothèse du délai de propagation. **Conclusion : Booking n'applique pas ses
promotions aux tarifs poussés par un gestionnaire de canaux.** Ni la table de Lodgify ni les
promotions natives ne donnent de dégressivité sur ce canal — c'est un arbitrage commercial à porter
(accepter Booking sans dégressivité, ou lui pousser une grille déjà dégressive depuis Lodgify), pas
un réglage à trouver. Le simulateur « Simuler la réduction maximum » de l'extranet ne sert à rien
pour ça : il est générique et n'interroge pas les tarifs réels. `curl` ne convient pas non plus
(protection anti-bot) : passer par le navigateur.

---

## Deux agents dans le MÊME navigateur — ce qu'il faut savoir avant d'essayer

Relevé le 2026-08-28, en faisant tourner GreenGo et Booking en parallèle.

**Le danger n'est pas théorique et il n'est pas bénin.** L'onglet actif bascule entre quasiment
chaque appel d'outil. Trois écritures ont été arrêtées par la garde « relire l'URL avant de
cliquer » — dont une où l'onglet actif était « Plans tarifaires » de Booking : un
`button.btn-primary:has-text("Enregistrer")` y aurait cliqué **Enregistrer chez Booking**.
**Le libellé « Enregistrer » n'est pas discriminant entre deux back-offices**, donc l'idée qu'une
action mal synchronisée « échouerait faute de sélecteur » est FAUSSE. Ne pas s'en contenter.

**La parade robuste : piloter une POIGNÉE DE PAGE, pas « l'onglet courant ».**
Avec `browser_run_code_unsafe`, `page.context().pages().find(p => p.url().startsWith(BASE))` rend un
objet page ; tous les `goto`/`click` faits dessus ignorent la sélection d'onglet. L'autre agent peut
basculer autant qu'il veut, ça n'atteint plus. C'est ce qui a permis de traiter 25 plages GreenGo
par lots sans une seule collision. **À faire dès qu'on lance deux agents navigateur.**

**Garde de dernier recours** : vérifier les libellés du panneau (« À partir de… » / « Jusqu'au… »),
pas seulement l'URL. Ils prouvent que le panneau est lié aux dates visées ; l'URL peut être bonne
alors que le panneau n'a pas suivi.

---

## GreenGo — les remises d'un ensemble de règles REMPLACENT celles de l'annonce

Mesuré le 2026-08-29, et **cela corrige une note antérieure de ce fichier**. Protocole : un séjour de
3 nuits en mars 2027, 1 011 € brut, remise annonce 20 % → 816 €. Un ensemble de règles portant **20 %**
appliqué sur ces dates : total **inchangé à 816 €** — indécidable, les deux valeurs étant égales. Le
même ensemble passé à **50 %** : total **513 €**, soit −506 € = 50,05 %. Un cumul aurait donné 60 %
(1 − 0,8 × 0,5) ou 70 %. **C'est un remplacement.**

> Leçon de méthode : un test dont les deux branches produisent le même nombre ne prouve rien. Choisir
> une valeur qui **discrimine** — ici 50 % contre 20 %.

**Le remplacement n'opère QUE si l'ensemble porte ses propres remises.** Un ensemble *sans* palier
laisse passer ceux de l'annonce — mesuré le 2026-08-29 : l'été 2027 portait « Très haute saison —
4 nuits », un ensemble ne contenant qu'un minimum de nuits, et un séjour de 7 nuits y recevait
malgré tout les 42 % de l'annonce (3 388 € → 1 982 €). Ne jamais lire « un ensemble est appliqué »
comme « les paliers de l'annonce sont neutralisés ».

**Et la remise se calcule NUIT PAR NUIT**, comme Abracadaroom — question restée ouverte jusqu'au
2026-08-29, tranchée par un séjour à cheval. 23→26/12/2026, 3 nuits : le 23 (couvert par l'annonce à
20 %, 399 €) et les 24-25 (couverts par un ensemble à 1 %, 1 062 €). Remise affichée : **−101 €**,
soit exactement `0,20 × 399 + 0,01 × 1 062 × 2 = 101,04`. Ni prorata de durée, ni « tout ou rien » :
chaque nuit prend le taux de la configuration qui la couvre, pour le palier correspondant à la durée
TOTALE du séjour.

**Conséquence : le bon montage est le CREUSAGE, pas le renversement.** Puisque la remise est
nuit-par-nuit et qu'un ensemble ne remplace que là où il s'applique, il suffit de poser un ensemble
« plancher » sur les seules nuits à protéger — 4 courtes plages — au lieu de vider les paliers de
l'annonce et de re-couvrir tout l'horizon segment par segment. Surface de risque incomparablement
plus faible, et rien ne peut « tomber entre » deux segments.

**Deux validations bloquent le formulaire, dans cet ordre** (elles s'affichent en `.text-error-600`,
rien n'est enregistré) :
1. « La réduction minimale est de 1 % » — **0 % est refusé**, donc on ne peut pas annuler
   complètement la dégressivité, seulement la réduire à 1 %.
2. « Les réductions doivent augmenter avec la durée de séjour » — 1/1/1/1/1 est refusé.
   D'où la forme retenue : **un seul palier, « à partir de 3 jours → 1 % »**, qui couvre toutes les
   durées (« à partir de » = seuil) sans avoir à croître. Cinq paliers 1/2/3/4/5 % passeraient aussi,
   mais coûteraient jusqu'à 5 % sur les nuits de fête au lieu de 1 %.

**Le 1 % résiduel mord le plancher : compenser par le prix de la nuit.** À 1 062 €, une nuit de Noël
rendait 913,32 € net ; moins 1 %, 904,19 € — **sous les 908 € de plancher**. La nuit doit valoir au
moins `plancher / (0,99 × 0,86)`, soit 1 067 € pour Noël et 991 € pour le réveillon. Retenus : **1 070 €
et 995 €**, pour garder ~3 € de marge.

Bouton d'enregistrement : `button[form="spp-host-calendar-custom-rules-set-form"]` — `visible=true`
ne suffit pas à le distinguer de « Quitter sans enregistrer ».

**Devis public par URL** : `https://www.greengo.voyage/hote/domaine-solio-gite?checkIn=AAAA-MM-JJ&checkOut=AAAA-MM-JJ&numberOfAdults=2&numberOfChildren=0&numberOfBabies=0&numberOfPets=0`
— le slug de produit n'est pas nécessaire. Le récapitulatif donne prix × nuits, « Réductions », « Total ».

---

## GreenGo — le panneau ment après un enregistrement

**Après une sauvegarde, le panneau replié continue d'afficher l'ANCIENNE valeur.** Relire le prix ou
l'ensemble de règles juste après avoir enregistré renvoie donc l'état d'avant, et fait conclure à tort
que l'écriture a échoué — j'ai failli tout refaire. **Seul un rechargement de l'URL** (ou le devis
public) dit la vérité. Vérifier par `browser_navigate` sur la même URL `?startDate=…&endDate=…`, jamais
par une relecture du DOM en place.

## GreenGo — `advanceBookingTimeMaxLimit`, la fenêtre qui masque une saison entière

Page **Disponibilité** de l'annonce (`/annonce/<id>/availability`), section « Réservation à l'avance ».
Valeur trouvée le 2026-08-29 : **`ONE_YEAR`** — donc décembre 2027, à 481 jours, s'affichait
« Indisponible à vos dates » côté voyageur alors que la console le donnait « Disponible » à 399-1 070 €.
**Toute la grille 2027 posée au-delà d'août était invisible.** Les valeurs sont
`SIX_MONTHS | NINE_MONTHS | ONE_YEAR | TWO_YEARS` (radios `class="hidden-input"` → cliquer
`label[for="TWO_YEARS"]`), il n'y a pas d'intermédiaire.

> **Le symptôme est trompeur** : la console dit « Disponible », le public dit « Indisponible ». Ce
> n'est ni un blocage iCal ni une réservation — c'est la fenêtre. Toujours vérifier ce réglage avant
> de chercher un blocage.

**Effet de bord à contrôler après l'avoir ouverte** : les dates nouvellement vendables peuvent porter
des prix forcés résiduels. Ici, `2028-03-01 → 2028-08-29` était uniformément à **1 300 €/nuit**
(reliquat), invisible tant que la fenêtre valait un an. Ouvrir la fenêtre, c'est publier ce qui dort
derrière — relire la plage `<horizon de la grille> → <aujourd'hui + fenêtre>` juste après.

## GreenGo — un blocage manuel SORT dans le flux iCal exporté

Le flux `https://calendars.greengo.voyage/calendar/greengo-icalendar/<calendar-id>.ics` est présenté
comme exportant « vos **réservations** ». **C'est faux, ou du moins incomplet** : mesuré le
2026-08-29 par deux `curl` encadrant l'opération, le flux était *vide* avant, et portait aussitôt
après :

```
SUMMARY:GreenGo (Not Available)
DTSTART:20280301T000000Z   DTEND:20280830T000000Z
```

**Donc bloquer sur GreenGo peut fermer les mêmes dates partout**, chez qui s'abonne à ce flux. Avant
tout blocage sur un canal, se demander qui importe son flux — et le vérifier de la même façon :
relever le `.ics`, agir, relever à nouveau, diff.

> **La description d'un flux n'est pas son contrat.** Deux `curl` tranchent en trente secondes une
> question qu'aucune page d'aide ne documente.

## GreenGo — divers relevés le 2026-08-29

- La commission se lit en clair sur la page Tarification : `337 €` de prix, `289,82 €` de revenus,
  soit **14,00 % exactement**. Ne plus la déduire.
- **Chaque logement a son PROPRE identifiant de calendrier** : Gîte `6f6a8ef2-…`, Lodge `e05779b2-…`.
  C'est la garantie structurelle la plus forte contre une écriture sur le mauvais bien — le sélecteur
  de logement change l'URL. Vérifier l'id dans l'URL vaut mieux que vérifier le libellé du sélecteur.
- « À partir de 3 jours » signifie bien **3 NUITS** : mesuré, un séjour de 3 nuits prend le palier
  « 3 jours » (20 %) et un de 7 nuits le palier « 1 semaine » (42 %).
- `defaultMaximumNumberOfNights = 14` : plafond de durée, sans effet sur la grille actuelle.
- Un ensemble de règles se supprime par un bouton « Supprimer » qui n'a **pas** la classe
  `btn-invisible` (celle-ci appartient aux boutons de suppression de chaque palier). En mode édition
  il y a donc N+1 boutons « Supprimer » : filtrer sur la classe, jamais sur le libellé.

---

## GreenGo — le formulaire « ensemble de règles »

- Les radios de couleur portent `class="hidden-input"` : `.check()` échoue en timeout
  (« div intercepts pointer events »). **Cliquer le label** : `label[for="custom-rules-set-color-ORANGE"]`.
- **Les 7 jours d'arrivée et les 7 jours de départ sont cochés PAR DÉFAUT** — cochés = aucune
  restriction. **Les décocher interdirait toute arrivée et tout départ** et rendrait la période
  invendable. Une consigne « ne coche aucun jour » se lit de travers : dire « laisser par défaut ».
- `#save-custom-rules-set` est **coché par défaut** : c'est lui qui nomme et persiste l'ensemble dans
  la liste déroulante. Le laisser.
- Quand le formulaire d'ensemble de règles est ouvert, il y a **3 boutons « Enregistrer »**, dont
  deux cachés. `nth=0` clique un bouton invisible : utiliser `visible=true`.
- Le texte du bouton « Prix par nuit » contient déjà le prix ET le net : on vérifie une plage sans
  déplier le panneau.

---

## Abracadaroom — administré via Unic Stay / HostRider

**Relevé d'exécution du 2026-08-28/29.** La grille du Gîte y a été posée en entier ; ce que le
terrain a appris :

- **`calendar/create-many` fait UN prix pour PLUSIEURS périodes.** Grouper les plages par prix : six
  soumissions au lieu de trente-huit. Le formulaire **garde son état entre deux enregistrements**
  (prix, type, périmètre vivent dans le store Vuex), donc on enchaîne les groupes sans tout resaisir.
- **Quatre boutons « Enregistrer » cohabitent sur la page**, un par type de formulaire, et ils se
  distinguent par `data-cy` : `PricingCreationFormSaveButton`, `BookingConditionCreationFormSaveButton`,
  `ServiceDiscountCreationFormSaveButton`, `UnavailabilityCreationFormSaveButton`. Un
  `button:has-text("ENREGISTRER")` est ambigu et peut valider le mauvais formulaire.
- **Le jeu de cases d'APPLICATION est celui qui suit, dans l'ordre du document, la case « Appliquer à
  tous les hébergements ».** C'est le seul critère fiable — les deux jeux sont identiques à l'écran.
  Les cases portent le serviceId en `value` (`5837` / `5912`) : cibler par valeur, jamais par libellé.
- **Le `<input>` d'un radio ou d'une case est intercepté par son `span.check`** : cliquer le `.check`.
- **Le champ de dates d'une période est `readonly`** : passer par le `.datepicker`. Son en-tête
  visible porte deux `<select>` — **mois 0-based (Décembre = 11)** et année. **Régler l'année AVANT
  le mois.** Quand plusieurs pickers sont ouverts, prendre le dernier visible.
- **Double-clic + frappe lente sur le champ PRIX** (texte) ; **mais sur le champ NUITS MINIMUM
  (`input[type=number]`) le double-clic NE sélectionne PAS** : taper « 2 » sur « 1 » donne **12**.
  Là, clic + `Cmd+A` avant de taper.
- **Les promotions se rognent entre elles** : créer une promotion modifie ou supprime celles qui la
  chevauchent, et les anciennes deviennent alors inatteignables depuis le calendrier. **Supprimer les
  périmées AVANT de créer la nouvelle** si on veut pouvoir les viser une par une.
- **Le tarif de base du Gîte est 650 €** et transparaît partout où aucun tarif spécifique ne couvre —
  donc au-delà de la dernière période posée. Contiguïté obligatoire.
- **La page publique ignore `?arrival=&departure=`** : piloter son sélecteur de dates.

**LA remise d'Abracadaroom se calcule NUIT PAR NUIT, pas sur le total du séjour.** Découvert le
2026-08-29, et c'est le modèle le plus fidèle des quatre plateformes. Une promotion ne remise que les
nuits qu'elle **couvre** ; les autres restent au plein tarif, et le pourcentage affiché au client est
la moyenne qui en résulte. Mesuré : un séjour 23→26/12/2026 (Haute + Noël + Noël) dont seule la nuit
du 23 est couverte affiche **3 %** — soit 85,40 €, exactement 20 % de cette seule nuit.

**Conséquence : pour protéger une nuit de la dégressivité, il suffit de l'ôter de la couverture de la
promotion.** Pas besoin de reconstruire la promotion en fenêtres comme sur Lodgify : on **creuse**.
`calendar/delete-many` → type **Promotions** → la ou les nuits à protéger → Gîte coché seul.
C'est réversible (il suffit de recréer la promotion sur ces dates) et ça se fait en une soumission
multi-périodes.

**Et c'est plus juste que les fenêtres de Lodgify.** Sur Lodgify un séjour qui enjambe une nuit
protégée perd sa remise sur TOUTES ses nuits ; ici il la garde sur les nuits ordinaires. Vérifié
contre le moteur de la recette : 2 611,60 € encaissés → 2 089,28 € nets contre un plancher à
2 088,80 € (le plancher où la remise ne touche que les nuits `progressive`), soit **+0,48 €**.

**L'horizon commercialisable est plus court que la grille.** Au 2026-08-29, le Gîte ne se vend plus
au-delà de **fin août 2027** : septembre 2027 et tout ce qui suit renvoient `available: false`, alors
que la grille et les conditions de séjour courent jusqu'au 29/02/2028. À reprendre côté disponibilités.

**Endpoint de devis, sans piloter le sélecteur de dates** — il rend le détail au centime :
`POST https://www.abracadaroom.com/fr/availability/` avec
`id=5457&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&nb_adults=2&nb_children=0&nb_infants=0`.
`id=5457` = Gîte, `id=5508` = Lodge. Réponse : `price_full`, `discount_percent`, `price`, `available`.
**Un `available: false` sur un séjour court en Très haute n'est pas une indisponibilité** : c'est le
minimum de 4 nuits qui refuse. Toujours sonder avec une durée compatible avant de conclure.

Formulaire `delete-many` : le type à supprimer est le SECOND groupe de radios
(`UNAVAILABILITIES` / `PRICING` / `BOOKING_CONDITION` / `DISCOUNT`) — le premier n'est qu'un filtre
d'affichage. Bouton `data-cy="submitButtonDeleteManyForm"`, ajout de période
`data-cy="MultipleDateRangePickerAddPeriod"`. Le formulaire **garde son état** entre deux
suppressions.

**Gîte = service 5837** (« Gite nature, 13 ha, piscine »), Lodge = service 5912.

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

Commission **14 %** — pas 14,5 %. Mesuré le 2026-08-28 dans le panneau « Vos revenus par nuit » du
Gîte : 337 € affichés → 289,82 € nets, soit exactement ×0,86. La valeur 14,5 % notée ici auparavant
était fausse. **Ce panneau est le contrôle le moins cher du déploiement** : il recalcule le net à
chaque frappe, donc un prix mal tapé se voit immédiatement. Console : `greengo.voyage/service-provider-portal`.

**Identifiants** — Gîte : annonce `0a63652e-9222-414e-aad0-4626024e17d5`, tarification **au niveau de
l'annonce** (`/annonce/<id>/tarification`). Lodge : annonce `58dbf98b-8524-4ee9-804e-5f7f03d5d957`,
logement `e05779b2-942b-4666-a534-967f295a1566`, tarification **au niveau du logement**
(`/annonce/accommodation/<id>/…`). Les deux écrans sont structurellement distincts : travailler sur
l'annonce du Gîte ne peut pas atteindre la Lodge.

**Pièges de saisie relevés le 2026-08-28.** (a) Le champ pourcentage **avale le point décimal** :
taper `42.85` inscrit `4285`. Utiliser **42**, jamais 43 (43 % passe sous le plancher net).
(b) `Ctrl+A` ne sélectionne pas le contenu d'un champ : taper par-dessus **concatène** (`530` + `337`
= `530337`). **Double-cliquer** le champ avant de saisir. (c) Les paliers de durée s'empilent avec
« Ajouter une autre réduction » : `lengthOfStayDiscounts.<i>.…`, valeurs `THREE_DAYS` … `ONE_WEEK`.

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
   et **elles REMPLACENT** celles de la page Tarification — mesuré le 2026-08-29, voir la section
   « les remises d'un ensemble de règles REMPLACENT celles de l'annonce ». Une note antérieure
   affirmait qu'elles se cumulaient : c'est FAUX.
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
