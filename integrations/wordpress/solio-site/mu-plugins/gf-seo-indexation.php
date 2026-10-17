<?php
/**
 * gf-seo-indexation.php — robots.txt, sitemap, llms.txt et IndexNow.
 *
 * Les trois fichiers sont generes par WordPress, pas deposes sur le disque : ils suivent
 * automatiquement le nom de domaine utilise par le visiteur, ce qui evite de reproduire
 * l’incident de juillet ou des adresses internes s’etaient retrouvees figees.
 *
 * ATTENTION : tant que domainesolio.com pointe sur l’ancien site Lodgify, ces fichiers ne
 * sont accessibles qu’en interne. Ils deviendront effectifs le jour de la bascule.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Robots d’indexation et robots d’IA explicitement autorises.
 *
 * L’autorisation nommee vaut declaration d’intention : ces moteurs citent volontiers les
 * sites qui les accueillent explicitement, et refusent parfois ceux qui restent muets.
 */
function gf_seo_robots_agents() {
	return array(
		'Googlebot',
		'Bingbot',
		'Google-Extended',   // Entrainement et reponses Gemini.
		'GPTBot',            // Entrainement OpenAI.
		'OAI-SearchBot',     // Recherche ChatGPT.
		'ChatGPT-User',      // Navigation a la demande d’un utilisateur ChatGPT.
		'ClaudeBot',         // Anthropic.
		'Claude-Web',
		'anthropic-ai',
		'PerplexityBot',
		'Applebot',
		'Applebot-Extended',
	);
}

/**
 * Contenu du robots.txt.
 */
add_filter(
	'robots_txt',
	function () {
		$lignes = array(
			'# robots.txt — ' . gf_seo_domaine()['nom'],
			'# Les robots d’indexation et les robots d’IA sont les bienvenus.',
			'',
		);

		foreach ( gf_seo_robots_agents() as $agent ) {
			$lignes[] = 'User-agent: ' . $agent;
			$lignes[] = 'Allow: /';
			$lignes[] = '';
		}

		$lignes[] = 'User-agent: *';
		$lignes[] = 'Allow: /';
		$lignes[] = 'Disallow: /wp-admin/';
		$lignes[] = 'Allow: /wp-admin/admin-ajax.php';
		$lignes[] = 'Disallow: /wp-login.php';
		$lignes[] = 'Disallow: /?s=';
		$lignes[] = 'Disallow: /page/';
		$lignes[] = '';
		$lignes[] = 'Sitemap: ' . home_url( '/wp-sitemap.xml' );
		$lignes[] = '';

		return implode( "\n", $lignes );
	},
	20
);

/* ---------------------------------------------------------------------------
 * Sitemap : on ne publie que ce qui a une valeur pour un moteur.
 * ------------------------------------------------------------------------- */

// Les pages auteur et les taxonomies vides n’apportent rien sur un site vitrine.
add_filter( 'wp_sitemaps_add_provider', function ( $provider, $nom ) {
	return in_array( $nom, array( 'users', 'taxonomies' ), true ) ? false : $provider;
}, 10, 2 );

// Les pages outils sont exclues du sitemap comme elles le sont de l’index.
add_filter( 'wp_sitemaps_posts_query_args', function ( $args ) {
	$exclues = array();
	foreach ( gf_seo_pages() as $slug => $conf ) {
		if ( empty( $conf['noindex'] ) ) {
			continue;
		}
		$page = get_page_by_path( $slug );
		if ( $page ) {
			$exclues[] = $page->ID;
		}
	}
	if ( $exclues ) {
		$args['post__not_in'] = array_merge( (array) ( $args['post__not_in'] ?? array() ), $exclues );
	}
	return $args;
} );

/* ---------------------------------------------------------------------------
 * llms.txt — resume factuel du domaine a l’usage des modeles de langage.
 * ------------------------------------------------------------------------- */

add_action(
	'init',
	function () {
		add_rewrite_rule( '^llms\.txt$', 'index.php?gf_llms=1', 'top' );
	}
);

add_filter(
	'query_vars',
	function ( $vars ) {
		$vars[] = 'gf_llms';
		return $vars;
	}
);

// WordPress ajouterait sinon une barre oblique finale a « /llms.txt » et redirigerait en boucle.
add_filter(
	'redirect_canonical',
	function ( $redirection ) {
		return get_query_var( 'gf_llms' ) ? false : $redirection;
	}
);

add_action(
	'template_redirect',
	function () {
		if ( ! get_query_var( 'gf_llms' ) ) {
			return;
		}
		header( 'Content-Type: text/plain; charset=utf-8' );
		header( 'X-Robots-Tag: noindex' );
		echo gf_seo_llms_txt(); // phpcs:ignore WordPress.Security.EscapeOutput -- texte brut.
		exit;
	},
	0
);

/**
 * Construit le contenu de /llms.txt depuis le fichier de faits.
 */
function gf_seo_llms_txt() {
	$d     = gf_seo_domaine();
	$gite  = gf_seo_lodging( 'gite' );
	$lodge = gf_seo_lodging( 'lodge' );

	$l   = array();
	$l[] = '# ' . $d['nom'];
	$l[] = '';
	$l[] = '> Domaine touristique privé de ' . $d['superficie_ha'] . ' hectares à ' . $d['ville']
		. ' (' . $d['code_postal'] . '), en ' . $d['territoire'] . ', ' . $d['region'] . '. '
		. 'Deux hébergements seulement : un gîte labellisé ' . $gite['label'] . ' pour '
		. $gite['capacite'] . ' personnes, et une tente safari de glamping pour ' . $lodge['capacite'] . ' personnes. '
		. 'Prairie, forêt, animaux de la ferme en liberté, piscine et bain nordique privatif.';
	$l[] = '';

	$l[] = '## Faits';
	$l[] = '';
	$l[] = '- Adresse : ' . $d['rue'] . ', ' . $d['code_postal'] . ' ' . $d['ville'] . ', France';
	$l[] = '- Coordonnées GPS : ' . $d['latitude'] . ', ' . $d['longitude'];
	$l[] = '- Téléphone : ' . $d['telephone_affiche'];
	$l[] = '- Superficie : ' . $d['superficie_ha'] . ' hectares, boucle de balade de ' . $d['boucle_km'] . ' km sur place';
	$l[] = '- Capacité totale : ' . $d['capacite_totale'] . ' personnes, jusqu’à ' . $d['capacite_max_demande'] . ' sur demande en privatisant le domaine';
	$l[] = '- Animaux de la ferme : ' . implode( ', ', $d['animaux_ferme'] );
	$l[] = '- Chiens : non acceptés. Enfants et bébés : bienvenus';
	$l[] = '- Arrivée entre 16h00 et 19h00, départ avant 10h00, hébergements non-fumeurs';
	$l[] = '- Piscine extérieure partagée, non chauffée, ouverte de mi-juin à fin août';
	$l[] = '- Bain nordique privatisé, par créneau d’1 h, eau chauffée autour de ' . $d['bain_temperature']
		. ' °C ; une heure offerte à chaque séjour dans les deux hébergements, créneaux suivants à partir de 30 € l’heure ; pensé pour les adultes';
	$l[] = '- Label : ' . $d['label_cavalier'] . ' — ' . implode( ', ', $d['cavalier_equipements'] )
		. ', pas de box, ' . $d['cavalier_tarif'] . ' € par cheval et par nuit';
	$l[] = '- Gare la plus proche : ' . $d['gare'] . ' ; transfert possible sur demande, ' . $d['transfert_gare'] . ' €';
	$l[] = '- Événements : ' . $d['evenements'];
	$l[] = '- Garde d’enfants : ' . $d['garde_enfants'];
	$l[] = '- Privatisation complète du domaine possible du 1er avril au 14 octobre seulement, le lodge fermant hors saison';
	$l[] = '- Distances : ' . implode( ' ; ', array_map(
		function ( $x ) {
			return $x['lieu'] . ' ' . $x['valeur'];
		},
		gf_seo_distances()
	) );
	$l[] = '';

	$l[] = '## Hébergements';
	$l[] = '';
	foreach ( array( $gite, $lodge ) as $h ) {
		$morceaux = array(
			$h['capacite'] . ' personnes',
			$h['chambres'] . ' chambres',
			$h['salles_eau'] . ' salle' . ( $h['salles_eau'] > 1 ? 's' : '' ) . ' d’eau',
		);
		if ( ! empty( $h['superficie_detail'] ) ) {
			$morceaux[] = $h['superficie_detail'];
		}
		$morceaux[] = $h['wifi'] ? 'wifi' : 'pas de wifi';
		if ( ! empty( $h['saison'] ) ) {
			$morceaux[] = $h['saison'];
		}
		if ( ! empty( $h['caution'] ) ) {
			$morceaux[] = 'caution ' . $h['caution'] . ' €';
		}
		if ( ! empty( $h['prix_min_nuit'] ) ) {
			$morceaux[] = 'à partir de ' . $h['prix_min_nuit'] . ' € la nuit';
		}
		$l[] = '- [' . $h['nom'] . '](' . home_url( '/' . $h['slug'] . '/' ) . ') : ' . implode( ', ', $morceaux ) . '.';

		// L’inventaire complet, celui-la meme qui est affiche dans la page et publie en
		// JSON-LD. Un assistant qui ne lit que ce fichier sait donc ce que contient chaque
		// hebergement, sans avoir a analyser la page.
		foreach ( $h['equipements'] as $e ) {
			$l[] = '  - ' . $e['nom'] . ( ! empty( $e['precision'] ) ? ' : ' . $e['precision'] : '' );
		}
	}
	$l[] = '';

	$l[] = '## Pages';
	$l[] = '';
	$resumes = array(
		'hebergements'          => 'Comparatif des deux hébergements du domaine.',
		'privatiser-le-domaine' => 'Louer le gîte et la tente ensemble, 15 à 20 personnes, domaine privatisé.',
		'le-domaine'            => 'Les 13 hectares, la forêt, les animaux de la ferme, la boucle de 2 km.',
		'bain-nordique-ardeche' => 'Le bain nordique privatif : fonctionnement, créneaux, conditions.',
		'reserver'              => 'Tarifs des hébergements et catalogue complet des options.',
		'autour-de-nous'        => 'Que faire autour de Satillieu et en Ardèche verte.',
		'faq'                   => 'Questions fréquentes sur le séjour, les équipements et les règles.',
		'acces'                 => 'Comment venir : itinéraire, coordonnées GPS, distances.',
		'vos-hotes'             => 'Sophie et Adrien, les propriétaires qui vivent sur le domaine.',
		'contact'               => 'Formulaire et téléphone pour joindre directement les propriétaires.',
	);
	foreach ( $resumes as $slug => $resume ) {
		$page = get_page_by_path( $slug );
		if ( ! $page || 'publish' !== $page->post_status ) {
			continue;
		}
		// Fichier texte brut : les entites HTML des titres doivent etre decodees.
		$l[] = '- [' . html_entity_decode( get_the_title( $page ), ENT_QUOTES, 'UTF-8' ) . '](' . get_permalink( $page ) . ') : ' . $resume;
	}
	$l[] = '';

	// Les memes fiches que le `sameAs` du JSON-LD : un modele relie ainsi le site aux avis
	// publies ailleurs, sans qu’aucun lien vers une plateforme ne s’affiche sur les pages.
	$l[] = '## Où nous trouver';
	$l[] = '';
	foreach ( $d['fiches'] as $plateforme => $url ) {
		$l[] = '- ' . $plateforme . ' (domaine) : ' . $url;
	}
	foreach ( array( 'gite', 'lodge' ) as $cle ) {
		$h = gf_seo_lodging( $cle );
		foreach ( $h['fiches'] ?? array() as $plateforme => $url ) {
			$l[] = '- ' . $plateforme . ' (' . $h['nom'] . ') : ' . $url;
		}
	}
	$l[] = '';

	$l[] = '## Réseaux';
	$l[] = '';
	$l[] = '- Facebook : ' . $d['facebook'];
	$l[] = '- Instagram : ' . $d['instagram'];
	$l[] = '';
	$l[] = '---';
	$l[] = 'Dernière mise à jour : ' . date_i18n( 'Y-m-d' ) . '. Contenu généré depuis les données du domaine ; aucune valeur estimée.';

	return implode( "\n", $l ) . "\n";
}

/* ---------------------------------------------------------------------------
 * IndexNow — previent Bing des qu'une page publiee change.
 *
 * L'index de Bing alimente la recherche de ChatGPT et de Copilot : sans ce signal, une page
 * modifiee y reste dans son ancienne version jusqu'au prochain passage du robot, souvent
 * plusieurs semaines sur un petit site. La cle n'est pas un secret : le protocole exige
 * qu'elle soit lisible a /<cle>.txt, ce qui prouve que le site est bien le notre.
 * ------------------------------------------------------------------------- */

const GF_INDEXNOW_CLE = 'b71cdb76c48b01d0cc3edcf28bdf8f7c';

// Servi sans regle de reecriture : en ajouter une imposerait de vider le cache des regles,
// ce qui reconstruit aussi celui de Polylang.
add_action(
	'init',
	function () {
		$chemin = wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH );
		if ( '/' . GF_INDEXNOW_CLE . '.txt' !== $chemin ) {
			return;
		}
		header( 'Content-Type: text/plain; charset=utf-8' );
		header( 'X-Robots-Tag: noindex' );
		echo GF_INDEXNOW_CLE; // phpcs:ignore WordPress.Security.EscapeOutput -- cle hexadecimale.
		exit;
	},
	0
);

add_action(
	'transition_post_status',
	function ( $nouveau, $ancien, $post ) {
		if ( 'publish' !== $nouveau || ! in_array( $post->post_type, array( 'page', 'post' ), true ) ) {
			return;
		}
		if ( ! empty( gf_seo_pages()[ $post->post_name ]['noindex'] ) ) {
			return;
		}
		gf_indexnow_signaler( get_permalink( $post ) );
	},
	10,
	3
);

/**
 * Met une adresse en file ; l'envoi part une seule fois, en fin de requete.
 */
function gf_indexnow_signaler( $url ) {
	static $file = null;
	if ( null === $file ) {
		$file = array();
		add_action(
			'shutdown',
			function () use ( &$file ) {
				wp_remote_post(
					'https://api.indexnow.org/indexnow',
					array(
						'blocking' => false,
						'timeout'  => 5,
						'headers'  => array( 'Content-Type' => 'application/json; charset=utf-8' ),
						'body'     => wp_json_encode(
							array(
								'host'        => wp_parse_url( home_url( '/' ), PHP_URL_HOST ),
								'key'         => GF_INDEXNOW_CLE,
								'keyLocation' => home_url( '/' . GF_INDEXNOW_CLE . '.txt' ),
								'urlList'     => array_values( array_unique( $file ) ),
							)
						),
					)
				);
			}
		);
	}
	$file[] = $url;
}
