<?php
/**
 * gf-seo-images.php — Completion automatique des balises <img>.
 *
 * Une bonne partie des images du site est ecrite en HTML brut dans le contenu des pages :
 * WordPress ne leur ajoute donc ni texte alternatif, ni dimensions, ni srcset. Ce module
 * repare cela au moment du rendu, en retrouvant la piece jointe correspondant au fichier.
 *
 * Pour chaque image du contenu :
 *   - alt repris de la mediatheque s’il manque (accessibilite et referencement) ;
 *   - width et height explicites, pour supprimer les sauts de mise en page (CLS) ;
 *   - srcset et sizes, pour que les mobiles ne telechargent pas une image de 2048 px ;
 *   - loading="lazy" et decoding="async", sauf sur la premiere image de la page ;
 *   - fetchpriority="high" sur cette premiere image, qui est presque toujours l’element LCP.
 *
 * Le balisage n’est jamais restructure : pas de <picture>, pas de conteneur ajoute. La
 * conversion WebP est prise en charge par Apache (voir wp-content/uploads/.htaccess), ce
 * qui evite tout risque sur les carrousels.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Retrouve l’identifiant de piece jointe a partir d’une URL de fichier, taille comprise.
 *
 * @param string $url URL trouvee dans un attribut src.
 * @return int Identifiant, ou 0.
 */
function gf_seo_attachment_depuis_url( $url ) {
	static $cache = array();
	if ( isset( $cache[ $url ] ) ) {
		return $cache[ $url ];
	}

	$chemin = wp_parse_url( $url, PHP_URL_PATH );
	if ( ! $chemin || false === strpos( $chemin, '/wp-content/uploads/' ) ) {
		return $cache[ $url ] = 0;
	}
	$relatif = substr( $chemin, strpos( $chemin, '/wp-content/uploads/' ) + strlen( '/wp-content/uploads/' ) );

	// Le suffixe de taille (-1024x683) ne fait pas partie du fichier enregistre.
	$sans_taille = preg_replace( '~-\d+x\d+(?=\.[a-z]{3,4}$)~i', '', $relatif );

	// Quand WordPress a reduit une photo trop grande, le fichier enregistre porte en plus
	// le suffixe -scaled : il faut donc essayer les deux formes.
	$candidats = array( $sans_taille );
	if ( preg_match( '~^(.*)(\.[a-z]{3,4})$~i', $sans_taille, $m ) ) {
		$candidats[] = $m[1] . '-scaled' . $m[2];
	}

	global $wpdb;
	foreach ( $candidats as $candidat ) {
		$id = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT post_id FROM $wpdb->postmeta WHERE meta_key = '_wp_attached_file' AND meta_value = %s LIMIT 1",
				$candidat
			)
		);
		if ( $id ) {
			return $cache[ $url ] = $id;
		}
	}
	return $cache[ $url ] = 0;
}

/**
 * Complete les balises <img> d’un fragment de HTML.
 *
 * @param string $html Contenu rendu.
 * @return string
 */
function gf_seo_completer_images( $html ) {
	if ( false === stripos( $html, '<img' ) ) {
		return $html;
	}

	static $premiere_vue = false;

	return preg_replace_callback(
		'~<img\b[^>]*>~i',
		function ( $m ) use ( &$premiere_vue ) {
			$balise = $m[0];

			if ( ! preg_match( '~\ssrc=["\']([^"\']+)["\']~i', $balise, $s ) ) {
				return $balise;
			}
			$src = $s[1];
			// La classe wp-image-<id> ajoutee par l'editeur est l'indication la plus fiable ;
			// on ne cherche par nom de fichier que si elle est absente.
			$id = preg_match( '~\bwp-image-(\d+)\b~', $balise, $c ) ? (int) $c[1] : gf_seo_attachment_depuis_url( $src );

			$ajouts = '';

			// Texte alternatif : uniquement s’il est absent ou vide.
			if ( $id && ! preg_match( '~\salt=["\'][^"\']+["\']~i', $balise ) ) {
				$alt = get_post_meta( $id, '_wp_attachment_image_alt', true );
				if ( $alt ) {
					$balise = preg_replace( '~\salt=["\']["\']~i', '', $balise );
					$ajouts .= ' alt="' . esc_attr( $alt ) . '"';
				}
			}

			// Dimensions, contre les sauts de mise en page.
			if ( $id && ! preg_match( '~\swidth=~i', $balise ) ) {
				$taille = gf_seo_dimensions_image( $id, $src );
				if ( $taille ) {
					$ajouts .= ' width="' . $taille[0] . '" height="' . $taille[1] . '"';
				}
			}

			// Jeu de sources adapte a la largeur d’ecran.
			if ( $id && ! preg_match( '~\ssrcset=~i', $balise ) ) {
				$meta = wp_get_attachment_metadata( $id );
				if ( $meta ) {
					$srcset = wp_calculate_image_srcset(
						array( $meta['width'], $meta['height'] ),
						$src,
						$meta,
						$id
					);
					if ( $srcset ) {
						$sizes   = wp_calculate_image_sizes( array( $meta['width'], $meta['height'] ), $src, $meta, $id );
						$ajouts .= ' srcset="' . esc_attr( $srcset ) . '"';
						$ajouts .= ' sizes="' . esc_attr( $sizes ?: '(max-width: 645px) 100vw, 645px' ) . '"';
					}
				}
			}

			// Chargement : la premiere image de la page est l’element le plus visible,
			// elle doit etre prioritaire ; toutes les autres sont differees.
			if ( ! $premiere_vue ) {
				$premiere_vue = true;
				$balise       = preg_replace( '~\sloading=["\'][^"\']*["\']~i', '', $balise );
				if ( ! preg_match( '~fetchpriority=~i', $balise ) ) {
					$ajouts .= ' fetchpriority="high"';
				}
			} elseif ( ! preg_match( '~\sloading=~i', $balise ) ) {
				$ajouts .= ' loading="lazy"';
			}

			if ( ! preg_match( '~\sdecoding=~i', $balise ) ) {
				$ajouts .= ' decoding="async"';
			}

			if ( '' === $ajouts ) {
				return $balise;
			}
			return rtrim( substr( $balise, 0, -1 ), '/ ' ) . $ajouts . ' />';
		},
		$html
	);
}

// Le contenu des pages et les modeles de blocs passent tous les deux par ce filtre.
add_filter( 'the_content', 'gf_seo_completer_images', 20 );
add_filter( 'render_block', 'gf_seo_completer_images', 20 );

/**
 * Dimensions reelles du fichier pointe par l’URL, taille intermediaire comprise.
 *
 * @param int    $id  Piece jointe.
 * @param string $src URL utilisee dans la page.
 * @return array|null [largeur, hauteur]
 */
function gf_seo_dimensions_image( $id, $src ) {
	$meta = wp_get_attachment_metadata( $id );
	if ( ! $meta ) {
		return null;
	}
	$fichier = basename( wp_parse_url( $src, PHP_URL_PATH ) );

	if ( ! empty( $meta['sizes'] ) ) {
		foreach ( $meta['sizes'] as $taille ) {
			if ( $taille['file'] === $fichier ) {
				return array( $taille['width'], $taille['height'] );
			}
		}
	}
	if ( ! empty( $meta['width'] ) && ! empty( $meta['height'] ) ) {
		return array( $meta['width'], $meta['height'] );
	}
	return null;
}
