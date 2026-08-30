<?php
/**
 * gf-seo-facts.php — Source de verite unique du referencement.
 *
 * Toutes les donnees factuelles du Domaine Solio sont centralisees ici : adresse, GPS,
 * capacites, horaires, equipements, distances, tarifs. Les balises <head> (gf-seo-head.php),
 * le JSON-LD (gf-seo-schema.php) et les encadres affiches sur les pages (gf-seo-blocks.php)
 * lisent tous ce fichier. Objectif : il est impossible que l'affichage et les donnees
 * structurees divergent.
 *
 * Regle : aucune valeur inventee. Une donnee absente vaut null et n'est jamais publiee.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Faits generaux du domaine.
 */
function gf_seo_domaine() {
	return array(
		'nom'              => 'Domaine Solio',
		'rue'              => '215 côte de Japperenard',
		'code_postal'      => '07290',
		'ville'            => 'Satillieu',
		'region'           => 'Ardèche',
		'territoire'       => 'Ardèche verte',
		'pays'             => 'FR',
		'latitude'         => 45.1615892,
		'longitude'        => 4.6299588,
		'telephone'        => '+33615739337',
		'telephone_affiche' => '06 15 73 93 37',
		'facebook'         => 'https://www.facebook.com/Solio07',
		'instagram'        => 'https://www.instagram.com/domainesolio',
		'superficie_ha'    => 13,
		'boucle_km'        => 2,
		'nb_hebergements'  => 2,
		'capacite_totale'  => 15,
		'capacite_max_demande' => 20,
		'animaux_ferme'    => array( 'ânes', 'chèvres', 'moutons Lacaune', 'moutons du Cameroun', 'poules' ),
		'essences_foret'   => array( 'chênes', 'châtaigniers', 'hêtres', 'acacias', 'pins', 'douglas' ),
		'faune_sauvage'    => array( 'chevreuils', 'rapaces', 'salamandres', 'chouettes' ),
		'chiens_acceptes'  => false,
		'enfants_bienvenus' => true,
		'label_cavalier'   => 'Accueil Cavalier (CDTE Drôme-Ardèche)',
		'cavalier_equipements' => array( 'pré clôturé', 'point d’eau', 'foin fourni' ),
		'cavalier_tarif'   => 10,   // Euros par cheval et par nuit.
		'bain_temperature' => 38,   // Degres Celsius, temperature de chauffe habituelle.
		'gare'             => 'Saint-Vallier-sur-Rhône',
		'transfert_gare'   => 50,   // Euros, transfert depuis la gare sur demande.
		'evenements'       => 'séminaires acceptés, mariages non',
		'garde_enfants'    => 'sur demande, tarif à convenir',
		// Visuel de partage : chaque page utilise sa propre image de bandeau, ce qui est plus
		// pertinent qu’un visuel unique. Ce repli ne sert que si une page n’a aucune image.
		'og_image'         => null,
	);
}

/**
 * Equipements et services communs aux deux hebergements.
 */
function gf_seo_equipements_domaine() {
	return array(
		'Piscine extérieure partagée, non chauffée, juillet et août',
		'Bain nordique extérieur privatisé, sur réservation',
		'Barbecue et cuisine d’été',
		'Sentier de balade de 2 km sur le domaine',
		'Animaux de la ferme en accès libre',
		'Rivière de baignade à proximité',
		'Parking gratuit sur place',
	);
}

/**
 * Faits propres a chaque hebergement.
 *
 * Les donnees marquees « API » (capacite, horaires, tarif a partir de) sont rafraichies
 * depuis GuestFlow par gf_seo_lodging(). Les valeurs ci-dessous servent de repli.
 */
function gf_seo_lodgings() {
	return array(
		'gite'  => array(
			'cle'                  => 'gite',
			'guestflow_id'         => 1,
			'nom'                  => 'Le Gîte du Domaine',
			'slug'                 => 'gite-10-personnes-ardeche',
			'type_schema'          => 'Accommodation',
			'label'                => 'Gîtes de France 3 épis',
			'numero_label'         => '07G309700',
			'capacite'             => 10,          // API maxAdults
			'capacite_max'         => 12,          // Couchages d’appoint compris.
			'capacite_note'        => '12 personnes possible',
			'chambres'             => 4,
			'lits_doubles'         => 4,
			'lits_simples'         => 5,
			'salles_eau'           => 2,
			'toilettes'            => 2,
			'superficie_m2'        => 180,         // 60 m² par niveau, sur trois niveaux.
			'superficie_detail'    => '180 m² sur trois niveaux, soit 60 m² par niveau',
			'saison'               => 'ouvert toute l’année',
			'checkin'              => '16:00',
			'checkin_fin'          => '19:00',     // Plage d’arrivee affichee dans « Bon a savoir ».
			'checkout'             => '10:00',
			'prix_min_nuit'        => 252,         // API fromPricePerNight
			'wifi'                 => true,
			'non_fumeur'           => true,
			// Aucun des deux hebergements n’est accessible aux personnes a mobilite reduite.
			// Un logement dedie est a l’etude, mais a plusieurs annees d’echeance : on ne
			// l’annonce pas sur le site tant qu’il n’a pas de date.
			'accessible_pmr'       => false,
			'accessible_pmr_note'  => 'non adapté aux personnes à mobilité réduite — maison sur trois niveaux',

			'caution'              => 500,
			'bain_nordique'        => '1 séance offerte pour les réservations de 3 nuits et plus',
			'equipements'          => array(
				'Cuisine équipée : four, micro-ondes, lave-vaisselle, réfrigérateur, cafetière Nespresso, grille-pain',
				'Poêle à bois, bois fourni',
				'Grande pièce de vie et tablée de 10 à 12 couverts',
				'Terrasse exposée au soleil levant, vue sur les montagnes',
				'Salle de jeux dans les combles',
				'Machine à laver, fer et planche à repasser, sèche-cheveux',
				'Lits faits à l’arrivée, draps fournis',
				'Wifi gratuit',
				'Chaise haute bébé',
				'Détecteurs de fumée et de CO, extincteur, trousse de premiers secours',
				'Entièrement rénové, isolation en laine de bois',
			),
		),
		'lodge' => array(
			'cle'                  => 'lodge',
			'guestflow_id'         => 2,
			'nom'                  => 'L’Aventura Lodge',
			'slug'                 => 'tente-safari-glamping-ardeche',
			'type_schema'          => 'Campground',
			'label'                => null,
			'numero_label'         => null,
			'capacite'             => 5,
			'capacite_max'         => 5,
			'capacite_note'        => null,
			'chambres'             => 2,
			'lits_doubles'         => 1,
			'lits_simples'         => 3,
			'salles_eau'           => 1,
			'toilettes'            => 1,
			'superficie_m2'        => 24,          // Surface sous toile ; sanitaires sur la terrasse.
			'superficie_detail'    => '24 m² sous la tente, plus 50 m² de terrasse où se trouvent la salle d’eau et les toilettes',
			'terrasse_m2'          => 50,
			'saison'               => 'ouvert de mai à septembre',
			'checkin'              => '16:00',
			'checkin_fin'          => '19:00',
			'checkout'             => '10:00',
			'prix_min_nuit'        => 110,
			'wifi'                 => false,
			'non_fumeur'           => true,
			'accessible_pmr'       => false,
			'accessible_pmr_note'  => 'non adapté aux personnes à mobilité réduite — accès nature à pied sur 300 m',

			'caution'              => 400,
			'bain_nordique'        => 'en option, sur réservation, privatisé',
			'equipements'          => array(
				'Tente safari sur terrasse bois montée sur pilotis',
				'Kitchenette : plaque de cuisson, micro-ondes, réfrigérateur, cafetière',
				'Salle d’eau et toilettes privatives',
				'Eau chaude et électricité',
				'Terrasse privée exposée au coucher de soleil',
				'Plancha offerte à partir de 2 nuits',
				'Ciel étoilé sans pollution lumineuse',
				'Pas de wifi',
				'Parking gratuit sur place, accès à pied à 300 m',
			),
		),
	);
}

/**
 * Questions frequentes, par page.
 *
 * Meme source pour la FAQ affichee et pour le balisage FAQPage : les deux ne peuvent pas
 * diverger. La premiere phrase de chaque reponse contient la reponse directe, c’est ce que
 * les moteurs et les assistants citent.
 *
 * Le jeton %prix% est remplace a l’affichage par le tarif vivant lu dans GuestFlow.
 *
 * @param string $cle Identifiant de page.
 * @return array Liste de couples question / reponse.
 */
function gf_seo_faq( $cle ) {
	$faq = array(

		'gite' => array(
			array( 'q' => 'Combien de personnes peut accueillir le gîte ?',
				'r' => 'Dix personnes confortablement, douze avec les couchages d’appoint. Quatre chambres sur trois niveaux, 2 salles d’eau et 2 toilettes.' ),
			array( 'q' => 'Le gîte accepte-t-il les chiens ?',
				'r' => 'Non. Nos ânes, chèvres et moutons vivent en liberté et les enfants entrent dans les enclos : la cohabitation n’est pas possible. Bébés et enfants, eux, sont les bienvenus.' ),
			array( 'q' => 'Y a-t-il le wifi au gîte ?',
				'r' => 'Oui, gratuit. C’est le seul des deux hébergements à en être équipé.' ),
			array( 'q' => 'À quelle heure arrive-t-on et repart-on ?',
				'r' => 'Arrivée entre 16h et 19h, départ avant 10h. Le gîte est non-fumeur.' ),
			array( 'q' => 'Le bain nordique est-il privatif ?',
				'r' => 'Oui, entièrement, par créneau d’1h30. Une séance est offerte à partir de 3 nuits ; les créneaux supplémentaires sont à 30 € l’heure.' ),
			array( 'q' => 'Peut-on venir en hiver ?',
				'r' => 'Oui, le gîte est ouvert toute l’année, isolé en laine de bois et chauffé au poêle. La piscine, elle, n’ouvre qu’en juillet et août.' ),
			array( 'q' => 'La piscine est-elle privée ?',
				'r' => 'Non, elle est partagée avec la tente safari — soit deux hébergements sur 13 hectares. Non chauffée, ouverte en juillet et août.' ),
			array( 'q' => 'Les draps sont-ils fournis ?',
				'r' => 'Oui, les lits sont faits à votre arrivée. Le linge de toilette est en option, à 8 € par personne.' ),
			array( 'q' => 'Y a-t-il de quoi occuper les enfants ?',
				'r' => 'Une salle de jeux dans les combles, et surtout les animaux, que les enfants nourrissent eux-mêmes. Des animations sont proposées, de la chasse au trésor à la balade nocturne.' ),
			array( 'q' => 'Combien coûte une nuit ?',
				'r' => 'À partir de %prix%, dégressif dès 3 nuits. Le prix exact dépend de vos dates : le moteur de réservation l’affiche en temps réel.' ),
		),

		'lodge' => array(
			array( 'q' => 'Combien de personnes peut accueillir la tente safari ?',
				'r' => 'Cinq personnes, en 2 chambres — un lit double et 3 lits simples — avec salle d’eau et toilettes privatives.' ),
			array( 'q' => 'Y a-t-il le wifi ?',
				'r' => 'Non, et c’est un choix. On vient ici pour décrocher : pas de wifi, pas de pollution lumineuse. Le wifi reste disponible au gîte.' ),
			array( 'q' => 'Est-ce confortable, de dormir sous une tente ?',
				'r' => 'C’est le confort d’une chambre d’hôtel avec les sensations du camping : vrais lits, salle d’eau privative, eau chaude et électricité, sur une terrasse en bois.' ),
			array( 'q' => 'Peut-on cuisiner ?',
				'r' => 'Une kitchenette avec plaque, micro-ondes et réfrigérateur. On cuisine surtout dehors : la plancha est offerte à partir de 2 nuits.' ),
			array( 'q' => 'Y a-t-il des voisins ?',
				'r' => 'Non. La première maison est à plus de 100 mètres, et la tente est installée dans l’enclos des chèvres et des moutons.' ),
			array( 'q' => 'Quelle est la caution ?',
				'r' => '400 €, non encaissée et restituée après le séjour.' ),
			array( 'q' => 'À quelle heure arrive-t-on et repart-on ?',
				'r' => 'Arrivée entre 16h et 19h, départ avant 10h. Parking gratuit, puis 300 mètres à pied : le lodge n’est pas accessible en fauteuil roulant.' ),
			array( 'q' => 'Le bain nordique est-il inclus ?',
				'r' => 'Non, il est en option au lodge, privatisé et sur réservation, à 30 € l’heure.' ),
			array( 'q' => 'Les chiens sont-ils acceptés ?',
				'r' => 'Non : la tente est installée au milieu d’un enclos où vivent chèvres et moutons. Les enfants, eux, sont les bienvenus.' ),
			array( 'q' => 'La tente est-elle ouverte en hiver ?',
				'r' => 'Non, elle se loue de mai à septembre. Hors saison, les nuits ardéchoises sont trop fraîches sous la toile — le gîte, lui, est ouvert toute l’année.' ),
			array( 'q' => 'Combien coûte une nuit ?',
				'r' => 'À partir de %prix%, dégressif selon la durée. Le moteur de réservation affiche le prix exact pour vos dates.' ),
		),

		'domaine' => array(
			array( 'q' => 'Quelle est la superficie du domaine ?',
				'r' => '13 hectares de prairie et de forêt, avec une boucle de balade de 2 km entièrement sur la propriété.' ),
			array( 'q' => 'Quels animaux vivent sur le domaine ?',
				'r' => 'Des ânes, des chèvres, des moutons Lacaune et du Cameroun, et des poules. Les enfants entrent dans les enclos pour les approcher et les nourrir.' ),
			array( 'q' => 'Peut-on s’y promener librement ?',
				'r' => 'Oui, les 13 hectares sont ouverts à nos hôtes. Le sentier traverse la prairie puis la forêt de chênes, châtaigniers, hêtres et douglas.' ),
			array( 'q' => 'Y a-t-il de la faune sauvage ?',
				'r' => 'Chevreuils, rapaces, salamandres et chouettes. Nous ne promettons aucune observation : c’est la nature, elle se montre quand elle veut.' ),
			array( 'q' => 'La piscine est-elle chauffée ?',
				'r' => 'Non, et elle n’ouvre qu’en juillet et août. Une rivière de baignade se trouve à quelques minutes.' ),
			array( 'q' => 'Accueillez-vous les cavaliers ?',
				'r' => 'Oui, le domaine est labellisé Accueil Cavalier. Pré clôturé, point d’eau et foin fourni, 10 € par cheval et par nuit ; pas de box.' ),
		),

		'bain-nordique' => array(
			array( 'q' => 'Le bain nordique est-il privatif ?',
				'r' => 'Oui, entièrement : une séance d’1h30 rien que pour vous.' ),
			array( 'q' => 'Est-il inclus dans le séjour ?',
				'r' => 'Une séance est offerte au gîte à partir de 3 nuits ; au lodge, il est en option. Les créneaux supplémentaires sont à 30 € l’heure.' ),
			array( 'q' => 'Les enfants peuvent-ils y aller ?',
				'r' => 'Non, il est réservé aux adultes, pour des raisons de sécurité liées à la température de l’eau.' ),
			array( 'q' => 'À quelle température est l’eau ?',
				'r' => 'Autour de 38 °C : assez chaude pour tenir une heure et demie, sans être éprouvante.' ),
			array( 'q' => 'La séance est-elle garantie ?',
				'r' => 'Non, elle dépend des conditions climatiques et techniques. Elle ne donne droit à aucun remboursement, mais nous cherchons toujours à la reprogrammer.' ),
			array( 'q' => 'Peut-on l’utiliser en hiver ?',
				'r' => 'Oui, toute l’année — et c’est la plus belle saison : l’eau chaude, l’air froid, le ciel étoilé.' ),
		),

		'privatisation' => array(
			array( 'q' => 'Combien de personnes en privatisant ?',
				'r' => '15 personnes, jusqu’à 20 sur demande. Vous êtes alors seuls sur les 13 hectares.' ),
			array( 'q' => 'Qu’est-ce que cela comprend ?',
				'r' => 'Les deux hébergements, donc tout le domaine : prairie, forêt, sentier, piscine en saison, bain nordique et animaux.' ),
			array( 'q' => 'À quelle période ?',
				'r' => 'De mai à septembre, le lodge fermant hors saison. Le reste de l’année, le gîte seul reste disponible.' ),
			array( 'q' => 'Y a-t-il un tarif dégressif ?',
				'r' => 'Oui, à partir de 3 nuits. Écrivez-nous pour un devis, nous répondons directement.' ),
			array( 'q' => 'Peut-on organiser un mariage ou un séminaire ?',
				'r' => 'Les séminaires sont les bienvenus ; les mariages, non. Le domaine vit au rythme de ses animaux, une grande réception n’y a pas sa place.' ),
			array( 'q' => 'Proposez-vous des prestations pour les groupes ?',
				'r' => 'Petit-déjeuner, planches apéro jusqu’à 12 personnes, repas des trappeurs et animations enfants. Le détail figure sur la page des tarifs.' ),
		),

		'enfants' => array(
			array( 'q' => 'Le domaine convient-il aux jeunes enfants ?',
				'r' => 'Oui : les enfants entrent dans les enclos, le gîte a une salle de jeux, une chaise haute et un lit bébé, et le domaine est sans circulation.' ),
			array( 'q' => 'Quelles animations proposez-vous ?',
				'r' => 'Chasse aux œufs, visite des animaux, découverte de la faune sauvage et balade nocturne. Les tarifs figurent sur la page des tarifs.' ),
			array( 'q' => 'Proposez-vous une garde d’enfants ?',
				'r' => 'Oui, sur demande et à organiser à l’avance ; le tarif se convient ensemble selon la durée.' ),
			array( 'q' => 'Que faire avec des enfants autour du domaine ?',
				'r' => 'Le Safari de Peaugres à 20 minutes, le lac de Devesset pour la baignade, et la Via Fluvia, plate et praticable à vélo avec de jeunes enfants.' ),
			array( 'q' => 'Le bain nordique leur est-il accessible ?',
				'r' => 'Non, il est réservé aux adultes. Les enfants profitent de la piscine en juillet et août.' ),
			array( 'q' => 'Faut-il apporter le matériel de bébé ?',
				'r' => 'Non : lit bébé sans supplément et chaise haute au gîte. Prévenez-nous, tout est prêt à votre arrivée.' ),
		),

		'acces' => array(
			array( 'q' => 'Quelle est l’adresse exacte ?',
				'r' => '215 côte de Japperenard, 07290 Satillieu. Réglez votre GPS sur 45.1615892, 4.6299588 plutôt que sur le nom de la commune.' ),
			array( 'q' => 'Combien de temps depuis Lyon ou Valence ?',
				'r' => 'Environ une heure depuis l’une comme depuis l’autre. La vallée du Rhône est à 30 minutes, Annonay à 15 km.' ),
			array( 'q' => 'Y a-t-il des commerces à proximité ?',
				'r' => 'Satillieu et ses commerces sont à 7 minutes en voiture.' ),
			array( 'q' => 'Où se garer ?',
				'r' => 'Parking gratuit sur place. Pour le lodge, comptez ensuite 300 mètres à pied : prévoyez un sac plutôt qu’une valise à roulettes.' ),
			array( 'q' => 'Peut-on venir en train ?',
				'r' => 'La gare la plus proche est Saint-Vallier-sur-Rhône. Nous pouvons vous y chercher sur demande, pour 50 €. Sans voiture, les sorties alentour restent limitées.' ),
			array( 'q' => 'À quelle heure peut-on arriver ?',
				'r' => 'Entre 16h et 19h, départ avant 10h. La route de montagne se fait mieux de jour.' ),
		),
	);

	return $faq[ $cle ] ?? array();
}

/**
 * Distances depuis le domaine, telles qu’affichees sur le site.
 */
function gf_seo_distances() {
	return array(
		array( 'lieu' => 'Village de Satillieu', 'valeur' => '7 min en voiture' ),
		array( 'lieu' => 'Safari de Peaugres', 'valeur' => '20 min' ),
		array( 'lieu' => 'Annonay', 'valeur' => 'environ 15 km' ),
		array( 'lieu' => 'Vallée du Rhône', 'valeur' => '30 min' ),
		array( 'lieu' => 'Lyon', 'valeur' => 'environ 1 h' ),
		array( 'lieu' => 'Valence', 'valeur' => 'environ 1 h' ),
	);
}

/**
 * Repères du territoire cites dans les paragraphes de contexte geographique.
 */
function gf_seo_reperes_territoire() {
	return array( 'Satillieu', 'Ardèche verte', 'Annonay', 'Safari de Peaugres', 'Lalouvesc',
		'Saint-Félicien', 'lac de Devesset', 'Via Fluvia', 'vallée du Rhône' );
}

/**
 * Hebergement enrichi des donnees vivantes de GuestFlow (capacite, horaires, tarif).
 *
 * L’API est interrogee cote serveur et mise en cache 6 h. En cas d’echec, les valeurs
 * statiques ci-dessus sont utilisees : la page reste complete et exacte.
 *
 * @param string $cle « gite » ou « lodge ».
 * @return array|null
 */
function gf_seo_lodging( $cle ) {
	$lodgings = gf_seo_lodgings();
	if ( ! isset( $lodgings[ $cle ] ) ) {
		return null;
	}
	$l    = $lodgings[ $cle ];
	$live = gf_seo_guestflow_property( $l['guestflow_id'] );

	if ( $live ) {
		$l['capacite']      = $live['maxAdults'] ?? $l['capacite'];
		$l['lits_simples']  = $live['singleBeds'] ?? $l['lits_simples'];
		$l['lits_doubles']  = $live['doubleBeds'] ?? $l['lits_doubles'];
		$l['checkin']       = $live['defaultCheckIn'] ?? $l['checkin'];
		$l['checkout']      = $live['defaultCheckOut'] ?? $l['checkout'];
		if ( ! empty( $live['fromPricePerNight'] ) ) {
			$l['prix_min_nuit'] = (float) $live['fromPricePerNight'];
		}
	}
	return $l;
}

/**
 * Appel serveur a l’API publique GuestFlow, mis en cache 6 h.
 *
 * @param int $id Identifiant de propriete GuestFlow.
 * @return array|null
 */
function gf_seo_guestflow_property( $id ) {
	$cle    = 'gf_seo_property_' . (int) $id;
	$cached = get_transient( $cle );
	if ( false !== $cached ) {
		return is_array( $cached ) ? $cached : null;
	}
	if ( ! class_exists( 'GF_Api_Client' ) ) {
		return null;
	}
	$rep = GF_Api_Client::instance()->get( '/properties/' . (int) $id );
	$out = ( ! is_wp_error( $rep ) && isset( $rep['body']['data'] ) ) ? $rep['body']['data'] : null;
	// Un echec est mis en cache 15 min pour ne pas marteler l’API a chaque visite.
	set_transient( $cle, null === $out ? 'ko' : $out, null === $out ? 15 * MINUTE_IN_SECONDS : 6 * HOUR_IN_SECONDS );
	return $out;
}

/**
 * Options et ressources tarifees d’un hebergement, mises en cache 6 h.
 *
 * @param int $id Identifiant de propriete GuestFlow.
 * @return array{groupes: array, simples: array, ressources: array}
 */
function gf_seo_guestflow_tarifs( $id ) {
	$cle    = 'gf_seo_tarifs_' . (int) $id;
	$cached = get_transient( $cle );
	if ( is_array( $cached ) ) {
		return $cached;
	}
	$vide = array(
		'groupes'    => array(),
		'simples'    => array(),
		'ressources' => array(),
	);
	if ( ! class_exists( 'GF_Api_Client' ) ) {
		return $vide;
	}

	$out = $vide;
	$rep = GF_Api_Client::instance()->get( '/properties/' . (int) $id . '/options' );
	if ( ! is_wp_error( $rep ) && isset( $rep['body']['data'] ) ) {
		$d = $rep['body']['data'];
		foreach ( (array) ( $d['ungrouped'] ?? array() ) as $o ) {
			// Les options automatiques a 0 € (arrivee anticipee, depart tardif) n’ont rien a dire au lecteur.
			if ( empty( $o['price'] ) ) {
				continue;
			}
			$out['simples'][] = array(
				'titre' => $o['title'],
				'prix'  => (float) $o['price'],
				'unite' => $o['priceUnitLabel'] ?? '',
			);
		}
		foreach ( (array) ( $d['groups'] ?? array() ) as $g ) {
			$items = array();
			foreach ( (array) ( $g['options'] ?? array() ) as $o ) {
				$items[] = array(
					'titre' => $o['title'],
					'prix'  => (float) $o['price'],
					'unite' => $o['priceUnitLabel'] ?? '',
				);
			}
			if ( $items ) {
				$out['groupes'][] = array(
					'categorie' => $g['category'] ?: 'Autres options',
					'options'   => $items,
				);
			}
		}
	}

	$rep = GF_Api_Client::instance()->get( '/properties/' . (int) $id . '/resources' );
	if ( ! is_wp_error( $rep ) && isset( $rep['body']['data'] ) ) {
		foreach ( (array) $rep['body']['data'] as $r ) {
			if ( empty( $r['price'] ) ) {
				continue;
			}
			$out['ressources'][] = array(
				'titre' => $r['name'],
				'prix'  => (float) $r['price'],
				'unite' => $r['priceUnitLabel'] ?? '',
			);
		}
	}

	set_transient( $cle, $out, 6 * HOUR_IN_SECONDS );
	return $out;
}

/**
 * Purge les caches tarifaires (appelee depuis l’admin ou en ligne de commande).
 */
function gf_seo_purge_cache() {
	foreach ( array( 1, 2 ) as $id ) {
		delete_transient( 'gf_seo_property_' . $id );
		delete_transient( 'gf_seo_tarifs_' . $id );
	}
}

/**
 * Formate un prix en euros pour l’affichage (252 → « 252 € », 5.5 → « 5,50 € »).
 */
function gf_seo_prix( $valeur ) {
	$valeur = (float) $valeur;
	$dec    = ( floor( $valeur ) === $valeur ) ? 0 : 2;
	return number_format_i18n( $valeur, $dec ) . ' €';
}
