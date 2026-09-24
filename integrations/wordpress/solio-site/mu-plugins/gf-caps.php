<?php
/**
 * Plugin Name: Domaine Solio — Capacity badge icons
 * Description: Draws the room/bed/bathroom pictogram of every .gf-cap badge, server-side, from the
 *              icon map in gf-seo-icons.php. The markup written in the page stays untouched: the
 *              icon is inserted at render time, which is late enough to escape KSES (it only
 *              strips inline <svg> when the post is saved) and early enough for crawlers to read
 *              it. Bed geometry mirrors the GuestFlow BedIcon (single = 1 pillow & narrower,
 *              double = 2 pillows & wider). The classification badge shows three stars in a row,
 *              the unit the rating is actually counted in, rather than a leaf.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Icone qui convient a l’intitule d’une pastille.
 *
 * L’ordre des tests compte : « 3 étoiles » doit trouver le classement avant que « lit simple »
 * ou « chambre » ne s’en melent, et le lit simple passe avant le double parce que les deux
 * libelles contiennent le mot « lit ».
 *
 * @param string $texte Intitule de la pastille, sans balise ni entite.
 * @return string Cle d’icone, ou chaine vide si aucune ne convient.
 */
function gf_caps_icone_pour( $texte ) {
	$t = function_exists( 'mb_strtolower' ) ? mb_strtolower( $texte, 'UTF-8' ) : strtolower( $texte );

	$regles = array(
		'badge-people'      => array( 'personne' ),
		'badge-tent'        => array( 'glamping', 'tente' ),
		'badge-stars'       => array( 'étoile', 'épis', 'gîtes de france' ),
		'badge-door'        => array( 'chambre' ),
		'badge-bed-single'  => array( 'lit simple', 'lits simples' ),
		'badge-bed-double'  => array( 'lit double', 'lits doubles' ),
		'badge-shower'      => array( 'salle' ),   // salle d’eau / salles d’eau
		'badge-wc'          => array( 'toilette', 'wc' ),
	);

	foreach ( $regles as $icone => $mots ) {
		foreach ( $mots as $mot ) {
			if ( false !== strpos( $t, $mot ) ) {
				return $icone;
			}
		}
	}
	return '';
}

/**
 * Pose le pictogramme dans chaque pastille du contenu.
 */
add_filter(
	'the_content',
	function ( $contenu ) {
		if ( false === strpos( $contenu, 'gf-cap' ) || ! function_exists( 'gf_seo_icone' ) ) {
			return $contenu;
		}

		return preg_replace_callback(
			'~<span class="gf-cap">(?!\s*<svg)(.*?)</span>~s',
			function ( $m ) {
				$texte = html_entity_decode( wp_strip_all_tags( $m[1] ), ENT_QUOTES, 'UTF-8' );
				$icone = gf_caps_icone_pour( $texte );
				if ( '' === $icone ) {
					return $m[0];
				}
				// L’intitule passe dans un <span> a lui : la pastille est une colonne
				// (icone au-dessus, texte en dessous) et un noeud texte nu s’y aligne mal.
				return '<span class="gf-cap">' . gf_seo_icone( $icone ) . '<span>' . $m[1] . '</span></span>';
			},
			$contenu
		);
	},
	20
);
