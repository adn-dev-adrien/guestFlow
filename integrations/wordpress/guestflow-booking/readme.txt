=== GuestFlow Booking ===
Contributors: adrien
Tags: booking, availability, quote, gutenberg
Requires at least: 6.4
Requires PHP: 8.0
Stable tag: 1.6.0
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

= 1.6.0 =
* Lit bébé : le supplément facturé par GuestFlow (par lit, pour l'ensemble du séjour) est repris dans le tunnel. La ligne « Lit(s) bébé souhaité(s) ? » affiche le tarif servi par l'API au lieu de « Gratuit », et le devis récapitule le supplément. Aucun montant n'est codé dans le plugin.

= 1.5.0 =
* Assurance annulation : quand une assurance est configurée dans GuestFlow, le tunnel affiche son propre encart, avec le montant calculé pour le séjour et un choix Oui / Non obligatoire avant validation. Aucun montant n'est calculé côté site — le serveur tarifie la prime.

= 1.3.0 =
* Paiement en ligne (option du bloc « Devis & demande ») : le visiteur règle la totalité de son séjour via la page sécurisée Qonto, puis revient sur une vue de confirmation qui suit l'état du paiement. Au paiement, GuestFlow bloque les dates et envoie l'e-mail de confirmation. Nouvelles routes proxy `/booking-requests/{id}/pay` (nonce) et `/booking-requests/{id}/status`.

= 1.0.0 =
* Version initiale : 3 blocs (calendrier, devis/demande, liste des logements), proxy PHP REST, page de réglages, cache transients, anti-spam honeypot.
