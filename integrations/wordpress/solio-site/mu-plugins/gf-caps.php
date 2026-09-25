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

	// Les mots de CHAQUE langue, dans la meme regle. La pastille anglaise dit « 4 bedrooms » et
	// « 2 toilets » : mesure du 2026-09-25, les 7 pictogrammes sous le hero disparaissaient sur les
	// pages anglaises parce que cette table ne connaissait que le francais (regle 53). Le texte
	// s'affichait, l'icone non — le genre de perte qu'on ne voit qu'en regardant la page.
	//
	// L'ordre compte : « lit double » avant « lit simple » n'a pas d'importance, mais `bed` seul
	// attraperait les deux, d'ou « double bed » et « single bed » en entier.
	$regles = array(
		'badge-people'      => array( 'personne', 'guest', 'people' ),
		'badge-tent'        => array( 'glamping', 'tente', 'tent' ),
		'badge-stars'       => array( 'étoile', 'épis', 'gîtes de france', 'star', 'épi' ),
		'badge-door'        => array( 'chambre', 'bedroom' ),
		'badge-bed-single'  => array( 'lit simple', 'lits simples', 'single bed' ),
		'badge-bed-double'  => array( 'lit double', 'lits doubles', 'double bed' ),
		'badge-shower'      => array( 'salle', 'shower' ),   // salle d’eau / shower room
		'badge-wc'          => array( 'toilette', 'wc', 'toilet' ),
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
 * Le vert du pictogramme.
 *
 * Le trace est en `currentColor` et la pastille ecrit son texte en #2f3a26 : sans cette
 * regle, l’icone prendrait la couleur du texte au lieu du vert qu’elle a toujours eu.
 */
add_action(
	'wp_enqueue_scripts',
	function () {
		wp_register_style( 'gf-caps', false );
		wp_enqueue_style( 'gf-caps' );
		wp_add_inline_style( 'gf-caps', '.gf-cap svg{ color:#5a6b48; }' );
	}
);

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
