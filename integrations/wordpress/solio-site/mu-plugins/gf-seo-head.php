<?php
/**
 * gf-seo-head.php — Balises <head> : title, meta description, Open Graph, Twitter Card, robots.
 *
 * Le <link rel="canonical"> est deja emis par WordPress (fonction rel_canonical du core) :
 * on ne le duplique pas, on se contente de verifier sa presence.
 *
 * Chaque page a une entree dans gf_seo_pages() : un titre de 50 a 60 caracteres redige comme
 * une requete reelle, et une description de 140 a 155 caracteres contenant un chiffre concret.
 * Une page sans entree recoit un repli construit depuis son titre : jamais de balise vide.
 *
 * Surcharge manuelle possible page par page via les champs personnalises _gf_seo_title et
 * _gf_seo_description (voir la metabox de gf-seo-admin.php).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Table de correspondance page → referencement.
 *
 * La cle est le slug cible. « alias » liste les anciens slugs pour que le referencement
 * reste correct pendant la bascule des URLs.
 */
function gf_seo_pages() {
	return array(

		'accueil'               => array(
			'accueil'     => true,
			'alias'       => array( 'accueil-solio' ),
			'fil'         => 'Accueil',
			'fil_en'      => 'Home',
			'title'       => 'Domaine Solio — gîte et glamping en Ardèche verte, 13 ha',
			'description' => 'Un gîte 3 étoiles pour 10 personnes et une tente safari, seuls sur 13 hectares de prairie et de forêt à Satillieu. Animaux, piscine, bain nordique.',
		),

		'la-granja'             => array(
			'alias'       => array( 'le-gite' ),
			'lodging'     => 'gite',
			'fil'         => 'Gîte 10 personnes',
			'fil_en'      => 'Gîte for 10',
			'title'       => 'Gîte 10 personnes en Ardèche verte — 4 chambres, 3 étoiles',
			'description' => 'Gîte 3 étoiles pour 10 personnes à Satillieu : 4 chambres, 2 salles d’eau, poêle à bois et terrasse vue montagnes, sur un domaine de 13 hectares.',
		),

		'estiva'                => array(
			'alias'       => array( 'aventura-lodge' ),
			'lodging'     => 'lodge',
			'fil'         => 'Tente safari',
			'fil_en'      => 'Safari tent',
			'title'       => 'Tente safari glamping en Ardèche verte — L’Estiva',
			'description' => 'Tente safari tout confort pour 5 personnes sur terrasse bois, au milieu du pré des chèvres. Salle d’eau privative, ciel étoilé, sans wifi ni voisin.',
		),


		'le-domaine'            => array(
			'fil'         => 'Le domaine',
			'fil_en'      => 'The estate',
			'title'       => 'Le Domaine Solio — 13 hectares de nature en Ardèche',
			'description' => '13 hectares de prairie et de forêt à Satillieu, une boucle de balade de 2 km, des ânes, des chèvres et des moutons que les enfants approchent librement.',
		),


		'autour-de-nous'        => array(
			'alias'       => array( 'activites-autour' ),
			'fil'         => 'Activités autour',
			'fil_en'      => 'Things to do nearby',
			'title'       => 'Que faire en Ardèche verte ? Nos idées autour de Satillieu',
			'description' => 'Le Safari de Peaugres à 20 minutes, le lac de Devesset, la Via Fluvia, Annonay à 15 km : nos idées de sorties testées autour du Domaine Solio.',
		),





		'contact'               => array(
			'alias'       => array( 'acces', 'contactez-nous' ),
			'fil'         => 'Accès & contact',
			'fil_en'      => 'Getting here & contact',
			'title'       => 'Accès & contact — Domaine Solio, Satillieu en Ardèche',
			'description' => 'Venir au Domaine Solio : GPS, gare de Saint-Vallier à 30 minutes, parking sur place. Sophie ou Adrien répondent au 06 15 73 93 37 ou par e-mail.',
		),


	);
}

/**
 * Retourne la configuration de referencement de la page courante, ou null.
 */
function gf_seo_current_config() {
	static $cache = null;
	if ( null !== $cache ) {
		return $cache ?: null;
	}
	$cache = false;

	$pages = gf_seo_pages();

	if ( is_front_page() ) {
		$cache = $pages['accueil'] + array( 'slug' => 'accueil' );
		return $cache;
	}
	if ( ! is_singular() ) {
		return null;
	}

	$slug = get_post_field( 'post_name', get_queried_object_id() );
	if ( isset( $pages[ $slug ] ) ) {
		$cache = $pages[ $slug ] + array( 'slug' => $slug );
		return $cache;
	}
	foreach ( $pages as $cle => $conf ) {
		if ( in_array( $slug, (array) ( $conf['alias'] ?? array() ), true ) ) {
			$cache = $conf + array( 'slug' => $cle );
			return $cache;
		}
	}
	return null;
}

/**
 * Les clefs de la configuration qui decrivent la STRUCTURE de la page, jamais son texte.
 *
 * `gf_seo_pages()` est indexee sur les slugs FRANCAIS. Une page anglaise porte le sien
 * (« la-granja-gite », « the-estate »), donc `gf_seo_current_config()` ne la trouve pas et rend
 * null — et tout ce qui en depend disparait en silence. Mesure du 2026-09-25 sur le site publie :
 * les deux pages hebergement anglaises perdaient la feuille de style ET le script du tiroir (le
 * bouton flottant retombait dans le flux, le tiroir se deversait dans la page), les icones sous le
 * hero, le fil d'Ariane des cinq pages internes, et le noeud `VacationRental` / `Campground` des
 * donnees structurees — celui qui decrit le logement comme louable.
 *
 * Alors pourquoi ne pas simplement replier `gf_seo_current_config()` sur la jumelle francaise ? Parce
 * que le `<head>` y lit `title` et `description` : le repli publierait le titre FRANCAIS sur la page
 * anglaise, ce qui est pire que le defaut corrige. D'ou deux fonctions, et une liste blanche.
 *
 * Ce qui passe : de quoi identifier la page et ce qu'elle porte. `fil` est du texte, mais il a son
 * jumeau `fil_en` — le fil d'Ariane le choisit par la langue (regle 52).
 */
function gf_seo_config_structure() {
	$conf = gf_seo_current_config();
	if ( $conf ) {
		return $conf;
	}
	if ( ! function_exists( 'pll_get_post' ) || ! is_singular() ) {
		return null;
	}
	$jumelle = pll_get_post( get_queried_object_id(), 'fr' );
	if ( ! $jumelle ) {
		return null;
	}
	$pages = gf_seo_pages();
	$slug  = get_post_field( 'post_name', $jumelle );
	if ( ! isset( $pages[ $slug ] ) ) {
		return null;
	}
	$permis = array( 'lodging', 'parent_fil', 'accueil', 'fil', 'fil_en' );
	$out    = array( 'slug' => $slug );
	foreach ( $permis as $cle ) {
		if ( isset( $pages[ $slug ][ $cle ] ) ) {
			$out[ $cle ] = $pages[ $slug ][ $cle ];
		}
	}
	return $out;
}

/**
 * Titre du document. Repli : titre de la page suivi du nom du domaine.
 */
function gf_seo_document_title() {
	$id = is_singular() ? get_queried_object_id() : 0;
	if ( $id ) {
		$surcharge = get_post_meta( $id, '_gf_seo_title', true );
		if ( $surcharge ) {
			return $surcharge;
		}
	}
	$conf = gf_seo_current_config();
	if ( ! empty( $conf['title'] ) ) {
		return $conf['title'];
	}
	if ( $id ) {
		return get_the_title( $id ) . ' — ' . gf_seo_domaine()['nom'];
	}
	return get_bloginfo( 'name' );
}
add_filter(
	'pre_get_document_title',
	function () {
		return gf_seo_document_title();
	},
	20
);

/**
 * Description de la page. Repli : extrait, puis debut du contenu.
 */
function gf_seo_description() {
	$id = is_singular() ? get_queried_object_id() : 0;
	if ( $id ) {
		$surcharge = get_post_meta( $id, '_gf_seo_description', true );
		if ( $surcharge ) {
			return $surcharge;
		}
	}
	$conf = gf_seo_current_config();
	if ( ! empty( $conf['description'] ) ) {
		return $conf['description'];
	}
	if ( $id ) {
		$texte = get_the_excerpt( $id );
		if ( ! $texte ) {
			$texte = wp_strip_all_tags( get_post_field( 'post_content', $id ) );
		}
		$texte = trim( preg_replace( '/\s+/u', ' ', $texte ) );
		if ( $texte ) {
			return rtrim( mb_substr( $texte, 0, 152 ), " ,;:.\u{2014}-" ) . '…';
		}
	}
	return '';
}

/**
 * Visuel de partage : image mise en avant, sinon premiere image de couverture, sinon visuel par defaut.
 */
function gf_seo_og_image() {
	$id = is_singular() ? get_queried_object_id() : 0;

	if ( $id && has_post_thumbnail( $id ) ) {
		$url = get_the_post_thumbnail_url( $id, 'full' );
		if ( $url ) {
			return $url;
		}
	}
	if ( $id ) {
		$trouve = null;
		$walk   = function ( $blocs ) use ( &$walk, &$trouve ) {
			foreach ( $blocs as $b ) {
				if ( $trouve ) {
					return;
				}
				if ( in_array( $b['blockName'], array( 'core/cover', 'core/image' ), true ) ) {
					// Bloc rattache a la mediatheque.
					if ( ! empty( $b['attrs']['id'] ) ) {
						$url = wp_get_attachment_image_url( (int) $b['attrs']['id'], 'full' );
						if ( $url ) {
							$trouve = $url;
							return;
						}
					}
					// Bloc de couverture pointant une URL directe (heros encore hotlinkes).
					if ( ! empty( $b['attrs']['url'] ) ) {
						$trouve = $b['attrs']['url'];
						return;
					}
				}
				if ( ! empty( $b['innerBlocks'] ) ) {
					$walk( $b['innerBlocks'] );
				}
			}
		};
		$walk( parse_blocks( get_post_field( 'post_content', $id ) ) );
		if ( $trouve ) {
			return $trouve;
		}

		// Depuis la refonte de septembre 2026, les bandeaux de haut de page sont ecrits en
		// HTML brut (<img class="gf-hero-media">) et non en bloc de couverture : sans cette
		// reprise, aucune page du site n'avait de visuel de partage, et tout lien partage sur
		// un reseau ou une messagerie s'affichait en carte sans image.
		if ( preg_match( '~<img[^>]+src=["\']([^"\']+)["\']~i', (string) get_post_field( 'post_content', $id ), $m ) ) {
			return $m[1];
		}
	}
	return gf_seo_domaine()['og_image'];
}

/**
 * Emission des balises meta.
 */
function gf_seo_render_head() {
	$conf = gf_seo_current_config();
	$desc = gf_seo_description();
	$url  = is_singular() ? get_permalink( get_queried_object_id() ) : home_url( '/' );
	if ( is_front_page() ) {
		$url = home_url( '/' );
	}
	$nom = gf_seo_domaine()['nom'];

	echo "\n<!-- Domaine Solio : referencement -->\n";

	if ( $desc ) {
		printf( "<meta name=\"description\" content=\"%s\" />\n", esc_attr( $desc ) );
	}

	// Pages outils : indexation refusee, liens suivis.
	if ( ! empty( $conf['noindex'] ) || is_search() || is_author() || is_404() ) {
		echo "<meta name=\"robots\" content=\"noindex, follow\" />\n";
	} else {
		echo "<meta name=\"robots\" content=\"index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1\" />\n";
	}

	printf( "<meta property=\"og:type\" content=\"%s\" />\n", is_front_page() ? 'website' : 'article' );
	printf( "<meta property=\"og:site_name\" content=\"%s\" />\n", esc_attr( $nom ) );
	printf( "<meta property=\"og:locale\" content=\"fr_FR\" />\n" );
	printf( "<meta property=\"og:title\" content=\"%s\" />\n", esc_attr( gf_seo_document_title() ) );
	if ( $desc ) {
		printf( "<meta property=\"og:description\" content=\"%s\" />\n", esc_attr( $desc ) );
	}
	printf( "<meta property=\"og:url\" content=\"%s\" />\n", esc_url( $url ) );

	$image = gf_seo_og_image();
	if ( $image ) {
		$image = gf_seo_absolute_url( $image );
		printf( "<meta property=\"og:image\" content=\"%s\" />\n", esc_url( $image ) );
		printf( "<meta property=\"og:image:alt\" content=\"%s\" />\n", esc_attr( gf_seo_document_title() ) );
		echo "<meta name=\"twitter:card\" content=\"summary_large_image\" />\n";
	} else {
		echo "<meta name=\"twitter:card\" content=\"summary\" />\n";
	}
	printf( "<meta name=\"twitter:title\" content=\"%s\" />\n", esc_attr( gf_seo_document_title() ) );
	if ( $desc ) {
		printf( "<meta name=\"twitter:description\" content=\"%s\" />\n", esc_attr( $desc ) );
	}
	if ( $image ) {
		printf( "<meta name=\"twitter:image\" content=\"%s\" />\n", esc_url( $image ) );
	}

	printf( "<meta name=\"geo.position\" content=\"%s;%s\" />\n", gf_seo_domaine()['latitude'], gf_seo_domaine()['longitude'] );
	printf( "<meta name=\"geo.placename\" content=\"%s\" />\n", esc_attr( gf_seo_domaine()['ville'] ) );
	echo "<meta name=\"geo.region\" content=\"FR-ARA\" />\n";
}
add_action( 'wp_head', 'gf_seo_render_head', 1 );

/**
 * Declarations hreflang.
 *
 * Polylang n’emet ces balises que lorsqu’une page possede au moins une traduction. Tant que
 * la version anglaise n’existe pas, on emet au minimum l’auto-reference et x-default : c’est
 * ce que Google attend d’un site monolingue qui se prepare a devenir bilingue, et cela evite
 * d’avoir a repasser sur chaque page le jour de la traduction.
 */
function gf_seo_render_hreflang() {
	if ( ! is_singular() && ! is_front_page() ) {
		return;
	}
	$id  = is_front_page() ? (int) get_option( 'page_on_front' ) : get_queried_object_id();
	$url = is_front_page() ? home_url( '/' ) : get_permalink( $id );
	if ( ! $url ) {
		return;
	}

	$versions = array( 'fr-FR' => $url );

	// Traductions declarees dans Polylang, le cas echeant.
	if ( function_exists( 'pll_get_post_translations' ) ) {
		$correspondance = array( 'fr' => 'fr-FR', 'en' => 'en-GB' );
		foreach ( pll_get_post_translations( $id ) as $langue => $traduction ) {
			if ( ! isset( $correspondance[ $langue ] ) ) {
				continue;
			}
			$lien = get_permalink( $traduction );
			if ( $lien ) {
				$versions[ $correspondance[ $langue ] ] = $lien;
			}
		}
	}

	foreach ( $versions as $code => $lien ) {
		printf( "<link rel=\"alternate\" hreflang=\"%s\" href=\"%s\" />\n", esc_attr( $code ), esc_url( $lien ) );
	}
	// x-default pointe vers la version francaise, seule version complete a ce jour.
	printf( "<link rel=\"alternate\" hreflang=\"x-default\" href=\"%s\" />\n", esc_url( $versions['fr-FR'] ) );

	foreach ( $versions as $code => $lien ) {
		if ( 'fr-FR' === $code ) {
			continue;
		}
		printf( "<meta property=\"og:locale:alternate\" content=\"%s\" />\n", esc_attr( str_replace( '-', '_', $code ) ) );
	}
}
add_action( 'wp_head', 'gf_seo_render_hreflang', 3 );

/**
 * Les URL des medias sont relatives (voir gf-relative-uploads.php) : Open Graph exige une URL absolue.
 */
function gf_seo_absolute_url( $url ) {
	if ( 0 === strpos( $url, '//' ) || preg_match( '~^https?://~i', $url ) ) {
		return $url;
	}
	return home_url( $url );
}

/**
 * Le flux RSS et les liens oEmbed n’ont aucune utilite sur un site vitrine sans blog :
 * ils diluent le budget de crawl.
 */
add_action(
	'init',
	function () {
		remove_action( 'wp_head', 'feed_links', 2 );
		remove_action( 'wp_head', 'feed_links_extra', 3 );
		remove_action( 'wp_head', 'wp_oembed_add_discovery_links' );
		remove_action( 'wp_head', 'wp_shortlink_wp_head' );
		remove_action( 'wp_head', 'wp_generator' );
		remove_action( 'wp_head', 'rsd_link' );
	}
);
