=== GuestFlow Booking ===
Contributors: adrien
Tags: booking, availability, quote, gutenberg
Requires at least: 6.4
Requires PHP: 8.0
Stable tag: 1.18.0
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

= 1.18.0 =
* Anti-robot : dès que les coordonnées s'affichent ou qu'on y touche (jamais au simple chargement de la page), le navigateur résout une vérification de GuestFlow (preuve de travail, calculée en arrière-plan, sans service extérieur ni cookie). Le visiteur ne la voit pas, sauf s'il envoie avant la fin : le bouton affiche alors « Vérification… ». GuestFlow 3 avec l'extension « Réservation depuis le site » 1.8.0 requis ; à partir de cette version, GuestFlow refuse les demandes envoyées sans vérification.
* La même demande renvoyée (même e-mail, même logement, mêmes dates) met à jour la demande en cours : « Votre demande du <date> a été mise à jour. » ; si elle est déjà traitée, seul le message est transmis : « Votre demande du <date> a déjà été transmise : votre message a été ajouté. ». Le paiement en ligne n'est proposé que pour la demande créée dans cette page. Message limité à 2 000 caractères. Au-delà de 10 messages sur une demande déjà traitée, le site affiche « Demande reçue. » sans parler du message.

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
