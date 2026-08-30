<?php
/**
 * gf-seo-perf.php — Reglages de performance d’affichage.
 *
 * Objectif : ne rien laisser bloquer le premier rendu. Le contenu descriptif du site doit
 * s’afficher meme si tout le JavaScript echoue — c’est vrai pour un visiteur sur un reseau
 * mediocre comme pour un robot d’IA qui n’execute pas de script.
 *
 * Cibles : LCP sous 2,5 s, CLS sous 0,1, INP sous 200 ms sur mobile.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Scripts a ne surtout pas differer.
 *
 * jQuery est requis en synchrone par des scripts en ligne des extensions (MetaSlider et le
 * widget d’avis ecrivent des appels jQuery directement dans la page) : le differer casserait
 * les carrousels.
 */
function gf_perf_scripts_critiques() {
	return array( 'jquery-core', 'jquery-migrate', 'jquery' );
}

/**
 * Ajoute defer aux scripts non critiques.
 *
 * defer plutot que async : l’ordre d’execution est conserve, ce qui est indispensable pour
 * les extensions qui dependent les unes des autres (FlexSlider avant MetaSlider, par exemple).
 */
add_filter(
	'script_loader_tag',
	function ( $tag, $handle ) {
		if ( is_admin() ) {
			return $tag;
		}
		if ( in_array( $handle, gf_perf_scripts_critiques(), true ) ) {
			return $tag;
		}
		if ( false !== strpos( $tag, ' defer' ) || false !== strpos( $tag, ' async' ) ) {
			return $tag;
		}
		if ( false === strpos( $tag, ' src=' ) ) {
			return $tag; // Script en ligne.
		}
		return str_replace( ' src=', ' defer src=', $tag );
	},
	10,
	2
);

/**
 * Prechargement de la police principale.
 *
 * Le navigateur decouvre normalement les fichiers woff2 apres avoir analyse la feuille de
 * style : un aller-retour de trop avant que le texte s’affiche.
 */
add_action(
	'wp_head',
	function () {
		$dossier = wp_get_upload_dir()['basedir'] . '/fonts';
		$fichiers = glob( $dossier . '/roboto-*.woff2' );
		if ( ! $fichiers ) {
			return;
		}
		// La variante la plus lourde est celle qui porte le texte courant : on precharge
		// la premiere, les autres suivront naturellement.
		sort( $fichiers );
		printf(
			"<link rel=\"preload\" as=\"font\" type=\"font/woff2\" href=\"%s\" crossorigin />\n",
			esc_url( '/wp-content/uploads/fonts/' . basename( $fichiers[0] ) )
		);
	},
	2
);

/**
 * Allegement du <head> : styles et scripts inutiles sur un site vitrine.
 */
add_action(
	'wp_enqueue_scripts',
	function () {
		// Les emoji de WordPress ajoutent un script et une feuille de style pour rien.
		remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
		remove_action( 'wp_print_styles', 'print_emoji_styles' );

		// La feuille des blocs classiques n’est pas utilisee par le theme.
		wp_dequeue_style( 'classic-theme-styles' );
	},
	100
);

/**
 * MetaSlider et son extension lightbox chargeaient onze fichiers (dont video-js) sur
 * chaque page, y compris celles qui n’ont aucun carrousel. On les retire partout sauf sur
 * les deux pages d’hebergement, qui sont les seules a porter un diaporama.
 */
add_action(
	'wp_enqueue_scripts',
	function () {
		if ( is_admin() ) {
			return;
		}
		$contenu = is_singular() ? get_post_field( 'post_content', get_queried_object_id() ) : '';
		if ( false !== strpos( $contenu, 'metaslider' ) ) {
			return;
		}

		// Retrait par chemin de fichier : les extensions changent parfois de nom d’identifiant
		// d’une version a l’autre, le chemin, lui, reste stable.
		foreach ( array( wp_styles(), wp_scripts() ) as $file ) {
			foreach ( $file->registered as $handle => $ressource ) {
				if ( ! empty( $ressource->src ) && false !== strpos( $ressource->src, 'ml-slider' ) ) {
					$file->dequeue( $handle );
				}
			}
		}
	},
	999
);
