<?php
/**
 * gf-seo-activites.php — Fiches « activite » du territoire.
 *
 * Un type de contenu dedie, avec des champs structures saisis dans l’administration
 * (pas de dependance a un plugin de champs personnalises). Chaque fiche publie :
 *   - un encadre factuel rendu par le serveur (distance, duree, enfants, periode) ;
 *   - un balisage TouristAttraction relie au domaine ;
 *   - une entree dans le sitemap et dans llms.txt.
 *
 * Les fiches sont creees vides et en brouillon : les textes sont ecrits par Adrien.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const GF_ACTIVITE_BASE = 'activites-autour-du-domaine';

/**
 * Champs structures d’une fiche.
 */
function gf_activite_champs() {
	return array(
		'distance'  => array( 'label' => 'Distance depuis le domaine', 'aide' => 'Par exemple : 20 min en voiture, ou 15 km.' ),
		'duree'     => array( 'label' => 'Durée conseillée', 'aide' => 'Par exemple : une demi-journée.' ),
		'enfants'   => array( 'label' => 'Adapté aux enfants', 'aide' => 'Oui, non, ou à partir de quel âge.' ),
		'periode'   => array( 'label' => 'Période', 'aide' => 'Par exemple : toute l’année, ou d’avril à septembre.' ),
		'commune'   => array( 'label' => 'Commune', 'aide' => 'La commune où se trouve le lieu.' ),
		'tarif'     => array( 'label' => 'Tarif indicatif', 'aide' => 'Laisser vide si gratuit ou inconnu.' ),
		'lien'      => array( 'label' => 'Site officiel', 'aide' => 'URL complète, https:// compris.', 'type' => 'url' ),
	);
}

/* ---------------------------------------------------------------------------
 * Enregistrement du type de contenu.
 * ------------------------------------------------------------------------- */

add_action(
	'init',
	function () {
		register_post_type(
			'activite',
			array(
				'labels'        => array(
					'name'          => 'Activités',
					'singular_name' => 'Activité',
					'add_new_item'  => 'Ajouter une activité',
					'edit_item'     => 'Modifier l’activité',
					'search_items'  => 'Rechercher une activité',
					'not_found'     => 'Aucune activité',
				),
				'public'        => true,
				'show_in_rest'  => true,
				'menu_icon'     => 'dashicons-palmtree',
				'menu_position' => 21,
				'supports'      => array( 'title', 'editor', 'excerpt', 'thumbnail', 'custom-fields' ),
				'has_archive'   => false,
				'query_var'     => 'activite',
				// La reecriture est geree a la main : voir plus bas, pour ne pas entrer en
				// conflit avec les pages filles de /activites-autour-du-domaine/.
				'rewrite'       => false,
			)
		);

		// « top » : la regle doit passer avant celle des pages, sinon WordPress cherche une
		// page a ce chemin et renvoie une 404. Le filtre « request » ci-dessous rend la main
		// aux pages filles quand aucune fiche ne correspond.
		add_rewrite_rule(
			'^' . GF_ACTIVITE_BASE . '/([^/]+)/?$',
			'index.php?activite=$matches[1]',
			'top'
		);
	}
);

/**
 * Une page fille prime toujours sur une fiche d’activite.
 *
 * WordPress a deja traduit « activite=<slug> » en post_type + name avant ce filtre : c’est
 * donc cette forme qu’on inspecte. Sans ce garde-fou,
 * /activites-autour-du-domaine/avec-des-enfants/ chercherait une fiche inexistante et
 * renverrait une erreur 404 au lieu d’afficher la page fille.
 */
add_filter(
	'request',
	function ( $vars ) {
		$slug = '';
		if ( ! empty( $vars['activite'] ) ) {
			$slug = $vars['activite'];
		} elseif ( isset( $vars['post_type'] ) && 'activite' === $vars['post_type'] && ! empty( $vars['name'] ) ) {
			$slug = $vars['name'];
		}
		if ( ! $slug ) {
			return $vars;
		}

		// La fiche existe : on la sert telle quelle.
		if ( get_page_by_path( $slug, OBJECT, 'activite' ) ) {
			return $vars;
		}

		// Sinon, une page fille porte peut-etre ce chemin : elle reprend la main.
		$page = get_page_by_path( GF_ACTIVITE_BASE . '/' . $slug );
		if ( $page ) {
			unset( $vars['activite'], $vars['post_type'], $vars['name'] );
			$vars['pagename'] = GF_ACTIVITE_BASE . '/' . $slug;
		}
		return $vars;
	},
	20
);

/**
 * Permalien d’une fiche : /activites-autour-du-domaine/<slug>/.
 */
add_filter(
	'post_type_link',
	function ( $lien, $post ) {
		if ( 'activite' === $post->post_type ) {
			return home_url( '/' . GF_ACTIVITE_BASE . '/' . $post->post_name . '/' );
		}
		return $lien;
	},
	10,
	2
);

/* ---------------------------------------------------------------------------
 * Saisie des champs dans l’administration.
 * ------------------------------------------------------------------------- */

add_action(
	'add_meta_boxes',
	function () {
		add_meta_box( 'gf_activite_box', 'Informations pratiques', 'gf_activite_metabox', 'activite', 'normal', 'high' );
	}
);

/**
 * Formulaire de saisie des champs structures.
 *
 * @param WP_Post $post Fiche en cours d’edition.
 */
function gf_activite_metabox( $post ) {
	wp_nonce_field( 'gf_activite_save', 'gf_activite_nonce' );
	echo '<style>.gf-act-champ{margin-bottom:14px}.gf-act-champ label{display:block;font-weight:600;margin-bottom:3px}'
		. '.gf-act-champ input{width:100%}.gf-act-aide{color:#666;font-size:12px;font-style:italic}</style>';
	foreach ( gf_activite_champs() as $cle => $champ ) {
		$valeur = get_post_meta( $post->ID, '_gf_act_' . $cle, true );
		printf(
			'<div class="gf-act-champ"><label for="gf_act_%1$s">%2$s</label>'
			. '<input type="%3$s" id="gf_act_%1$s" name="gf_act_%1$s" value="%4$s" />'
			. '<p class="gf-act-aide">%5$s</p></div>',
			esc_attr( $cle ),
			esc_html( $champ['label'] ),
			esc_attr( $champ['type'] ?? 'text' ),
			esc_attr( $valeur ),
			esc_html( $champ['aide'] )
		);
	}
}

add_action(
	'save_post_activite',
	function ( $post_id ) {
		if ( ! isset( $_POST['gf_activite_nonce'] ) || ! wp_verify_nonce( sanitize_key( $_POST['gf_activite_nonce'] ), 'gf_activite_save' ) ) {
			return;
		}
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}
		foreach ( gf_activite_champs() as $cle => $champ ) {
			$brut   = isset( $_POST[ 'gf_act_' . $cle ] ) ? wp_unslash( $_POST[ 'gf_act_' . $cle ] ) : '';
			$valeur = ( 'url' === ( $champ['type'] ?? '' ) ) ? esc_url_raw( $brut ) : sanitize_text_field( $brut );
			if ( '' === $valeur ) {
				delete_post_meta( $post_id, '_gf_act_' . $cle );
			} else {
				update_post_meta( $post_id, '_gf_act_' . $cle, $valeur );
			}
		}
	}
);

/* ---------------------------------------------------------------------------
 * Affichage.
 * ------------------------------------------------------------------------- */

/**
 * Encadre factuel en tete de fiche, rendu par le serveur.
 */
add_filter(
	'the_content',
	function ( $contenu ) {
		if ( ! is_singular( 'activite' ) || ! is_main_query() ) {
			return $contenu;
		}
		$id     = get_the_ID();
		$lignes = array();
		foreach ( gf_activite_champs() as $cle => $champ ) {
			$valeur = get_post_meta( $id, '_gf_act_' . $cle, true );
			if ( ! $valeur ) {
				continue;
			}
			$lignes[ $champ['label'] ] = $valeur;
		}
		if ( ! $lignes ) {
			return $contenu;
		}

		$html = '<div class="gf-essentiel"><h2 class="gf-essentiel-titre">L’essentiel</h2><dl>';
		foreach ( $lignes as $terme => $valeur ) {
			$affichage = ( 0 === strpos( $valeur, 'http' ) )
				? '<a href="' . esc_url( $valeur ) . '" rel="noopener nofollow" target="_blank">' . esc_html( wp_parse_url( $valeur, PHP_URL_HOST ) ) . '</a>'
				: esc_html( $valeur );
			$html     .= '<div class="gf-essentiel-ligne"><dt>' . esc_html( $terme ) . '</dt><dd>' . $affichage . '</dd></div>';
		}
		$html .= '</dl></div>';

		return $html . $contenu;
	},
	6
);

/**
 * Liste des fiches publiees, a poser sur la page « Activités autour du domaine ».
 */
function gf_activite_shortcode_liste() {
	$fiches = get_posts(
		array(
			'post_type'      => 'activite',
			'post_status'    => 'publish',
			'numberposts'    => -1,
			'orderby'        => 'title',
			'order'          => 'ASC',
		)
	);
	if ( ! $fiches ) {
		return '';
	}

	$html = '<div class="gf-activites"><h2>Nos fiches par lieu</h2><ul class="gf-activites-liste">';
	foreach ( $fiches as $f ) {
		$distance = get_post_meta( $f->ID, '_gf_act_distance', true );
		$duree    = get_post_meta( $f->ID, '_gf_act_duree', true );
		$details  = array_filter( array( $distance, $duree ) );
		$html    .= '<li><a href="' . esc_url( get_permalink( $f ) ) . '">' . esc_html( get_the_title( $f ) ) . '</a>'
			. ( $details ? ' <span class="gf-activites-meta">' . esc_html( implode( ' · ', $details ) ) . '</span>' : '' )
			. ( $f->post_excerpt ? '<p>' . esc_html( $f->post_excerpt ) . '</p>' : '' )
			. '</li>';
	}
	$html .= '</ul></div>';

	return $html;
}
add_shortcode( 'solio_activites', 'gf_activite_shortcode_liste' );

add_action(
	'wp_enqueue_scripts',
	function () {
		$css = <<<'CSS'
.gf-activites { max-width: 645px; margin: 44px auto; padding: 0 22px; }
.gf-activites h2 { font-size: 1.5rem; color: #2f3a26; margin: 0 0 18px; }
.gf-activites-liste { list-style: none; padding: 0; margin: 0; }
.gf-activites-liste li { padding: 13px 0; border-bottom: 1px solid #e5e8df; }
.gf-activites-liste a { color: #5a6b48; font-weight: 600; text-decoration: none; }
.gf-activites-liste a:hover { text-decoration: underline; }
.gf-activites-meta { color: #9aa392; font-size: .85rem; font-weight: 400; }
.gf-activites-liste p { margin: 4px 0 0; color: #4a5340; font-size: .94rem; }
@media (max-width: 600px) { .gf-activites { padding: 0 16px; margin: 32px auto; } }
CSS;
		wp_register_style( 'gf-seo-activites', false );
		wp_enqueue_style( 'gf-seo-activites' );
		wp_add_inline_style( 'gf-seo-activites', $css );
	}
);

/**
 * Balisage TouristAttraction d’une fiche.
 */
add_action(
	'wp_head',
	function () {
		if ( ! is_singular( 'activite' ) ) {
			return;
		}
		$id  = get_the_ID();
		$lien = get_post_meta( $id, '_gf_act_lien', true );

		$noeud = gf_seo_compact(
			array(
				'@context'        => 'https://schema.org',
				'@type'           => 'TouristAttraction',
				'name'            => get_the_title(),
				'description'     => get_the_excerpt() ?: null,
				'url'             => get_permalink(),
				'image'           => has_post_thumbnail() ? gf_seo_absolute_url( get_the_post_thumbnail_url( $id, 'full' ) ) : null,
				'sameAs'          => $lien ?: null,
				'address'         => get_post_meta( $id, '_gf_act_commune', true ) ? array(
					'@type'           => 'PostalAddress',
					'addressLocality' => get_post_meta( $id, '_gf_act_commune', true ),
					'addressRegion'   => gf_seo_domaine()['region'],
					'addressCountry'  => 'FR',
				) : null,
				'isAccessibleForFree' => null,
				'touristType'     => get_post_meta( $id, '_gf_act_enfants', true ) ? 'Familles avec enfants' : null,
			)
		);

		echo "\n<script type=\"application/ld+json\">\n"
			. wp_json_encode( $noeud, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT )
			. "\n</script>\n";
	},
	6
);
