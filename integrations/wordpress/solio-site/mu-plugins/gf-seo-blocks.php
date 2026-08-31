<?php
/**
 * gf-seo-blocks.php — Contenus factuels rendus par le serveur.
 *
 * Quatre codes courts, tous rendus en PHP : le HTML produit est present dans la source de
 * la page, sans aucun JavaScript. C’est la condition pour que Google et les robots d’IA
 * (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot) puissent lire et citer ces informations.
 *
 *   [solio_essentiel logement="gite"]   encadre « L’essentiel » : les faits bruts
 *   [solio_tarifs    logement="gite"]   tarifs et options, lus dans GuestFlow
 *   [solio_faq       page="gite"]       questions frequentes, en <details> natifs
 *   [solio_geo]                         paragraphe de contexte geographique
 *
 * Les donnees viennent toutes de gf-seo-facts.php, qui alimente aussi le JSON-LD.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Remplace le jeton %prix% par le tarif vivant de l’hebergement.
 *
 * @param string $texte Texte contenant eventuellement %prix%.
 * @param array  $l     Hebergement.
 * @return string
 */
function gf_seo_tokens( $texte, $l ) {
	$prix = ! empty( $l['prix_min_nuit'] ) ? gf_seo_prix( $l['prix_min_nuit'] ) : 'un tarif variable selon la saison';
	return str_replace( '%prix%', $prix, $texte );
}

/**
 * Encadre « L’essentiel » : une liste de definitions, lisible et citable.
 */
function gf_seo_shortcode_essentiel( $atts ) {
	$atts = shortcode_atts( array( 'logement' => '' ), $atts );
	$l    = gf_seo_lodging( $atts['logement'] );
	if ( ! $l ) {
		return '';
	}
	$d = gf_seo_domaine();

	// Capacite, chambres et salles d’eau sont deja affichees juste au-dessus par les
	// pastilles a icones : les repeter ici n’apporterait rien au lecteur.
	$lignes = array();

	if ( ! empty( $l['superficie_detail'] ) ) {
		$lignes['Superficie'] = $l['superficie_detail'];
	} elseif ( $l['superficie_m2'] ) {
		$lignes['Superficie'] = $l['superficie_m2'] . ' m²';
	}
	if ( $l['label'] ) {
		$lignes['Label'] = $l['label'] . ( $l['numero_label'] ? ' — n° ' . $l['numero_label'] : '' );
	}

	$arrivee = ! empty( $l['checkin_fin'] )
		? 'entre ' . gf_seo_heure( $l['checkin'] ) . ' et ' . gf_seo_heure( $l['checkin_fin'] )
		: 'à partir de ' . gf_seo_heure( $l['checkin'] );
	$lignes['Arrivée / départ'] = $arrivee . ', départ avant ' . gf_seo_heure( $l['checkout'] );
	if ( ! empty( $l['saison'] ) ) {
		$lignes['Saison'] = $l['saison'];
	}
	$lignes['Wifi']             = $l['wifi'] ? 'oui, gratuit' : 'non, volontairement';
	$lignes['Animaux']          = $d['chiens_acceptes'] ? 'chiens acceptés' : 'chiens non acceptés — bébés et enfants bienvenus';
	$lignes['Bain nordique']    = $l['bain_nordique'];
	if ( ! empty( $l['non_fumeur'] ) ) {
		$lignes['Non-fumeur'] = 'oui, hébergement entièrement non-fumeur';
	}
	if ( isset( $l['accessible_pmr'] ) && false === $l['accessible_pmr'] ) {
		$lignes['Accessibilité'] = $l['accessible_pmr_note'] ?? 'non adapté aux personnes à mobilité réduite';
	}

	if ( $l['caution'] ) {
		$lignes['Caution'] = gf_seo_prix( $l['caution'] );
	}
	if ( ! empty( $l['prix_min_nuit'] ) ) {
		$lignes['Tarif'] = 'à partir de ' . gf_seo_prix( $l['prix_min_nuit'] ) . ' la nuit, dégressif selon la durée';
	}

	$lignes['Cadre']  = 'domaine privé de ' . $d['superficie_ha'] . ' hectares, ' . $d['nb_hebergements'] . ' hébergements en tout';
	$lignes['Adresse'] = $d['rue'] . ', ' . $d['code_postal'] . ' ' . $d['ville'] . ' (' . $d['region'] . ')';

	$html  = '<div class="gf-essentiel"><h2 class="gf-essentiel-titre">L’essentiel</h2><dl>';
	foreach ( $lignes as $terme => $valeur ) {
		$html .= '<div class="gf-essentiel-ligne"><dt>' . esc_html( $terme ) . '</dt><dd>' . esc_html( $valeur ) . '</dd></div>';
	}
	$html .= '</dl></div>';

	return $html;
}
add_shortcode( 'solio_essentiel', 'gf_seo_shortcode_essentiel' );

/**
 * Formate « 16:00 » en « 16h00 ».
 */
function gf_seo_heure( $h ) {
	return str_replace( ':', 'h', (string) $h );
}

/**
 * Tarifs et options, lus dans GuestFlow et rendus en tableau HTML.
 *
 * Sans ce bloc, les prix n’existent que dans le moteur de reservation en JavaScript :
 * ni Google ni les assistants d’IA ne peuvent les lire.
 */
function gf_seo_shortcode_tarifs( $atts ) {
	$atts = shortcode_atts( array( 'logement' => '' ), $atts );
	$l    = gf_seo_lodging( $atts['logement'] );
	if ( ! $l ) {
		return '';
	}
	$t = gf_seo_guestflow_tarifs( $l['guestflow_id'] );

	$html = '<div class="gf-tarifs"><h2>Tarifs et options</h2>';

	if ( ! empty( $l['prix_min_nuit'] ) ) {
		$html .= '<p class="gf-tarifs-depart">Séjour à partir de <strong>' . esc_html( gf_seo_prix( $l['prix_min_nuit'] ) )
			. '</strong> la nuit, tarif dégressif à partir de 3 nuits.</p>';
	}

	$sections = array();
	if ( $t['simples'] ) {
		$sections[] = array( 'titre' => 'Services', 'lignes' => $t['simples'] );
	}
	if ( $t['ressources'] ) {
		$sections[] = array( 'titre' => 'À réserver sur place', 'lignes' => $t['ressources'] );
	}
	foreach ( $t['groupes'] as $g ) {
		$sections[] = array( 'titre' => $g['categorie'], 'lignes' => $g['options'] );
	}

	foreach ( $sections as $s ) {
		$html .= '<h3>' . esc_html( $s['titre'] ) . '</h3><table class="gf-tarifs-table"><tbody>';
		foreach ( $s['lignes'] as $o ) {
			$html .= '<tr><th scope="row">' . esc_html( $o['titre'] ) . '</th><td>'
				. esc_html( gf_seo_prix( $o['prix'] ) )
				. ( $o['unite'] ? ' <span class="gf-tarifs-unite">' . esc_html( $o['unite'] ) . '</span>' : '' )
				. '</td></tr>';
		}
		$html .= '</tbody></table>';
	}

	if ( ! $sections ) {
		$html .= '<p>Les options sont détaillées dans le moteur de réservation ci-dessous.</p>';
	}

	$html .= '<p class="gf-tarifs-note">Tarifs indicatifs, à jour au ' . esc_html( date_i18n( 'j F Y' ) )
		. '. Le prix exact de votre séjour s’affiche en choisissant vos dates ci-dessous.</p></div>';

	return $html;
}
add_shortcode( 'solio_tarifs', 'gf_seo_shortcode_tarifs' );

/**
 * Prix d’une option precise, lu dans GuestFlow.
 *
 * Permet d’ecrire un tarif au fil du texte — dans le titre d’une carte, par exemple — sans
 * le figer dans le contenu. Le jour ou le prix change dans GuestFlow, la page suit.
 *
 *   [solio_prix option="Animation-visite animaux"]          → « 30 € par participant »
 *   [solio_prix option="Petit déjeuner" unite="non"]        → « 8 € »
 *   [solio_prix option="Linge de toilette" prefixe="dès "]  → « dès 8 € par personne »
 */
function gf_seo_shortcode_prix( $atts ) {
	$atts = shortcode_atts(
		array(
			'option'   => '',
			'logement' => 'gite',
			'unite'    => 'oui',
			'prefixe'  => '',
			'suffixe'  => '',
		),
		$atts
	);
	$l = gf_seo_lodging( $atts['logement'] );
	if ( ! $l || '' === $atts['option'] ) {
		return '';
	}
	$t = gf_seo_guestflow_tarifs( $l['guestflow_id'] );

	$toutes = $t['simples'];
	foreach ( $t['groupes'] as $g ) {
		$toutes = array_merge( $toutes, $g['options'] );
	}
	$toutes = array_merge( $toutes, $t['ressources'] );

	$cherche = gf_seo_normalise( $atts['option'] );
	foreach ( $toutes as $o ) {
		if ( gf_seo_normalise( $o['titre'] ) !== $cherche ) {
			continue;
		}
		$texte = gf_seo_prix( $o['prix'] );
		if ( 'oui' === $atts['unite'] && $o['unite'] ) {
			$texte .= ' ' . $o['unite'];
		}
		return esc_html( $atts['prefixe'] . $texte . $atts['suffixe'] );
	}
	// Option introuvable dans GuestFlow : on n’affiche rien plutot qu’un prix errone.
	return '';
}
add_shortcode( 'solio_prix', 'gf_seo_shortcode_prix' );

/**
 * Normalise un libelle pour le comparer sans se soucier des accents ni de la casse.
 */
function gf_seo_normalise( $texte ) {
	$texte = remove_accents( (string) $texte );
	$texte = preg_replace( '~[^a-z0-9]+~i', ' ', $texte );
	return trim( strtolower( $texte ) );
}

/**
 * Tarifs de nuitee des deux hebergements, lus dans GuestFlow.
 *
 * Volontairement compact : le detail des options se trouve dans les cartes de la page.
 */
function gf_seo_shortcode_tarifs_nuits() {
	$html = '<div class="gf-nuits"><h2>Tarifs des hébergements</h2><dl>';
	foreach ( array( 'gite', 'lodge' ) as $cle ) {
		$l = gf_seo_lodging( $cle );
		if ( ! $l || empty( $l['prix_min_nuit'] ) ) {
			continue;
		}
		$html .= '<div class="gf-nuits-ligne"><dt><a href="' . esc_url( home_url( '/' . $l['slug'] . '/' ) ) . '">'
			. esc_html( $l['nom'] ) . '</a></dt><dd>à partir de <strong>' . esc_html( gf_seo_prix( $l['prix_min_nuit'] ) )
			. '</strong> la nuit</dd></div>';
	}
	$html .= '</dl><p class="gf-nuits-note">Tarifs dégressifs à partir de 3 nuits. Le prix exact de votre séjour '
		. 'dépend des dates et du nombre de personnes : il s’affiche en choisissant vos dates sur la page de chaque hébergement.</p></div>';

	return $html;
}
add_shortcode( 'solio_tarifs_nuits', 'gf_seo_shortcode_tarifs_nuits' );

/**
 * Questions frequentes en <details> natifs : le texte est dans la source meme replie.
 *
 * gf-seo-schema.php lit le meme tableau de questions pour produire le balisage FAQPage :
 * l’affichage et les donnees structurees ne peuvent pas diverger.
 */
function gf_seo_shortcode_faq( $atts ) {
	$atts = shortcode_atts( array( 'page' => '', 'titre' => 'Questions fréquentes' ), $atts );
	$faq  = gf_seo_faq( $atts['page'] );
	if ( ! $faq ) {
		return '';
	}
	$l = gf_seo_lodging( $atts['page'] );

	$html = '<section class="gf-faq-seo"><h2>' . esc_html( $atts['titre'] ) . '</h2>';
	foreach ( $faq as $i => $item ) {
		$reponse = $l ? gf_seo_tokens( $item['r'], $l ) : $item['r'];
		$html   .= '<details class="gf-faq-item"' . ( 0 === $i ? ' open' : '' ) . '>'
			. '<summary><h3>' . esc_html( $item['q'] ) . '</h3></summary>'
			. '<div class="gf-faq-reponse"><p>' . esc_html( $reponse ) . '</p></div>'
			. '</details>';
	}
	$html .= '</section>';

	return $html;
}
add_shortcode( 'solio_faq', 'gf_seo_shortcode_faq' );

/**
 * Comparatif des deux hebergements, en tableau HTML lisible sans JavaScript.
 *
 * Repond directement a la question « lequel choisir ? », que les moteurs et les
 * assistants recoivent en permanence.
 */
function gf_seo_shortcode_comparatif() {
	$gite  = gf_seo_lodging( 'gite' );
	$lodge = gf_seo_lodging( 'lodge' );
	if ( ! $gite || ! $lodge ) {
		return '';
	}

	$lignes = array(
		'Capacité'         => array(
			$gite['capacite'] . ' personnes, jusqu’à ' . $gite['capacite_max'],
			$lodge['capacite'] . ' personnes',
		),
		'Chambres'         => array( $gite['chambres'], $lodge['chambres'] ),
		'Superficie'       => array(
			$gite['superficie_detail'] ?? ( $gite['superficie_m2'] . ' m²' ),
			$lodge['superficie_detail'] ?? ( $lodge['superficie_m2'] . ' m²' ),
		),
		'Salles d’eau'     => array( $gite['salles_eau'], $lodge['salles_eau'] ),
		'Type'             => array( 'Maison de famille rénovée', 'Tente safari sur terrasse bois' ),
		'Wifi'             => array( 'Oui, gratuit', 'Non, volontairement' ),
		'Cuisine'          => array( 'Cuisine entièrement équipée', 'Kitchenette, on cuisine dehors' ),
		'Chauffage'        => array( 'Poêle à bois, bois fourni', 'Eau chaude et électricité' ),
		// Majuscule en tete : ces valeurs servent aussi de phrase dans l’encadre « L’essentiel ».
		'Saison'           => array(
			ucfirst( $gite['saison'] ),
			ucfirst( $lodge['saison'] ),
		),
		'Bain nordique'    => array( $gite['bain_nordique'], $lodge['bain_nordique'] ),
		'Caution'          => array( $gite['caution'] ? gf_seo_prix( $gite['caution'] ) : '—', gf_seo_prix( $lodge['caution'] ) ),
		'À partir de'      => array(
			gf_seo_prix( $gite['prix_min_nuit'] ) . ' / nuit',
			gf_seo_prix( $lodge['prix_min_nuit'] ) . ' / nuit',
		),
	);

	$html  = '<div class="gf-comparatif"><h2>Lequel choisir ?</h2>';
	$html .= '<table class="gf-comparatif-table"><thead><tr><td></td>'
		. '<th scope="col"><a href="' . esc_url( home_url( '/' . $gite['slug'] . '/' ) ) . '">' . esc_html( $gite['nom'] ) . '</a></th>'
		. '<th scope="col"><a href="' . esc_url( home_url( '/' . $lodge['slug'] . '/' ) ) . '">' . esc_html( $lodge['nom'] ) . '</a></th>'
		. '</tr></thead><tbody>';
	foreach ( $lignes as $critere => $valeurs ) {
		$html .= '<tr><th scope="row">' . esc_html( $critere ) . '</th>'
			. '<td>' . esc_html( $valeurs[0] ) . '</td><td>' . esc_html( $valeurs[1] ) . '</td></tr>';
	}
	$html .= '</tbody></table></div>';

	return $html;
}
add_shortcode( 'solio_comparatif', 'gf_seo_shortcode_comparatif' );

/**
 * Paragraphe de contexte geographique : nomme explicitement les reperes du territoire.
 */
function gf_seo_shortcode_geo( $atts ) {
	$atts = shortcode_atts( array( 'titre' => 'Où sommes-nous ?' ), $atts );
	$d    = gf_seo_domaine();

	$html = '<section class="gf-geo"><h2>' . esc_html( $atts['titre'] ) . '</h2>';
	$html .= '<p>Le domaine est à ' . esc_html( $d['ville'] ) . ', en ' . esc_html( $d['territoire'] )
		. ', à sept minutes du village. Autour : le Safari de Peaugres, le lac de Devesset, la Via Fluvia, '
		. 'Lalouvesc et Saint-Félicien — de quoi remplir une semaine sans reprendre l’autoroute.</p>';

	$html .= '<h3>Distances depuis le domaine</h3><ul class="gf-geo-distances">';
	foreach ( gf_seo_distances() as $x ) {
		$html .= '<li><strong>' . esc_html( $x['lieu'] ) . '</strong> : ' . esc_html( $x['valeur'] ) . '</li>';
	}
	$html .= '</ul>';
	$html .= '<p class="gf-geo-adresse">Adresse exacte : ' . esc_html( $d['rue'] ) . ', ' . esc_html( $d['code_postal'] )
		. ' ' . esc_html( $d['ville'] ) . '. Coordonnées GPS : ' . esc_html( $d['latitude'] ) . ', ' . esc_html( $d['longitude'] ) . '.</p>';
	$html .= '</section>';

	return $html;
}
add_shortcode( 'solio_geo', 'gf_seo_shortcode_geo' );

/**
 * Styles des blocs factuels. Charte reprise du reste du site : vert sapin sur fond papier.
 */
add_action(
	'wp_enqueue_scripts',
	function () {
		$css = <<<'CSS'
/* Les blocs factuels reprennent la largeur de contenu du theme (645 px) pour rester
   alignes avec les paragraphes qui les entourent ; les tableaux beneficient d'un peu
   plus d'air, sans depasser la largeur « wide » du theme. */
.gf-nuits { max-width: 645px; margin: 44px auto; padding: 0 22px; }
.gf-nuits h2 { font-size: 1.5rem; color: #2f3a26; margin: 0 0 18px; }
.gf-nuits dl { margin: 0; border-top: 1px solid #e5e8df; }
.gf-nuits-ligne { display: flex; justify-content: space-between; gap: 16px; padding: 13px 0; border-bottom: 1px solid #e5e8df; }
.gf-nuits dt { margin: 0; font-weight: 600; }
.gf-nuits dt a { color: #5a6b48; text-decoration: none; }
.gf-nuits dt a:hover { text-decoration: underline; }
.gf-nuits dd { margin: 0; color: #2f3a26; white-space: nowrap; }
.gf-nuits-note { color: #9aa392; font-size: .86rem; margin-top: 16px; }
@media (max-width: 600px) {
	.gf-nuits { padding: 0 16px; margin: 32px auto; }
	.gf-nuits-ligne { flex-direction: column; gap: 2px; }
}
.gf-essentiel, .gf-tarifs, .gf-faq-seo, .gf-geo, .gf-comparatif {
	max-width: 645px; margin: 44px auto; padding: 0 22px;
}
.gf-tarifs, .gf-comparatif { max-width: 820px; }
.gf-essentiel-titre, .gf-tarifs h2, .gf-faq-seo h2, .gf-geo h2 {
	font-size: 1.5rem; color: #2f3a26; margin: 0 0 18px;
}
.gf-essentiel dl { margin: 0; border-top: 1px solid #e5e8df; }
.gf-essentiel-ligne {
	display: flex; gap: 18px; padding: 11px 0; border-bottom: 1px solid #e5e8df;
}
.gf-essentiel dt { flex: 0 0 190px; font-weight: 600; color: #5a6b48; margin: 0; }
.gf-essentiel dd { margin: 0; color: #2f3a26; }

.gf-tarifs h3, .gf-geo h3 { font-size: 1.06rem; color: #5a6b48; margin: 26px 0 8px; }
.gf-tarifs-depart { font-size: 1.1rem; color: #2f3a26; }
.gf-tarifs-table { width: 100%; border-collapse: collapse; }
.gf-tarifs-table th, .gf-tarifs-table td {
	text-align: left; padding: 9px 0; border-bottom: 1px solid #eef0ea; font-weight: 400; color: #2f3a26;
}
.gf-tarifs-table td { text-align: right; white-space: nowrap; }
.gf-tarifs-unite { color: #9aa392; font-size: .86rem; }
.gf-tarifs-note { color: #9aa392; font-size: .85rem; margin-top: 18px; }

.gf-faq-item { border-bottom: 1px solid #e5e8df; padding: 4px 0; }
.gf-faq-item summary {
	cursor: pointer; list-style: none; padding: 13px 30px 13px 0; position: relative;
}
.gf-faq-item summary::-webkit-details-marker { display: none; }
.gf-faq-item summary::after {
	content: '+'; position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
	font-size: 1.4rem; color: #5a6b48; line-height: 1;
}
.gf-faq-item[open] summary::after { content: '–'; }
.gf-faq-item summary h3 { display: inline; font-size: 1.02rem; color: #2f3a26; margin: 0; font-weight: 600; }
.gf-faq-reponse { padding: 0 30px 16px 0; color: #4a5340; line-height: 1.66; }
.gf-faq-reponse p { margin: 0; }

.gf-comparatif h2 { font-size: 1.5rem; color: #2f3a26; margin: 0 0 18px; }
.gf-comparatif-table { width: 100%; border-collapse: collapse; }
.gf-comparatif-table th, .gf-comparatif-table td {
	padding: 10px 12px; border-bottom: 1px solid #e5e8df; text-align: left; vertical-align: top; color: #2f3a26;
}
.gf-comparatif-table thead th { color: #5a6b48; font-size: 1rem; }
.gf-comparatif-table thead a { color: #5a6b48; }
.gf-comparatif-table tbody th { font-weight: 600; color: #5a6b48; width: 30%; }
@media (max-width: 600px) {
	.gf-comparatif { padding: 0 16px; }
	.gf-comparatif-table th, .gf-comparatif-table td { padding: 8px 6px; font-size: .9rem; }
	.gf-comparatif-table tbody th { width: 34%; }
}
.gf-geo-distances { list-style: none; padding: 0; margin: 0; }
.gf-geo-distances li { padding: 7px 0; border-bottom: 1px solid #eef0ea; color: #2f3a26; }
.gf-geo-adresse { margin-top: 18px; color: #5a6b48; font-size: .93rem; }

@media (max-width: 600px) {
	.gf-essentiel, .gf-tarifs, .gf-faq-seo, .gf-geo, .gf-comparatif { margin: 32px auto; padding: 0 16px; }
	.gf-essentiel-ligne { flex-direction: column; gap: 2px; padding: 10px 0; }
	.gf-essentiel dt { flex: none; }
	.gf-tarifs-table th, .gf-tarifs-table td { display: block; }
	.gf-tarifs-table th { padding-bottom: 0; font-weight: 600; }
	.gf-tarifs-table td { text-align: left; padding-top: 2px; }
}
CSS;
		wp_register_style( 'gf-seo-blocks', false );
		wp_enqueue_style( 'gf-seo-blocks' );
		wp_add_inline_style( 'gf-seo-blocks', $css );
	}
);
