=== GuestFlow Booking ===
Contributors: adrien
Tags: booking, availability, quote, gutenberg
Requires at least: 6.4
Requires PHP: 8.0
Stable tag: 1.25.0
License: GPLv2 or later

Affiche les disponibilités, calcule des devis et envoie des demandes de réservation vers GuestFlow via son API publique.

== Description ==

GuestFlow Booking connecte un site WordPress vitrine à une instance GuestFlow. Il fournit trois blocs Gutenberg :

* **GuestFlow — Calendrier de disponibilités** : grille mensuelle, dates indisponibles grisées.
* **GuestFlow — Devis & demande de réservation** : dates + voyageurs + options → devis en direct (calculé par le moteur de prix GuestFlow) → demande de réservation.
* **GuestFlow — Liste des logements** : cartes avec « à partir de X €/nuit » et lien vers la page de réservation.

Architecture : le navigateur ne parle qu'au **proxy PHP** du plugin (`/wp-json/guestflow/v1/*`). Le plugin relaie côté serveur vers l'API publique GuestFlow (`/public/v1/*`) en injectant la clé d'API. **La clé n'est jamais exposée au navigateur.** Une demande de réservation crée un **devis en attente** côté GuestFlow (jamais une réservation confirmée).

== Installation ==

1. Installez et activez le plugin (Extensions → Ajouter → Téléverser).
2. Réglages → GuestFlow : renseignez l'URL de l'API GuestFlow et la clé d'API.
   * Les deux valeurs se copient dans GuestFlow : Paramètres › Intégrations › Site internet.
   * Plus sûr : définissez-la dans `wp-config.php` via `define('GUESTFLOW_API_KEY', '…');` — elle prime alors sur le réglage et n'est pas stockée en base.
3. Cliquez « Tester la connexion ».
4. Ajoutez les blocs GuestFlow dans vos pages. Le logement se choisit par son nom ; la page de réservation et celle des conditions générales sont trouvées d'elles-mêmes, ou créées depuis les réglages.

== Frequently Asked Questions ==

= La clé d'API est-elle visible côté visiteur ? =
Non. Elle est lue uniquement côté serveur (constante `wp-config` ou option masquée) et n'est jamais envoyée au navigateur ni écrite dans les logs.

= Une demande crée-t-elle une réservation ferme ? =
Non. Elle crée un devis « brouillon » côté GuestFlow, que l'administrateur revoit puis convertit éventuellement en réservation.

== Changelog ==

= 1.25.0 =
* Bons cadeaux : la page d’achat montre le bon tel que le client le recevra. La carte se retourne (Recto / Verso, « Agrandir ») : au verso, le logo, le QR code, le contenu du bon, le nom, le mot, le code et la validité, dessinés comme le PDF, avec ses polices. Elle se retourne seule quand on écrit dans « Pour », « De la part de » ou « Un mot ». L’étiquette grise sous « Payer » disparaît.
* Après le paiement, la même carte montre le verso avec le vrai code et le vrai QR code ; « Imprimer » imprime les deux faces côte à côte au format du bon (105 × 148 mm).
* La carte reste visible à côté du formulaire pendant la saisie sur grand écran.

= 1.24.0 =
* Réserver une séance : la phrase sur les 15 minutes sous le bouton disparaît (le créneau reste gardé 15 minutes pendant le paiement) ; tant qu'aucun horaire n'est choisi, le récapitulatif dit « Choisissez un horaire », en rouge après un appui sur le bouton sans horaire.
* Dès qu'un code de bon est accepté, le récapitulatif liste tout ce que le bon comprend (séance, temps offert, chaque option avec sa quantité) à « 0 € · inclus dans le bon », avant même le choix d'un horaire, puis de la même façon sur l'horaire choisi.
* Le prénom et le nom du bénéficiaire du bon préremplissent les coordonnées (jamais l'e-mail, le téléphone ni le nombre de personnes), sans écraser ce que le visiteur a saisi ; « Retirer » le bon vide ce que le bon avait rempli.
* Achat d'un bon : « Pour » devient « Prénom » et « Nom » du bénéficiaire, tous deux obligatoires ; le bon imprimé n'affiche que le prénom.

= 1.23.0 =
* Nouveau bloc « GuestFlow — Réserver une séance » (et le shortcode `[guestflow_session_booking]`) : le visiteur choisit une activité vendable hors séjour, sa durée, le nombre de personnes, une date puis un créneau — chaque créneau affiche ce que coûte la séance entière, chaque heure à la tranche où elle tombe —, ajoute des options, saisit ses coordonnées et paie en ligne en totalité ; le créneau est gardé 15 minutes. Un récapitulatif suit le défilement sur grand écran, une barre collée en bas sur téléphone. Au retour de la banque, la page affiche « Séance réservée » avec le détail.
* Le champ « Code bon cadeau » du même parcours règle la séance avec un bon : la page applique le bon, indique ce qu’il reste à payer à chaque créneau (« Inclus dans le bon » ou « + x € ») et ne demande un paiement que pour le reste. Un bon de séjour renvoie à la page de réservation d’un hébergement, `#bon=` rempli.
* Le lien `/<base>/utiliser` des cartes et du QR code mène à la page qui contient ce bloc, le code déjà rempli. Le bloc « Utiliser un bon cadeau » reste : il affiche le même parcours.
* La page d’achat d’un bon propose « Vous avez reçu un bon cadeau ? Réserver votre séance » vers cette page.
* La carte du bon sur la page d’achat n’est plus inclinée.

= 1.22.0 =
* Bons cadeaux : l’achat et « Utiliser un bon cadeau » rangent le temps supplémentaire et les options dans un seul dépliant « Ajouter au bon », fermé par défaut. Chaque ligne affiche son prix TTC lu dans GuestFlow, et l’en-tête dit combien les ajouts coûtent une fois choisis.

= 1.21.0 =
* Bons cadeaux : sur une offre ouverte, le lien « Choisir une autre offre » laisse place à un sélecteur « Votre cadeau » : une carte par offre (visuel, titre, prix), l’offre ouverte repérée, un clic ouvre l’autre sur place. Sur téléphone, la rangée défile et laisse deviner la suivante.

= 1.20.1 =
* Bons cadeaux : un bon de séance (bain nordique) ne parle plus de « montant au choix » ni d’« une ou plusieurs fois » : la page d’achat, l’aperçu et le bon affiché après le paiement disent « pour une séance à réserver en ligne », et ce dernier montre ce que le bon contient au lieu de son montant.
* Bons cadeaux : la page d’achat montre la carte de chaque campagne, lue dans GuestFlow — en petit sur chaque offre, en entier en tête du formulaire (au-dessus du titre sur téléphone, en colonne à côté du formulaire sur grand écran). Changer le visuel d’une campagne dans GuestFlow change le site.

= 1.20.0 =
* Bons cadeaux : le lien de paiement vit une heure ; passé ce délai, la page de retour affiche « Le lien de paiement a expiré. Aucun paiement n’a été pris. » avec un bouton « Recommencer ».
* Bons cadeaux : un bloc « GuestFlow — Bon cadeau » (et le shortcode `[guestflow_gift_voucher]`) pour acheter un bon : montant libre dans les bornes de GuestFlow, repères de prix, « Pour » / « De la part de », un mot, e-mail, conditions de vente, aperçu du bon en direct, puis paiement en ligne et page du bon (PDF, impression) au retour. Tant que GuestFlow ne propose pas la vente en ligne, le formulaire s'affiche avec « Vente en ligne bientôt disponible. ».
* Après le paiement, le visiteur revient sur la page du formulaire : le bloc transmet le chemin de la page, GuestFlow le rattache à l'adresse du site.
* Le shortcode `[guestflow_gift_voucher_button url="…"]` affiche un bouton « Bon cadeau » à placer à côté de « Réserver ».
* Le code d'un bon (16 caractères, dernier caractère de contrôle) est normalisé et pré-vérifié côté navigateur avant d'être envoyé à GuestFlow, qui le revérifie.
* Demande GuestFlow avec le plugin « Bons cadeaux » actif ; sans lui, le bloc affiche « Réservation temporairement indisponible. ».
* Moteur de réservation : un champ « Bon cadeau » à l'étape du paiement, tant que le plugin est actif dans GuestFlow. Le code est normalisé et son caractère de contrôle vérifié avant tout appel ; GuestFlow le revérifie, déduit le bon (l'acompte d'abord, puis le solde) et annonce « À payer aujourd'hui ». Quand le bon couvre tout ce qui est demandé, le bouton devient « Confirmer la réservation » et aucun paiement n'est demandé. Le code du QR d'un bon (`#bon=…`) remplit le champ.
* Moteur de réservation : le calendrier s'arrête à l'horizon annoncé par GuestFlow (12 mois par défaut) : les jours au-delà sont fermés, la navigation s'arrête sur le mois de l'horizon, et une rangée de pastilles de mois permet de sauter directement à un mois. Avec un GuestFlow plus ancien, qui n'annonce pas d'horizon, le calendrier reste libre comme avant.
* Bons cadeaux composés : le bloc « Bon cadeau » propose les offres en vente, groupées par nature (séjours, séances). Une offre de séance affiche ce que contient le bon, le temps supplémentaire et les options au pas et dans les limites de GuestFlow, puis le récapitulatif calculé par GuestFlow (lignes, total TTC, TVA) à chaque changement ; les conditions de vente sont celles de l'activité de l'offre. Une offre de séjour garde le montant libre. L'adresse `#campagne=<slug>` d'une carte ouvre directement l'offre, avec les mêmes options que depuis le site.
* Nouveau bloc « GuestFlow — Utiliser un bon cadeau » (et le shortcode `[guestflow_gift_voucher_use]`) : le code vient du QR code (`#bon=…`, jamais envoyé dans une adresse) ou d'un champ « Code du bon » pré-vérifié ; un bon de séjour renvoie au moteur de réservation, un bon de séance affiche « Votre bon comprend », les mois jusqu'à l'horizon, les créneaux (« Inclus » ou « + x € soirée »), le récapitulatif, puis la confirmation ou le paiement du reste (créneau gardé 15 minutes). Chaque refus reprend la phrase de GuestFlow.
* Liens permanents des cartes : `/<début>/offrir/<offre>` mène à la page d'achat de l'offre et `/<début>/utiliser` à la page « Utiliser un bon cadeau » (Réglages → GuestFlow ; début des liens `bon-cadeau` par défaut). Bons cadeaux inactifs dans GuestFlow ou GuestFlow injoignable : la page d'accueil.
* La page des conditions générales accepte `?activity=resource` pour lire les conditions de l'activité, et celles du logement sans paramètre.
* Sans le plugin « Bons cadeaux » dans GuestFlow, les deux blocs ne s'affichent pas et la page de réglages le signale (« Bons cadeaux inactifs dans GuestFlow ») sans gêner les autres blocs.

= 1.19.1 =
* Moteur de réservation : des dates déjà prises (arrivées par un lien, ou réservées depuis l'ouverture de la page) sont refusées dans le calendrier, comme un séjour trop court : aucun total n'est affiché, l'étape suivante du tiroir reste fermée, et le calendrier relit ses nuits prises. Même chose pour des horaires que les séjours voisins ne permettent pas.

= 1.19.0 =
* Page de retour du paiement : quand le lien de paiement a expiré sans être payé (un lien est valable 36 heures), la page affiche « Ce lien de paiement a expiré. Refaire la réservation depuis la page du logement. » et cesse de vérifier le paiement (GuestFlow à jour requis, sinon la page finit sur « Paiement en attente » comme avant).

= 1.18.1 =
* Page de retour du paiement : quand la réservation a été annulée entre-temps, la page affiche « Cette réservation est annulée. » et cesse de vérifier le paiement (GuestFlow à jour requis, sinon le comportement reste celui d'avant).

= 1.18.0 =
* Anti-robot : dès que les coordonnées s'affichent ou qu'on y touche (jamais au simple chargement de la page), le navigateur résout une vérification de GuestFlow (preuve de travail, calculée en arrière-plan, sans service extérieur ni cookie). Le visiteur ne la voit pas, sauf s'il envoie avant la fin : le bouton affiche alors « Vérification… ». GuestFlow 3 avec l'extension « Réservation depuis le site » 1.8.0 requis ; à partir de cette version, GuestFlow refuse les demandes envoyées sans vérification.
* La même demande renvoyée (même e-mail, même logement, mêmes dates) met à jour la demande en cours : « Votre demande du <date> a été mise à jour. » ; si elle est déjà traitée, seul le message est transmis : « Votre demande du <date> a déjà été transmise : votre message a été ajouté. ». Le paiement en ligne n'est proposé que pour la demande créée dans cette page. Message limité à 2 000 caractères ; prénom et nom à 100, téléphone à 40, e-mail à 254. Au-delà de 10 messages sur une demande déjà traitée, le site affiche « Demande reçue. » sans parler du message.

= 1.17.1 =
* Durée maximale et jours d'arrivée / de départ : quand GuestFlow refuse le séjour choisi, le moteur l'affiche clairement (« Séjour trop long : maximum 7 nuits. », « Arrivée le samedi uniquement sur cette période. ») au lieu d'un devis, et la demande ne peut pas être envoyée (GuestFlow à jour requis).
* Mises à jour : l'archive installée doit porter dans son nom la version annoncée, être plus récente que la version installée et correspondre à l'empreinte SHA-256 publiée avec la version de GuestFlow (`SHA256SUMS`) ; sinon WordPress n'installe rien.

= 1.17.0 =
* Lien d'arrivée de Google Vacation Rentals : le bloc de réservation s'ouvre avec les dates (`checkin`, `checkout` au format JJ/MM/AAAA) et le nombre de voyageurs (`guests`) passés dans l'adresse. Une valeur invalide ou passée est ignorée.

= 1.16.1 =
* Mises à jour : seule une archive publiée par les versions de GuestFlow sur GitHub est acceptée (dépôt et chemin vérifiés, plus seulement l'hôte).
* Adresse du visiteur : quand tous les relais de `X-Forwarded-For` sont des proxys de confiance, l'adresse transmise est celle du proxy, jamais la première entrée, que le navigateur peut écrire lui-même.
* Paiement en ligne : le visiteur n'est redirigé que vers une page de paiement en `https:`.

= 1.16.0 =
* Personnes supplémentaires : le récapitulatif affiche leur supplément sur sa propre ligne (calculé par GuestFlow selon la grille tarifaire du logement), et le sélecteur de voyageurs rappelle combien de personnes le prix de base couvre.
* La capacité du logement est toujours plafonnée côté site, même quand elle n'est pas renseignée dans GuestFlow.
* Reprend tout le contenu des 1.14.2 et 1.14.3 (demande sans paiement, prix par personne, séjour minimum visible, chaque champ refusé signalé sous lui-même et amené à l’écran).
* Calendrier : le séjour choisi reste lisible au toucher (le survol ne vaut que pour une souris, et l'emporte même sur l'ancien module `gf-booking.php`), les jours passés, les nuits prises et les nuits libres ne se ressemblent plus, et une légende dit ce que chaque couleur veut dire. Quand les deux mois affichés n'offrent aucune arrivée possible (nuits prises, durée minimale, jours d'arrivée), « Prochaine disponibilité : mercredi 31 mars 2027 » propose d'y aller d'un clic (GuestFlow à jour requis).
* Coordonnées : chaque champ manquant ou mal rempli est signalé sous le champ lui-même (« Champ requis. », « Adresse e-mail incomplète. »), le premier reçoit le curseur ; les refus de GuestFlow arrivent au même endroit, dans la langue de la page. Le moteur émet l'événement `gf:refused` pour qu'un thème qui déplace ses blocs puisse montrer le champ refusé. Claviers adaptés sur téléphone et saisie à 16 px, qui ne fait plus zoomer iOS.
* Sur téléphone, le total et le bouton restent dans une barre en bas de l'écran ; le bouton suit l'étape (« Choisir les dates », « Continuer », puis l'envoi). La barre tient aussi dans un thème qui coupe le débordement de la page. Dans un bloc large, le récapitulatif suit le défilement dans une colonne à droite, avec le bouton ; sous un en-tête collant, régler `--gf-sticky-top` à sa hauteur. Les heures d'arrivée et de départ ont leur propre ligne.
* Couleurs : une seule couleur d'accent règle tout le moteur (`--gf-accent`) ; sans réglage, la couleur principale du thème, puis le vert sapin. Une couleur d'accent trop claire est assombrie là où elle porte du texte blanc. Plus de bleu par défaut ni de jours bleus dans le calendrier de disponibilités, et les boutons `.gf-btn` du thème ne sont plus touchés.

= 1.15.0 =
* Réglages : le logement par défaut se choisit dans la liste des logements de GuestFlow ; la page de réservation et celle des conditions générales sont trouvées d'elles-mêmes (la page qui contient le bloc, celle qui contient `[guestflow_cgv]`) ou créées en un clic ; une page dont le bloc fixe un logement n'est jamais retenue comme page de réservation. Un reverse proxy du réseau local est reconnu sans réglage. Le test de connexion se lance à l'ouverture de la page et signale un module « Réservation depuis le site » inactif dans GuestFlow.
* Accessibilité du moteur : chaque champ porte son libellé, les boutons − / + disent ce qu'ils comptent (« Ajouter : Adultes »), les jours du calendrier se lisent en entier (« vendredi 6 novembre 2026, indisponible ») et le devis, les indications et les erreurs sont annoncés.
* Paiement en ligne : relancer un paiement échoué paie la même demande au lieu d'en créer une nouvelle, même après une correction du message ou du téléphone, et la référence de la demande s'affiche. Le retour du paiement affiche son suivi, y compris sur une page de réservation commune à tous les logements. Tant qu'aucun moyen de paiement n'est connecté dans GuestFlow, le bouton envoie une demande simple.
* Sans conditions générales publiées alors que GuestFlow les exige, le formulaire annonce « Réservation en ligne fermée pour le moment. » au lieu de refuser la demande à la fin.
* Mise en page : les champs restent dans leur cadre sur tous les thèmes (box-sizing propre aux blocs) ; dans un bloc étroit, l'e-mail et « Effacer » prennent une ligne entière.
* Calendrier de disponibilités : jours de la semaine dans la langue de la page. Récapitulatif : « 1 nuit », « 3 nuits ». Sélecteur de langue des CGV en texte (FR, EN).
* Un module « Réservation depuis le site » éteint dans GuestFlow affiche « Réservation temporairement indisponible. » plutôt qu'une erreur générique.
* En-tête `Update URI` : WordPress ne demande plus de mise à jour à wordpress.org pour ce plugin.
= 1.14.1 =
* Demande sans paiement : le récapitulatif peut proposer « Envoyer une demande sans payer » à côté du paiement (réglage du bloc, désactivé par défaut).
* Prix par personne et par nuit sous le total, calculé par GuestFlow ; les voyageurs se choisissent avant les dates.
* Séjour minimum visible : le calendrier affiche le prix de chaque nuit, hachure les départs trop courts et nomme le premier départ possible.
* Le plugin déclare « Update URI: false » : WordPress ne le remplacera jamais par un plugin homonyme de wordpress.org.

= 1.14.0 =
* Origine des demandes : le plugin note d'où vient la visite (site référent, paramètres utm_*, page d'arrivée) dans la mémoire de l'onglet, sans cookie ni identifiant, et l'envoie avec la demande de réservation. GuestFlow en déduit le canal (recherche, réseaux sociaux, campagne, assistant IA…). Un site peut couper la capture avec le filtre `guestflow_booking_capture_attribution`.
* Étapes du tunnel : le moteur émet un événement `guestflow:booking` sur `document` à chaque étape (dates, devis, demande envoyée, paiement…), que le site transmet à l'outil d'audience de son choix. Aucune donnée personnelle n'y figure.

= 1.12.0 =
* Bilingue : le plugin sert désormais la langue de la page. Il envoie `lang` à GuestFlow sur chaque appel — les titres d'options, les libellés de prix et les messages d'erreur reviennent dans cette langue — et ses propres 124 chaînes sont traduites en anglais (`languages/guestflow-booking-en_GB`). Les mois du calendrier suivent la langue ; les montants restent en « 1 234,56 € » dans les deux, comme le devis PDF joint à la confirmation. Les CGV s'ouvrent dans la langue de la page, le choix du visiteur continuant de primer. Le cache est segmenté par langue : sans cela, le premier visiteur décidait de ce que lisaient les suivants.

= 1.11.0 =
* Modifier ses dates sans tout refaire : une fois l'arrivée posée, cliquer une date plus tard déplace le départ — le séjour s'allonge ou se raccourcit d'un clic. Cliquer l'arrivée recommence ; un bouton « ✕ Effacer » vide les deux champs.
* Le calendrier ne se ferme plus après l'arrivée : les dates antérieures et celles situées au-delà d'une nuit déjà prise restent cliquables et posent une nouvelle arrivée.
* « Séjour trop court » garde la période choisie à l'écran et invite à cliquer une date plus tard, au lieu d'effacer le départ 400 ms après le clic.

= 1.10.0 =
* Séjour trop court : le calendrier garde son message (« Séjour trop court (minimum 3 nuits) ») au lieu de le remplacer aussitôt par « Sélectionnez votre date de départ ». Même correction quand la période choisie contient une nuit déjà prise.
* Ressources offertes : une ligne vendue à l'heure annonce ce que le séjour reçoit sans payer (« 1 h offerte par séjour »), et le récapitulatif écrit « Offert » plutôt que « 0,00 € ». Le libellé vient de GuestFlow : changer l'offre ne demande aucune mise à jour du plugin.
* Les dates d'arrivée et de départ s'écrivent en chiffres (« 28/09/2026 »), qui tiennent en entier dans un champ étroit.
* La note des ressources à planifier se limite à « À planifier avec l'hôte. »

= 1.9.0 =
* Petits déjeuners et repas : le nombre saisi est le nombre de petits déjeuners (ou de couverts) facturés, et non plus un nombre de séances multiplié par le nombre de personnes. Les libellés viennent de GuestFlow : « Nombre de petits déjeuners », « 8,00 € · par petit déjeuner ».
* Une note sous la ligne rappelle le maximum que le séjour peut servir (« Jusqu'à 12 — 4 personnes × 3 matins ») et le « + » s'y arrête. Si le groupe se réduit, le nombre suit tout seul.

= 1.8.0 =
* Conditions générales : le formulaire de réservation affiche lui-même la case « J'ai lu et j'accepte les conditions générales de location », jamais pré-cochée. Sans elle, le bouton explique pourquoi il refuse. GuestFlow enregistre l'acceptation (heure du serveur, version, adresse IP, navigateur) et refuse toute demande qui ne la porte pas.
* Nouveau shortcode [guestflow_cgv] : affiche les conditions générales publiées dans GuestFlow, en français et en anglais, ou une version précise avec ?v=N (le lien de la case et du mail de confirmation).
* Réglages : « Page des conditions générales » et « Proxys de confiance ». Le plugin transmet à GuestFlow l'adresse du visiteur, et non plus celle du serveur WordPress ; la limite anti-spam compte désormais par visiteur.
* À installer le jour où GuestFlow passe à la version qui exige les CGV : un plugin 1.7 n'envoie pas l'acceptation, et GuestFlow refuse alors toutes ses demandes.

= 1.7.0 =
* Mises à jour automatiques : le plugin demande à son GuestFlow quelle version est publiée, et se met à jour depuis Extensions → Mises à jour comme n'importe quel autre plugin. Plus de copie manuelle dans le conteneur après une release.

= 1.6.0 =
* Lit bébé : le supplément facturé par GuestFlow (par lit, pour l'ensemble du séjour) est repris dans le tunnel. La ligne « Lit(s) bébé souhaité(s) ? » affiche le tarif servi par l'API au lieu de « Gratuit », et le devis récapitule le supplément. Aucun montant n'est codé dans le plugin.

= 1.5.0 =
* Assurance annulation : quand une assurance est configurée dans GuestFlow, le tunnel affiche son propre encart, avec le montant calculé pour le séjour et un choix Oui / Non obligatoire avant validation. Aucun montant n'est calculé côté site — le serveur tarifie la prime.

= 1.3.0 =
* Paiement en ligne (option du bloc « Devis & demande ») : le visiteur règle la totalité de son séjour via la page sécurisée Qonto, puis revient sur une vue de confirmation qui suit l'état du paiement. Au paiement, GuestFlow bloque les dates et envoie l'e-mail de confirmation. Nouvelles routes proxy `/booking-requests/{id}/pay` (nonce) et `/booking-requests/{id}/status`.

= 1.0.0 =
* Version initiale : 3 blocs (calendrier, devis/demande, liste des logements), proxy PHP REST, page de réglages, cache transients, anti-spam honeypot.
