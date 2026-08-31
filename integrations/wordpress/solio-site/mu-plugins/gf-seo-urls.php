<?php
/**
 * gf-seo-urls.php — Toutes les adresses generees suivent l’hote du visiteur.
 *
 * Le site est joignable par plusieurs adresses (IP locale aujourd’hui, domaine public
 * demain). wp-config.php redefinit deja WP_HOME et WP_SITEURL d’apres l’en-tete Host a
 * chaque requete, mais certains composants mettent l’adresse en cache : Polylang enregistre
 * l’URL d’accueil de chaque langue dans un transient, et si ce cache a ete construit en
 * ligne de commande — ou par une tache planifiee, sans en-tete Host — il contient l’adresse
 * IP interne. Elle ressortait ainsi dans le sitemap.
 *
 * Ce garde-fou corrige l’hote au dernier moment, quelle que soit l’origine de l’adresse.
 * C’est la meme logique que le correctif de juillet 2026 sur les URL de medias : le site
 * ne connait pas son propre nom, il utilise celui par lequel on le demande.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Remplace l’hote d’une adresse interne par celui de la requete en cours.
 *
 * @param string $url Adresse produite par WordPress.
 * @return string
 */
function gf_seo_url_hote_courant( $url ) {
	if ( ! is_string( $url ) || '' === $url ) {
		return $url;
	}
	$hote_requete = isset( $_SERVER['HTTP_HOST'] ) ? wp_unslash( $_SERVER['HTTP_HOST'] ) : '';
	if ( '' === $hote_requete ) {
		return $url; // Ligne de commande ou tache planifiee : rien de fiable a substituer.
	}
	// L’en-tete Host n’est pas une donnee de confiance : on n’accepte qu’un nom d’hote simple.
	if ( ! preg_match( '~^[a-z0-9.\-]+(:\d+)?$~i', $hote_requete ) ) {
		return $url;
	}

	$parties = wp_parse_url( $url );
	if ( empty( $parties['host'] ) ) {
		return $url; // Adresse deja relative.
	}
	$hote_url = $parties['host'] . ( isset( $parties['port'] ) ? ':' . $parties['port'] : '' );
	if ( strcasecmp( $hote_url, $hote_requete ) === 0 ) {
		return $url;
	}

	$schema = ( ! empty( $_SERVER['HTTPS'] ) && 'off' !== $_SERVER['HTTPS'] ) ? 'https' : 'http';

	return preg_replace( '~^https?://[^/]+~', $schema . '://' . $hote_requete, $url );
}

foreach ( array( 'home_url', 'site_url', 'network_home_url', 'network_site_url' ) as $filtre ) {
	add_filter( $filtre, 'gf_seo_url_hote_courant', 99 );
}

/**
 * Le sitemap merite un traitement particulier.
 *
 * Polylang remplace la liste d’adresses du sitemap par la sienne, construite depuis les
 * URL d’accueil qu’il garde en cache : ces adresses ne passent pas par le filtre home_url.
 * On repasse donc sur chaque entree produite.
 */
add_filter(
	'wp_sitemaps_posts_url_list',
	function ( $liste ) {
		foreach ( $liste as $i => $entree ) {
			if ( isset( $entree['loc'] ) ) {
				$liste[ $i ]['loc'] = gf_seo_url_hote_courant( $entree['loc'] );
			}
		}
		return $liste;
	},
	99
);

add_filter(
	'wp_sitemaps_index_entry',
	function ( $entree ) {
		if ( isset( $entree['loc'] ) ) {
			$entree['loc'] = gf_seo_url_hote_courant( $entree['loc'] );
		}
		return $entree;
	},
	99
);
