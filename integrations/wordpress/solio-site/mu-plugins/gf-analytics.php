<?php
/**
 * gf-analytics.php — Mesure d'audience du site (specs/site-traffic-analytics.md §3.A et §3.B).
 *
 * Umami, heberge chez nous, sans cookie ni identifiant : aucune banniere de consentement n'est
 * due. Le script et la collecte passent par le domaine lui-meme (/_s/, relaye par Caddy vers le
 * conteneur « stats »), si bien qu'aucun domaine tiers n'est charge et que les bloqueurs de
 * publicite ne rendent pas la mesure aveugle.
 *
 * Deux reglages en base, poses a la main une fois Umami installe :
 *   - gf_analytics_umami_website_id : l'identifiant du site dans Umami. Vide = rien n'est emis ;
 *   - gf_analytics_script_path      : le chemin du script, « /_s/s.js » par defaut.
 *
 * Le tunnel de reservation emet des evenements `guestflow:booking` sur `document` (plugin
 * GuestFlow Booking ≥ 1.14.0, tiroir, barre de recherche) ; ils sont relayes ici vers Umami.
 * Une mesure qui echoue ne gene jamais une reservation : chaque relais est sous try/catch.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Faut-il mesurer cette page ? Jamais pour un utilisateur connecte (les visites d'Adrien
 * gonfleraient les chiffres), ni en administration, apercu, connexion ou appel technique.
 */
function gf_analytics_actif() {
	if ( '' === gf_analytics_website_id() ) {
		return false;
	}
	if ( is_user_logged_in() || is_admin() || is_preview() || wp_doing_ajax() ) {
		return false;
	}
	if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
		return false;
	}
	return 'wp-login.php' !== ( $GLOBALS['pagenow'] ?? '' );
}

function gf_analytics_website_id() {
	return preg_replace( '/[^a-f0-9-]/i', '', (string) get_option( 'gf_analytics_umami_website_id', '' ) );
}

add_action( 'wp_head', function () {
	if ( ! gf_analytics_actif() ) {
		return;
	}
	$script = (string) get_option( 'gf_analytics_script_path', '/_s/s.js' );
	$hote   = untrailingslashit( home_url( dirname( $script ) ) );
	printf(
		'<script defer src="%s" data-website-id="%s" data-host-url="%s" data-domains="domainesolio.com"></script>' . "\n",
		esc_url( home_url( $script ) ),
		esc_attr( gf_analytics_website_id() ),
		esc_url( $hote )
	);
	?>
<script>
(function () {
	function relayer( nom, details, essai ) {
		try {
			if ( window.umami && typeof window.umami.track === 'function' ) { window.umami.track( nom, details ); return; }
			if ( ! essai ) { window.setTimeout( function () { relayer( nom, details, 1 ); }, 1500 ); }
		} catch ( e ) {}
	}
	document.addEventListener( 'guestflow:booking', function ( e ) {
		try {
			var details = {};
			var d = e.detail || {};
			Object.keys( d ).forEach( function ( k ) { if ( 'name' !== k ) { details[ k ] = d[ k ]; } } );
			if ( d.name ) { relayer( String( d.name ), details, 0 ); }
		} catch ( err ) {}
	} );
})();
</script>
	<?php
}, 20 );
