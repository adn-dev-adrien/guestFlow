<?php
// Correctifs de contenu SEO du 2026-10-05 : champs SEO des pages, liens de /en/, gabarit des CGV.
$_SERVER['HTTP_HOST'] = 'domainesolio.com';
$_SERVER['HTTPS']     = 'on';
require '/var/www/html/wp-load.php';

$meta = json_decode( file_get_contents( '/tmp/seo-meta.json' ), true );
foreach ( $meta as $id => $v ) {
	if ( ! empty( $v['t'] ) ) {
		update_post_meta( (int) $id, '_gf_seo_title', $v['t'] );
	}
	update_post_meta( (int) $id, '_gf_seo_description', $v['d'] );
	echo "champs SEO $id ok\n";
}

$contenu = get_post( 647 )->post_content;
file_put_contents( '/tmp/bak-page-647-' . date( 'Ymd-His' ) . '.txt', $contenu );
$n1 = substr_count( $contenu, 'href="/en/la-granja/"' );
$n2 = substr_count( $contenu, 'href="/en/estiva/"' );
if ( 1 !== $n1 || 1 !== $n2 ) {
	echo "ABANDON des liens : $n1 / $n2 occurrences au lieu de 1 / 1\n";
} else {
	$contenu = str_replace(
		array( 'href="/en/la-granja/"', 'href="/en/estiva/"' ),
		array( 'href="/en/la-granja-gite/"', 'href="/en/estiva-safari-tent/"' ),
		$contenu
	);
	kses_remove_filters();
	$r = wp_update_post( array( 'ID' => 647, 'post_content' => $contenu ), true );
	echo is_wp_error( $r ) ? 'ERREUR ' . $r->get_error_message() . "\n" : "liens de /en/ corriges\n";
}

foreach ( array( 458, 654 ) as $id ) {
	update_post_meta( $id, '_wp_page_template', '' );
	echo "gabarit $id : defaut (titre H1 affiche)\n";
}

delete_transient( 'pll_languages_list' );
echo "cache Polylang purge\n";
