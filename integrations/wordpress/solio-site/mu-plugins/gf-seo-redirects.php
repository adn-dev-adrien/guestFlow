<?php
/**
 * gf-seo-redirects.php — Redirections permanentes (301).
 *
 * Deux sources :
 *  1. l’option « gf_seo_redirections » : anciennes adresses du site WordPress, alimentee
 *     automatiquement lors des changements de slug (voir le script du lot 2) ;
 *  2. gf_seo_redirections_lodgify() : anciennes adresses du site Lodgify, utiles le jour
 *     ou domainesolio.com pointera sur ce serveur.
 *
 * WordPress redirige deja seul un simple changement de slug (_wp_old_slug). Ce module
 * couvre ce qu’il ne sait pas faire : les pages qui ont change de parent et les adresses
 * d’un site tiers.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Correspondance des anciennes adresses Lodgify vers les pages WordPress.
 *
 * Les cles sont les chemins tels qu’ils existaient sur domainesolio.com ; les valeurs sont
 * des chemins relatifs du nouveau site. Les URL anglaises pointent pour l’instant vers
 * l’equivalent francais : elles seront reaffectees quand la version anglaise existera.
 */
function gf_seo_redirections_lodgify() {
	return array(
		'/fr/domaine-solio---gite-confort-nature-animaux'  => '/gite-10-personnes-ardeche/',
		'/fr/domaine-solio---lodge-isolee-nature-animaux'  => '/tente-safari-glamping-ardeche/',
		'/fr/bien-preparer-votre-sejour'                   => '/faq/',
		'/fr/toutes-les-proprietes'                        => '/tarifs-et-reservation/',
		'/fr/options'                                      => '/tarifs-et-reservation/',
		'/fr/decouverte'                                   => '/activites-autour-du-domaine/',
		'/fr/contactez-nous'                               => '/contact/',
		'/fr/vie-du-domaine'                               => '/le-domaine/',

		'/en'                                              => '/',
		'/en/to-complete'                                  => '/gite-10-personnes-ardeche/',
		'/en/aventura-lodge-tente-tout-confort'            => '/tente-safari-glamping-ardeche/',
		'/en/faq'                                          => '/faq/',
		'/en/all-properties'                               => '/tarifs-et-reservation/',
		'/en/options'                                      => '/tarifs-et-reservation/',
		'/en/discovery'                                    => '/activites-autour-du-domaine/',
		'/en/contact-us'                                   => '/contact/',
		'/en/life-on-the-estate'                           => '/le-domaine/',
	);
}

/**
 * Redirige une adresse obsolete vers sa page actuelle.
 */
function gf_seo_redirect() {
	if ( is_admin() || ! is_404() ) {
		return;
	}

	$chemin = wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH );
	if ( ! $chemin ) {
		return;
	}
	$normalise = '/' . trim( $chemin, '/' );

	// 1. Anciennes adresses WordPress (changement de slug ou de parent).
	$table = (array) get_option( 'gf_seo_redirections', array() );
	foreach ( $table as $ancien => $page_id ) {
		if ( $normalise === '/' . trim( $ancien, '/' ) ) {
			$cible = get_permalink( (int) $page_id );
			if ( $cible ) {
				wp_safe_redirect( $cible, 301 );
				exit;
			}
		}
	}

	// 2. Anciennes adresses Lodgify.
	foreach ( gf_seo_redirections_lodgify() as $ancien => $cible ) {
		if ( strcasecmp( $normalise, '/' . trim( $ancien, '/' ) ) === 0 ) {
			wp_safe_redirect( home_url( $cible ), 301 );
			exit;
		}
	}
}
add_action( 'template_redirect', 'gf_seo_redirect', 5 );
