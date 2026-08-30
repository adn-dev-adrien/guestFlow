<?php
/**
 * gf-seo-admin.php — Edition manuelle du titre et de la description, page par page.
 *
 * Les valeurs par defaut viennent de gf_seo_pages() dans gf-seo-head.php. Cette metabox
 * permet de les surcharger depuis l’administration sans toucher au code. Un champ laisse
 * vide revient a la valeur par defaut.
 *
 * Un compteur de caracteres rappelle les cibles : 50 a 60 pour le titre, 140 a 155 pour
 * la description.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'add_meta_boxes',
	function () {
		foreach ( array( 'page', 'post', 'activite' ) as $type ) {
			add_meta_box(
				'gf_seo_box',
				'Référencement — Domaine Solio',
				'gf_seo_metabox_render',
				$type,
				'normal',
				'high'
			);
		}
	}
);

/**
 * Affichage de la metabox.
 *
 * @param WP_Post $post Page en cours d’edition.
 */
function gf_seo_metabox_render( $post ) {
	wp_nonce_field( 'gf_seo_save', 'gf_seo_nonce' );

	$titre = get_post_meta( $post->ID, '_gf_seo_title', true );
	$desc  = get_post_meta( $post->ID, '_gf_seo_description', true );

	// Valeurs par defaut issues de la table de correspondance, pour affichage indicatif.
	$defaut_titre = '';
	$defaut_desc  = '';
	$pages        = gf_seo_pages();
	$slug         = $post->post_name;
	foreach ( $pages as $cle => $conf ) {
		if ( $cle === $slug || in_array( $slug, (array) ( $conf['alias'] ?? array() ), true ) ) {
			$defaut_titre = $conf['title'] ?? '';
			$defaut_desc  = $conf['description'] ?? '';
			break;
		}
	}
	?>
	<style>
		.gf-seo-champ { margin-bottom: 18px; }
		.gf-seo-champ label { display:block; font-weight:600; margin-bottom:4px; }
		.gf-seo-champ input, .gf-seo-champ textarea { width:100%; }
		.gf-seo-defaut { color:#666; font-style:italic; font-size:12px; margin-top:4px; }
		.gf-seo-compteur { font-size:12px; font-weight:600; }
		.gf-seo-ok { color:#1a7f37; } .gf-seo-ko { color:#b32d2e; }
	</style>
	<div class="gf-seo-champ">
		<label for="gf_seo_title">Titre de la page dans Google <span class="gf-seo-compteur" data-cible="50-60"></span></label>
		<input type="text" id="gf_seo_title" name="gf_seo_title" value="<?php echo esc_attr( $titre ); ?>"
			data-min="50" data-max="60" placeholder="<?php echo esc_attr( $defaut_titre ); ?>" />
		<?php if ( $defaut_titre ) : ?>
			<p class="gf-seo-defaut">Par défaut : <?php echo esc_html( $defaut_titre ); ?></p>
		<?php endif; ?>
	</div>
	<div class="gf-seo-champ">
		<label for="gf_seo_description">Description dans Google <span class="gf-seo-compteur" data-cible="140-155"></span></label>
		<textarea id="gf_seo_description" name="gf_seo_description" rows="3"
			data-min="140" data-max="155" placeholder="<?php echo esc_attr( $defaut_desc ); ?>"><?php echo esc_textarea( $desc ); ?></textarea>
		<?php if ( $defaut_desc ) : ?>
			<p class="gf-seo-defaut">Par défaut : <?php echo esc_html( $defaut_desc ); ?></p>
		<?php endif; ?>
	</div>
	<p class="gf-seo-defaut">Laisser un champ vide conserve la valeur par défaut.</p>
	<script>
	( function () {
		document.querySelectorAll( '#gf_seo_title, #gf_seo_description' ).forEach( function ( el ) {
			var compteur = el.closest( '.gf-seo-champ' ).querySelector( '.gf-seo-compteur' );
			var min = parseInt( el.dataset.min, 10 ), max = parseInt( el.dataset.max, 10 );
			function maj() {
				var n = el.value.length;
				if ( ! n ) { compteur.textContent = ''; return; }
				compteur.textContent = n + ' caractères';
				compteur.className = 'gf-seo-compteur ' + ( n >= min && n <= max ? 'gf-seo-ok' : 'gf-seo-ko' );
			}
			el.addEventListener( 'input', maj );
			maj();
		} );
	} )();
	</script>
	<?php
}

/**
 * Enregistrement des surcharges.
 *
 * @param int $post_id Identifiant de la page.
 */
function gf_seo_metabox_save( $post_id ) {
	if ( ! isset( $_POST['gf_seo_nonce'] ) || ! wp_verify_nonce( sanitize_key( $_POST['gf_seo_nonce'] ), 'gf_seo_save' ) ) {
		return;
	}
	if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
		return;
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return;
	}

	foreach ( array( 'gf_seo_title' => '_gf_seo_title', 'gf_seo_description' => '_gf_seo_description' ) as $champ => $meta ) {
		$valeur = isset( $_POST[ $champ ] ) ? sanitize_text_field( wp_unslash( $_POST[ $champ ] ) ) : '';
		if ( '' === $valeur ) {
			delete_post_meta( $post_id, $meta );
		} else {
			update_post_meta( $post_id, $meta, $valeur );
		}
	}
}
add_action( 'save_post', 'gf_seo_metabox_save' );

/**
 * Bouton de purge du cache tarifaire, dans la barre d’administration.
 *
 * Les tarifs affiches proviennent de GuestFlow et sont mis en cache 6 h. Ce bouton force
 * une actualisation immediate apres un changement de prix.
 */
add_action(
	'admin_bar_menu',
	function ( $barre ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$barre->add_node(
			array(
				'id'    => 'gf-seo-purge',
				'title' => 'Actualiser les tarifs',
				'href'  => wp_nonce_url( admin_url( '?gf_seo_purge=1' ), 'gf_seo_purge' ),
				'meta'  => array( 'title' => 'Vide le cache des tarifs GuestFlow affichés sur le site' ),
			)
		);
	},
	100
);

add_action(
	'admin_init',
	function () {
		if ( empty( $_GET['gf_seo_purge'] ) || ! current_user_can( 'manage_options' ) ) {
			return;
		}
		check_admin_referer( 'gf_seo_purge' );
		gf_seo_purge_cache();
		wp_safe_redirect( admin_url() );
		exit;
	}
);
