<?php
/**
 * gf-seo-indexation.php — robots.txt, sitemap et llms.txt.
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
	$l[] = '- Piscine extérieure partagée, non chauffée, ouverte en juillet et août';
	$l[] = '- Bain nordique privatisé, par créneau d’1h30, eau chauffée autour de ' . $d['bain_temperature']
		. ' °C ; offert dès 3 nuits au gîte, en option au lodge ; réservé aux adultes';
	$l[] = '- Label : ' . $d['label_cavalier'] . ' — ' . implode( ', ', $d['cavalier_equipements'] )
		. ', pas de box, ' . $d['cavalier_tarif'] . ' € par cheval et par nuit';
	$l[] = '- Gare la plus proche : ' . $d['gare'] . ' ; transfert possible sur demande, ' . $d['transfert_gare'] . ' €';
	$l[] = '- Événements : ' . $d['evenements'];
	$l[] = '- Garde d’enfants : ' . $d['garde_enfants'];
	$l[] = '- Privatisation complète du domaine possible de mai à septembre seulement, le lodge fermant hors saison';
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
	}
	$l[] = '';

	$l[] = '## Pages';
	$l[] = '';
	$resumes = array(
		'hebergements'                => 'Comparatif des deux hébergements du domaine.',
		'privatiser-le-domaine'       => 'Louer le gîte et la tente ensemble, 15 à 20 personnes, domaine privatisé.',
		'le-domaine'                  => 'Les 13 hectares, la forêt, les animaux de la ferme, la boucle de 2 km.',
		'bain-nordique-ardeche'       => 'Le bain nordique privatif : fonctionnement, créneaux, conditions.',
		'tarifs-et-reservation'       => 'Tarifs des hébergements et catalogue complet des options.',
		'activites-autour-du-domaine' => 'Que faire autour de Satillieu et en Ardèche verte.',
		'faq'                         => 'Questions fréquentes sur le séjour, les équipements et les règles.',
		'acces'                       => 'Comment venir : itinéraire, coordonnées GPS, distances.',
		'vos-hotes'                   => 'Sophie et Adrien, les propriétaires qui vivent sur le domaine.',
		'contact'                     => 'Formulaire et téléphone pour joindre directement les propriétaires.',
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

	$l[] = '## Réseaux';
	$l[] = '';
	$l[] = '- Facebook : ' . $d['facebook'];
	$l[] = '- Instagram : ' . $d['instagram'];
	$l[] = '';
	$l[] = '---';
	$l[] = 'Dernière mise à jour : ' . date_i18n( 'Y-m-d' ) . '. Contenu généré depuis les données du domaine ; aucune valeur estimée.';

	return implode( "\n", $l ) . "\n";
}
