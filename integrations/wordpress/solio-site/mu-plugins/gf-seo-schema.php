<?php
/**
 * gf-seo-schema.php — Donnees structurees JSON-LD.
 *
 * Un seul graphe par page, construit depuis gf-seo-facts.php. Aucune valeur codee en dur,
 * aucune propriete publiee sans valeur reelle : une donnee absente est simplement omise.
 *
 * Noeuds produits :
 *   - LodgingBusiness  le domaine, sur toutes les pages
 *   - WebSite          identite du site
 *   - VacationRental   la page du gite, avec son Accommodation en containsPlace
 *   - Campground       la page de la tente safari, meme structure
 *   - FAQPage          des que la page porte le code court [solio_faq]
 *   - BreadcrumbList   sur toutes les pages internes
 *
 * Pas de Review ni d’AggregateRating : les six avis Google connus n’ont pas de texte
 * publie sur le site. Ils seront ajoutes ici quand des avis rediges y figureront.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Retire les cles vides d’un noeud, pour ne jamais publier une propriete sans valeur.
 */
function gf_seo_compact( $noeud ) {
	return array_filter(
		$noeud,
		function ( $v ) {
			return ! ( null === $v || '' === $v || array() === $v );
		}
	);
}

/**
 * Adresse postale complete.
 */
function gf_seo_schema_adresse() {
	$d = gf_seo_domaine();
	return array(
		'@type'           => 'PostalAddress',
		'streetAddress'   => $d['rue'],
		'postalCode'      => $d['code_postal'],
		'addressLocality' => $d['ville'],
		'addressRegion'   => $d['region'],
		'addressCountry'  => $d['pays'],
	);
}

/**
 * Coordonnees geographiques.
 */
function gf_seo_schema_geo() {
	$d = gf_seo_domaine();
	return array(
		'@type'     => 'GeoCoordinates',
		'latitude'  => $d['latitude'],
		'longitude' => $d['longitude'],
	);
}

/**
 * Transforme une liste d’equipements en LocationFeatureSpecification.
 *
 * @param array $noms Libelles d’equipement.
 * @return array
 */
function gf_seo_schema_equipements( $noms ) {
	$out = array();
	foreach ( $noms as $n ) {
		// On ne garde que le libelle avant le deux-points : « Cuisine équipée : four, … » → « Cuisine équipée ».
		$libelle = trim( explode( ':', $n )[0] );
		$out[]   = array(
			'@type' => 'LocationFeatureSpecification',
			'name'  => $libelle,
			'value' => true,
		);
	}
	return $out;
}

/**
 * Noeud LodgingBusiness du domaine, present sur toutes les pages.
 */
function gf_seo_schema_domaine() {
	$d = gf_seo_domaine();

	$reseaux = array_values( array_filter( array( $d['facebook'], $d['instagram'] ) ) );

	// Le tarif le plus bas des deux hebergements donne le « a partir de » du domaine.
	$prix = array();
	foreach ( array( 'gite', 'lodge' ) as $cle ) {
		$l = gf_seo_lodging( $cle );
		if ( ! empty( $l['prix_min_nuit'] ) ) {
			$prix[] = (float) $l['prix_min_nuit'];
		}
	}

	return gf_seo_compact(
		array(
			'@type'          => 'LodgingBusiness',
			'@id'            => home_url( '/#domaine' ),
			'name'           => $d['nom'],
			'description'    => 'Domaine privé de ' . $d['superficie_ha'] . ' hectares en Ardèche verte, à '
				. $d['ville'] . ', avec deux hébergements : un gîte 3 épis pour 10 personnes et une tente safari pour 5.',
			'url'            => home_url( '/' ),
			'telephone'      => $d['telephone'],
			'address'        => gf_seo_schema_adresse(),
			'geo'            => gf_seo_schema_geo(),
			'image'          => gf_seo_schema_image(),
			'sameAs'         => $reseaux,
			'priceRange'     => $prix ? 'à partir de ' . min( $prix ) . ' €' : null,
			'currenciesAccepted' => 'EUR',
			'petsAllowed'    => (bool) $d['chiens_acceptes'],
			'smokingAllowed' => false,
			'checkinTime'    => '16:00',
			'checkoutTime'   => '10:00',
			'numberOfRooms'  => $d['nb_hebergements'],
			'amenityFeature' => gf_seo_schema_equipements( gf_seo_equipements_domaine() ),
			'areaServed'     => array(
				'@type' => 'Place',
				'name'  => $d['territoire'],
			),
		)
	);
}

/**
 * Visuel du noeud courant, en URL absolue.
 */
function gf_seo_schema_image() {
	$img = function_exists( 'gf_seo_og_image' ) ? gf_seo_og_image() : null;
	return $img ? gf_seo_absolute_url( $img ) : null;
}

/**
 * Noeud d’un hebergement : VacationRental pour le gite, Campground pour la tente.
 *
 * @param string $cle « gite » ou « lodge ».
 */
function gf_seo_schema_hebergement( $cle ) {
	$l = gf_seo_lodging( $cle );
	if ( ! $l ) {
		return null;
	}
	$d   = gf_seo_domaine();
	$url = home_url( '/' . $l['slug'] . '/' );

	// Le logement lui-meme, decrit en Accommodation.
	$logement = gf_seo_compact(
		array(
			'@type'                  => 'Accommodation',
			'@id'                    => $url . '#logement',
			'name'                   => $l['nom'],
			'numberOfBedrooms'       => $l['chambres'],
			'numberOfBathroomsTotal' => $l['salles_eau'],
			'numberOfRooms'          => $l['chambres'],
			'floorSize'              => $l['superficie_m2'] ? array(
				'@type'    => 'QuantitativeValue',
				'value'    => $l['superficie_m2'],
				'unitCode' => 'MTK',
			) : null,
			'occupancy'              => array(
				'@type'    => 'QuantitativeValue',
				'unitText' => 'personnes',
				'value'    => $l['capacite'],
				'maxValue' => ! empty( $l['capacite_max'] ) ? $l['capacite_max'] : $l['capacite'],
			),
			'bed'                    => gf_seo_schema_lits( $l ),
			'amenityFeature'         => gf_seo_schema_equipements( $l['equipements'] ),
			'petsAllowed'            => (bool) $d['chiens_acceptes'],
			'smokingAllowed'         => empty( $l['non_fumeur'] ),
		)
	);

	$offre = ! empty( $l['prix_min_nuit'] ) ? array(
		'@type'             => 'Offer',
		'name'              => 'Nuitée',
		'availability'      => 'https://schema.org/InStock',
		'url'               => $url,
		'priceSpecification' => array(
			'@type'         => 'UnitPriceSpecification',
			'priceCurrency' => 'EUR',
			'minPrice'      => (float) $l['prix_min_nuit'],
			'unitText'      => 'par nuit',
		),
	) : null;

	return gf_seo_compact(
		array(
			'@type'          => 'gite' === $cle ? 'VacationRental' : 'Campground',
			'@id'            => $url . '#hebergement',
			'name'           => $l['nom'],
			'url'            => $url,
			'description'    => gf_seo_description(),
			'image'          => gf_seo_schema_image(),
			'telephone'      => $d['telephone'],
			'address'        => gf_seo_schema_adresse(),
			'geo'            => gf_seo_schema_geo(),
			'checkinTime'    => $l['checkin'],
			'checkoutTime'   => $l['checkout'],
			'petsAllowed'    => (bool) $d['chiens_acceptes'],
			'smokingAllowed' => empty( $l['non_fumeur'] ),
			'numberOfRooms'  => $l['chambres'],
			'award'          => $l['label'] ? $l['label'] . ( $l['numero_label'] ? ' (n° ' . $l['numero_label'] . ')' : '' ) : null,
			'amenityFeature' => gf_seo_schema_equipements( $l['equipements'] ),
			'containsPlace'  => $logement,
			'makesOffer'     => $offre,
			'isPartOf'       => array( '@id' => home_url( '/#domaine' ) ),
		)
	);
}

/**
 * Couchages declares, en BedDetails.
 */
function gf_seo_schema_lits( $l ) {
	$lits = array();
	if ( ! empty( $l['lits_doubles'] ) ) {
		$lits[] = array(
			'@type'          => 'BedDetails',
			'typeOfBed'      => 'Lit double',
			'numberOfBeds'   => $l['lits_doubles'],
		);
	}
	if ( ! empty( $l['lits_simples'] ) ) {
		$lits[] = array(
			'@type'        => 'BedDetails',
			'typeOfBed'    => 'Lit simple',
			'numberOfBeds' => $l['lits_simples'],
		);
	}
	return $lits;
}

/**
 * Identifiant de FAQ porte par la page courante, lu dans son contenu.
 *
 * Le <head> est ecrit avant le rendu du contenu : on ne peut pas se fier au code court
 * deja execute, on inspecte donc directement le contenu enregistre.
 */
function gf_seo_schema_faq_cle() {
	if ( ! is_singular() ) {
		return null;
	}
	$contenu = get_post_field( 'post_content', get_queried_object_id() );
	if ( preg_match( '/\[solio_faq[^\]]*page=["\']([a-z0-9_-]+)["\']/i', $contenu, $m ) ) {
		return $m[1];
	}
	return null;
}

/**
 * Extrait les questions d’un accordeon <details> ecrit dans le contenu de la page.
 *
 * @return array Couples question / reponse.
 */
function gf_seo_faq_depuis_contenu() {
	if ( ! is_singular() ) {
		return array();
	}
	$contenu = get_post_field( 'post_content', get_queried_object_id() );
	if ( ! preg_match_all( '~<details[^>]*>\s*<summary[^>]*>(.*?)</summary>(.*?)</details>~s', $contenu, $m, PREG_SET_ORDER ) ) {
		return array();
	}
	$sortie = array();
	foreach ( $m as $bloc ) {
		$question = trim( preg_replace( '/\s+/u', ' ', wp_strip_all_tags( $bloc[1] ) ) );
		$reponse  = trim( preg_replace( '/\s+/u', ' ', wp_strip_all_tags( $bloc[2] ) ) );
		if ( $question && $reponse ) {
			$sortie[] = array( 'q' => $question, 'r' => $reponse );
		}
	}
	return $sortie;
}

/**
 * Noeud FAQPage, construit depuis les memes questions que celles affichees.
 */
function gf_seo_schema_faq() {
	$cle = gf_seo_schema_faq_cle();
	$faq = $cle ? gf_seo_faq( $cle ) : array();

	// Pages dont l’accordeon est ecrit directement dans le contenu (la page « Questions
	// frequentes » historique) : les questions sont relues depuis les balises <details>.
	if ( ! $faq ) {
		$faq = gf_seo_faq_depuis_contenu();
	}
	if ( ! $faq ) {
		return null;
	}
	$l = $cle ? gf_seo_lodging( $cle ) : null;

	$entrees = array();
	foreach ( $faq as $item ) {
		$reponse = $l ? gf_seo_tokens( $item['r'], $l ) : $item['r'];
		// Une reponse laissee a l’etat de TODO n’a rien a faire dans les donnees structurees.
		if ( false !== strpos( $reponse, 'TODO:' ) ) {
			continue;
		}
		$entrees[] = array(
			'@type'          => 'Question',
			'name'           => $item['q'],
			'acceptedAnswer' => array(
				'@type' => 'Answer',
				'text'  => $reponse,
			),
		);
	}
	if ( ! $entrees ) {
		return null;
	}

	return array(
		'@type'      => 'FAQPage',
		'@id'        => get_permalink() . '#faq',
		'mainEntity' => $entrees,
	);
}

/**
 * Fil d’Ariane, deduit de la hierarchie declaree dans gf_seo_pages().
 */
function gf_seo_schema_fil() {
	if ( is_front_page() || ! is_singular() ) {
		return null;
	}
	$conf = gf_seo_current_config();
	if ( ! $conf ) {
		return null;
	}
	$pages = gf_seo_pages();

	$chaine = array();
	$courant = $conf;
	$slug    = $conf['slug'];
	$garde   = 0;
	while ( $courant && $garde++ < 5 ) {
		array_unshift( $chaine, array( 'slug' => $slug, 'nom' => $courant['fil'] ?? get_the_title() ) );
		$parent = $courant['parent_fil'] ?? null;
		if ( ! $parent || ! isset( $pages[ $parent ] ) ) {
			break;
		}
		$slug    = $parent;
		$courant = $pages[ $parent ];
	}

	$elements = array(
		array(
			'@type'    => 'ListItem',
			'position' => 1,
			'name'     => 'Accueil',
			'item'     => home_url( '/' ),
		),
	);
	$position = 2;
	$prefixe  = '';
	foreach ( $chaine as $etape ) {
		$prefixe   .= $etape['slug'] . '/';
		$elements[] = array(
			'@type'    => 'ListItem',
			'position' => $position++,
			'name'     => $etape['nom'],
			'item'     => home_url( '/' . $prefixe ),
		);
	}

	return array(
		'@type'           => 'BreadcrumbList',
		'@id'             => get_permalink() . '#fil',
		'itemListElement' => $elements,
	);
}

/**
 * Fil d’Ariane visible, insere en tete de contenu sur les pages internes.
 *
 * Le balisage BreadcrumbList seul ne suffit pas : Google attend un fil reellement affiche,
 * et c’est aussi un vrai repere de navigation pour le visiteur arrive par un moteur.
 */
function gf_seo_fil_visible( $contenu ) {
	// Le theme est un theme a blocs : le contenu est rendu par core/post-content, hors boucle
	// classique. On se contente donc de verifier la page interrogee, et on n’insere qu’une fois.
	static $deja = false;
	if ( $deja || is_admin() || ! is_singular( 'page' ) || ! is_main_query() || is_front_page() ) {
		return $contenu;
	}
	if ( get_queried_object_id() !== get_the_ID() ) {
		return $contenu;
	}
	$fil = gf_seo_schema_fil();
	if ( ! $fil || count( $fil['itemListElement'] ) < 2 ) {
		return $contenu;
	}

	$html  = '<nav class="gf-fil" aria-label="Fil d’Ariane"><ol>';
	$total = count( $fil['itemListElement'] );
	foreach ( $fil['itemListElement'] as $i => $etape ) {
		$dernier = ( $i === $total - 1 );
		$html   .= '<li>' . ( $dernier
			? '<span aria-current="page">' . esc_html( $etape['name'] ) . '</span>'
			: '<a href="' . esc_url( $etape['item'] ) . '">' . esc_html( $etape['name'] ) . '</a>' )
			. '</li>';
	}
	$html .= '</ol></nav>';
	$deja  = true;

	return $html . $contenu;
}
add_filter( 'the_content', 'gf_seo_fil_visible', 5 );

add_action(
	'wp_enqueue_scripts',
	function () {
		$css = <<<'CSS'
.gf-fil { max-width: 645px; margin: 18px auto -10px; padding: 0 22px; font-size: .84rem; }
.gf-fil ol { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; }
.gf-fil li + li::before { content: '›'; margin-right: 8px; color: #9aa392; }
.gf-fil a { color: #5a6b48; text-decoration: none; }
.gf-fil a:hover { text-decoration: underline; }
.gf-fil [aria-current] { color: #9aa392; }
@media (max-width: 600px) { .gf-fil { padding: 0 16px; margin: 14px auto -6px; } }
CSS;
		wp_register_style( 'gf-seo-fil', false );
		wp_enqueue_style( 'gf-seo-fil' );
		wp_add_inline_style( 'gf-seo-fil', $css );
	}
);

/**
 * Assemblage et emission du graphe.
 */
function gf_seo_render_schema() {
	if ( is_404() || is_search() ) {
		return;
	}

	$graphe = array(
		gf_seo_schema_domaine(),
		array(
			'@type'      => 'WebSite',
			'@id'        => home_url( '/#site' ),
			'url'        => home_url( '/' ),
			'name'       => gf_seo_domaine()['nom'],
			'inLanguage' => 'fr-FR',
			'publisher'  => array( '@id' => home_url( '/#domaine' ) ),
		),
	);

	$conf = gf_seo_current_config();
	if ( ! empty( $conf['lodging'] ) ) {
		$noeud = gf_seo_schema_hebergement( $conf['lodging'] );
		if ( $noeud ) {
			$graphe[] = $noeud;
		}
	}

	foreach ( array( gf_seo_schema_faq(), gf_seo_schema_fil() ) as $noeud ) {
		if ( $noeud ) {
			$graphe[] = $noeud;
		}
	}

	$json = wp_json_encode(
		array(
			'@context' => 'https://schema.org',
			'@graph'   => $graphe,
		),
		JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
	);

	echo "\n<script type=\"application/ld+json\">\n" . $json . "\n</script>\n";
}
add_action( 'wp_head', 'gf_seo_render_schema', 5 );
