<?php
/**
 * gf-seo-icons.php — Les pictogrammes du site, dessines par le serveur.
 *
 * Jusqu’ici les icones des pastilles de capacite et de la grille d’equipements etaient
 * tracees au chargement par deux blocs <script>. Consequence : aucun robot d’IA n’en voyait
 * une seule, et une panne de JavaScript laissait les blocs nus.
 *
 * Elles vivent desormais ici, en PHP, et sont rendues dans la source de la page.
 * Le trace est exactement celui qui tournait en production — meme grille, memes courbes.
 *
 * Deux familles cohabitent :
 *   - les icones d’equipement, dessinees sur une grille de 24 × 24 ;
 *   - les icones de pastille (prefixe « badge- »), sur des grilles plus hautes, parce
 *     qu’un lit ou une porte ne se lisent pas dans un carre.
 *
 * La couleur n’est pas ecrite dans le trace : chaque icone herite du `color` de son
 * conteneur (`currentColor`), ce qui laisse la feuille de style decider.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Le jeu d’icones complet.
 *
 * Chaque entree porte sa grille de dessin (`vb`), sa taille naturelle (`w`, `h`) et son
 * trace (`d`). La taille n’est qu’un defaut : la feuille de style la surcharge presque
 * toujours.
 *
 * @return array<string,array{vb:string,w:int,h:int,d:string}>
 */
function gf_seo_icones() {
	static $icones = null;
	if ( null !== $icones ) {
		return $icones;
	}

	// Icones d’equipement : grille 24 × 24, trait seul, aucune surface pleine sauf mention.
	$carre = array(
		'hottub'   => '<path d="M4 10h16v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M7.5 3.5q1 1 0 2.5M12 3q1 1 0 2.5M16.5 3.5q1 1 0 2.5"/>',
		'pool'     => '<path d="M3 17c1.8-1.4 3.6-1.4 5.4 0s3.6 1.4 5.4 0 3.6-1.4 5.4 0"/><path d="M3 20.5c1.8-1.4 3.6-1.4 5.4 0s3.6 1.4 5.4 0 3.6-1.4 5.4 0"/><path d="M8 14V5.5M12 14V5.5M8 8.5h4"/>',
		'kitchen'  => '<path d="M6 3v5a2 2 0 0 0 4 0V3M8 3v18"/><path d="M17 3c-1.8 1.5-2.6 3.5-2.6 5.6 0 1.6 1 2.6 2.6 2.6V21"/>',
		'bbq'      => '<path d="M5 8h14a7 7 0 0 1-14 0z"/><path d="M8.2 14.6L6 20M15.8 14.6L18 20M12 15v2.2"/><path d="M8 3q1 1 0 2.4M12 2.6q1 1 0 2.4M16 3q1 1 0 2.4"/>',
		'shower'   => '<path d="M12 4v2.5"/><path d="M6.8 11a5.2 5.2 0 0 1 10.4 0z"/><path d="M8 14l-.6 1.8M12 14v1.8M16 14l.6 1.8"/>',
		'wc'       => '<path d="M6.5 4h5v7h-5z"/><path d="M6.5 11a6 6 0 0 0 12 0h-7"/><path d="M10.5 17l-1.2 3h7l-1.2-3"/>',
		'bed'      => '<path d="M3 8v10M3 15h18v3M21 15v-4a3 3 0 0 0-3-3H9v7"/><circle cx="6" cy="10.5" r="1.7"/>',
		'terrace'  => '<circle cx="12" cy="9" r="3.4"/><path d="M12 2.5V4M5.8 4.8l1 1M18.2 4.8l-1 1M3 9h1.5M19.5 9H21"/><path d="M4 16.5h16M7 20h10"/>',
		'parking'  => '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9.5 17V7h3.5a3 3 0 0 1 0 6H9.5"/>',
		'wifi'     => '<path d="M3.5 9.5a13 13 0 0 1 17 0"/><path d="M6.5 13a9 9 0 0 1 11 0"/><path d="M9.5 16.3a5 5 0 0 1 5 0"/><circle cx="12" cy="19.3" r="1.2" fill="currentColor" stroke="none"/>',
		'washer'   => '<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><circle cx="12" cy="13.2" r="4.1"/><path d="M9.3 12.4c1.7 1.3 3.7 1.3 5.4 0"/><circle cx="7.6" cy="6.3" r=".9" fill="currentColor" stroke="none"/>',
		'baby'     => '<path d="M10 3.5h4M12 3.5V6"/><rect x="9" y="6" width="6" height="14.5" rx="3"/><path d="M9 11h6"/>',
		'safety'   => '<path d="M12 3l7 2.8v5.2c0 4.8-2.9 7.9-7 10-4.1-2.1-7-5.2-7-10V5.8z"/><path d="M9.3 12.2l2 2 3.6-4.2"/>',
		'power'    => '<path d="M13.2 2.5L5.5 13.5h5l-1.2 8 7.7-11h-5z"/>',
		'games'    => '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" stroke="none"/>',
		'pets'     => '<path d="M16.5 15.6h-9A3 3 0 0 1 7 9.7a3 3 0 0 1 4.8-2.3A3 3 0 0 1 17 9.6a3 3 0 0 1-.5 6z"/><path d="M9.6 15.6v2.6M13.8 15.6v2.6"/><circle cx="18" cy="12.7" r="2.05" fill="currentColor" stroke="none"/><path d="M19.9 11.1c.8-.2 1.5.2 1.7 1.1"/>',
		'trail'    => '<path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7" fill="currentColor" stroke="none"/>',
		'petanque' => '<circle cx="9" cy="14" r="4.2"/><circle cx="16.5" cy="15.5" r="2.8"/><circle cx="14.5" cy="8" r="1.3"/>',
		'billard'  => '<circle cx="8.3" cy="12.5" r="4.4"/><text x="8.3" y="15" font-size="4.6" text-anchor="middle" fill="currentColor" stroke="none" font-family="Arial,sans-serif" font-weight="bold">8</text><circle cx="16.6" cy="15" r="3.2"/>',
		'babyfoot' => '<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M8 4.5v15M14 4.5v15"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
	);

	$icones = array();
	foreach ( $carre as $cle => $trace ) {
		$icones[ $cle ] = array( 'vb' => '0 0 24 24', 'w' => 24, 'h' => 24, 'd' => $trace );
	}

	// Icones de pastille : grilles plus hautes, geometrie reprise du dessin d’origine.
	// Le lit simple est plus etroit et n’a qu’un oreiller, le double en a deux : c’est la
	// meme regle que le BedIcon de GuestFlow.
	$icones['badge-people'] = array(
		'vb' => '0 0 28 28', 'w' => 20, 'h' => 20,
		'd'  => '<circle cx="10.5" cy="9" r="3.4"/><path d="M4 23c0-3.6 2.9-6.5 6.5-6.5S17 19.4 17 23"/>'
			. '<circle cx="19.5" cy="10" r="2.7"/><path d="M18.5 16.6c3.2.3 5.5 3 5.5 6.4"/>',
	);
	$icones['badge-tent'] = array(
		'vb' => '0 0 28 28', 'w' => 20, 'h' => 20,
		'd'  => '<path d="M14 4.5L2.5 24h23z"/><path d="M14 24l-3.8-8M14 24l3.8-8"/><path d="M1.5 24h25"/>',
	);
	$icones['badge-door'] = array(
		'vb' => '0 0 24 28', 'w' => 17, 'h' => 20,
		'd'  => '<path d="M5 26V3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v23"/><path d="M3 26h18"/>'
			. '<circle cx="15.5" cy="14.5" r="1.2" fill="currentColor" stroke="none"/>',
	);
	$icones['badge-shower'] = array(
		'vb' => '0 0 24 28', 'w' => 19, 'h' => 20,
		'd'  => '<path d="M12 3v3"/><path d="M5 11C5 7 9 6 12 6C15 6 19 7 19 11Z"/><path d="M9 14l-1 3.5M12 15l-1 4M15 14l-1 3.5"/>',
	);
	$icones['badge-wc'] = array(
		'vb' => '0 0 24 28', 'w' => 17, 'h' => 20,
		'd'  => '<rect x="6" y="3.5" width="12" height="6" rx="1.5"/><path d="M7 11h10v1a5 5 0 0 1-10 0z"/>'
			. '<path d="M9.5 17l-1.5 6.5h8L14.5 17"/>',
	);
	foreach ( array( 'single' => 30, 'double' => 42 ) as $type => $largeur_grille ) {
		$oreillers = 'single' === $type
			? '<rect x="9" y="8" width="12" height="6" rx="3"/>'
			: '<rect x="8" y="8" width="12" height="6" rx="3"/><rect x="22" y="8" width="12" height="6" rx="3"/>';
		$icones[ 'badge-bed-' . $type ] = array(
			'vb' => '0 0 ' . $largeur_grille . ' 28',
			'w'  => (int) round( 20 * $largeur_grille / 28 ),
			'h'  => 20,
			'd'  => '<rect x="2.5" y="5" width="' . ( $largeur_grille - 5 ) . '" height="5" rx="2"/>'
				. $oreillers
				. '<rect x="2.5" y="13" width="' . ( $largeur_grille - 5 ) . '" height="9" rx="2"/>'
				. '<path d="M4 22v5M' . ( $largeur_grille - 4 ) . ' 22v5"/>',
		);
	}
	$icones['badge-stars'] = array(
		'vb' => '0 0 28 28', 'w' => 20, 'h' => 20,
		'd'  => gf_seo_icone_etoiles(),
	);

	return $icones;
}

/**
 * Trois etoiles alignees : un classement se compte en rangee, pas en bouquet.
 *
 * @return string Trace SVG des trois etoiles.
 */
function gf_seo_icone_etoiles() {
	$trace = '';
	foreach ( array( 4.9, 14.0, 23.1 ) as $cx ) {
		$rayon = 4.3;
		$creux = $rayon * 0.42;
		$d     = '';
		for ( $i = 0; $i < 10; $i++ ) {
			$angle = -M_PI / 2 + $i * M_PI / 5;
			$r     = ( $i % 2 ) ? $creux : $rayon;
			$d    .= ( $i ? 'L' : 'M' )
				. number_format( $cx + $r * cos( $angle ), 2, '.', '' ) . ' '
				. number_format( 14 + $r * sin( $angle ), 2, '.', '' );
		}
		$trace .= '<path d="' . $d . 'Z"/>';
	}
	return $trace;
}

/**
 * Rend une icone en SVG inline.
 *
 * @param string $cle     Identifiant de l’icone.
 * @param array  $options width, height, stroke (epaisseur du trait), class.
 * @return string SVG, ou chaine vide si l’icone n’existe pas — une ligne sans icone
 *                vaut mieux qu’une grille cassee.
 */
function gf_seo_icone( $cle, $options = array() ) {
	$icones = gf_seo_icones();
	if ( ! isset( $icones[ $cle ] ) ) {
		return '';
	}
	$i = $icones[ $cle ];
	$o = array_merge(
		array( 'width' => $i['w'], 'height' => $i['h'], 'stroke' => 1.7, 'class' => '' ),
		$options
	);

	return '<svg width="' . (int) $o['width'] . '" height="' . (int) $o['height'] . '"'
		. ' viewBox="' . esc_attr( $i['vb'] ) . '"'
		. ( $o['class'] ? ' class="' . esc_attr( $o['class'] ) . '"' : '' )
		. ' fill="none" stroke="currentColor" stroke-width="' . esc_attr( (string) $o['stroke'] ) . '"'
		. ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
		. $i['d'] . '</svg>';
}
