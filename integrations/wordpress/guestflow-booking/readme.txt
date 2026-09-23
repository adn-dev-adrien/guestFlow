=== GuestFlow Booking ===
Contributors: adrien
Tags: booking, availability, quote, gutenberg
Requires at least: 6.4
Requires PHP: 8.0
Stable tag: 1.11.0
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
   * La clé est la valeur `PUBLIC_API_KEY` de GuestFlow (`server/.env.local`).
   * Plus sûr : définissez-la dans `wp-config.php` via `define('GUESTFLOW_API_KEY', '…');` — elle prime alors sur le réglage et n'est pas stockée en base.
3. Cliquez « Tester la connexion ».
4. Ajoutez les blocs GuestFlow dans vos pages. Définissez éventuellement un logement et une page de réservation par défaut dans les réglages.

== Frequently Asked Questions ==

= La clé d'API est-elle visible côté visiteur ? =
Non. Elle est lue uniquement côté serveur (constante `wp-config` ou option masquée) et n'est jamais envoyée au navigateur ni écrite dans les logs.

= Une demande crée-t-elle une réservation ferme ? =
Non. Elle crée un devis « brouillon » côté GuestFlow, que l'administrateur revoit puis convertit éventuellement en réservation.

== Changelog ==

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
* Conditions générales : le formulaire de réservation affiche lui-même la case « J'ai lu et j'accepte les conditions générales de location (version N) », jamais pré-cochée. Sans elle, le bouton explique pourquoi il refuse. GuestFlow enregistre l'acceptation (heure du serveur, version, adresse IP, navigateur) et refuse toute demande qui ne la porte pas.
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
