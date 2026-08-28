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
`extranet_ng/manage/general_info.html` → « Changer le nom de l'établissement » : champ libre, aperçu
en direct, trois étapes (saisie → « Suivant » → « Changer le nom de l'établissement » dans le pied de
la modale, `[data-test-id="footer"] button[type="submit"]`). Effectif immédiatement ; seul le `<title>`
de la page publique reste en cache quelques heures. **À ne pas confondre avec la description**, elle,
non éditable.

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

### Piloter l'extranet Booking : ne jamais taper une URL

**Relevé le 2026-08-28.** Les pages de `admin.booking.com` portent un jeton de session dans leur
URL (`?ses=<32 hexa>`). **Naviguer vers une URL construite à la main — même correcte, même avec le
bon `hotel_id` — déconnecte la session** et renvoie sur `account.booking.com/sign-in`. Il faut alors
que l'opérateur se reconnecte, et le jeton change.

Conséquence pratique : dans cet extranet, **on ne se déplace qu'en cliquant les liens de la page**.
Les URL notées ici servent à reconnaître un écran, pas à y aller. Si une URL directe est
indispensable, y recopier le `ses=` lu dans la page courante — et savoir qu'il expire.

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
