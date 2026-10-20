<?php
// Titres et descriptions Google de trois pages françaises (specs/booking-drawer-friction.md règle 18).
// Chaque page est retrouvée par son adresse, et rien n'est écrit si sa description actuelle n'est pas
// celle relevée le 2026-10-19 : un texte changé depuis serait écrasé sans que personne le voie.
$_SERVER['HTTP_HOST'] = 'domainesolio.com';
$_SERVER['HTTPS']     = 'on';
require '/var/www/html/wp-load.php';

$meta = json_decode( file_get_contents( '/tmp/seo-meta-20261019.json' ), true );
$bak  = array();
foreach ( $meta as $cle => $v ) {
	$id = 'front' === $v['page'] ? (int) get_option( 'page_on_front' ) : (int) ( get_page_by_path( $v['page'] )->ID ?? 0 );
	if ( ! $id ) { echo "ABANDON $cle : page introuvable\n"; continue; }
	$avant_t = get_post_meta( $id, '_gf_seo_title', true );
	$avant_d = get_post_meta( $id, '_gf_seo_description', true );
	$bak[ $id ] = array( 't' => $avant_t, 'd' => $avant_d );
	if ( '' !== $avant_d && $avant_d !== $v['avant_d'] ) {
		echo "ABANDON $cle (page $id) : la description a changé depuis le 19/10 — « $avant_d »\n";
		continue;
	}
	update_post_meta( $id, '_gf_seo_title', $v['t'] );
	update_post_meta( $id, '_gf_seo_description', $v['d'] );
	echo "ok $cle (page $id)\n";
}
file_put_contents( '/tmp/bak-seo-meta-' . date( 'Ymd-His' ) . '.json', wp_json_encode( $bak, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );
// Une écriture par wp-load reconstruit le cache des langues de Polylang avec l'hôte de la requête :
// on le purge, le prochain appel avec le bon Host le refait juste.
delete_transient( 'pll_languages_list' );
echo "anciennes valeurs sauvegardées dans /tmp/bak-seo-meta-*.json du conteneur wp_app\n";
