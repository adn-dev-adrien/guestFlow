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
 * La valeur d'un fait, dans la langue de la page.
 *
 * Le francais et l'anglais vivent sur la MEME ligne du MEME tableau : « saison » et
 * « saison_en » se lisent l'un sous l'autre. C'est delibere. Une seconde source de verite
 * anglaise deriverait a la premiere correction de tarif ou d'horaire faite dans l'urgence,
 * et un site bilingue qui ment dans une seule de ses langues est pire qu'un site monolingue
 * (specs/site-english-version.md regle 34).
 *
 * L'anglais manquant rend le francais, jamais une ligne vide : mieux vaut un mot francais
 * dans une page anglaise qu'un tableau troue.
 *
 * @param array  $tab    Le tableau de faits.
 * @param string $cle    La clef francaise.
 * @param string|null $langue Force la langue ; sinon celle de la page.
 * @return mixed
 */
function gf_fait( $tab, $cle, $langue = null ) {
	if ( ! is_array( $tab ) ) {
		return null;
	}
	$l = $langue ? $langue : ( function_exists( 'gf_langue' ) ? gf_langue() : 'fr' );
	if ( 'en' === $l ) {
		$en = $tab[ $cle . '_en' ] ?? null;
		if ( null !== $en && '' !== $en && array() !== $en ) {
			return $en;
		}
	}
	return $tab[ $cle ] ?? null;
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
		'animaux_ferme'    => array( 'ânes', 'chèvres', 'moutons Lacaune', 'moutons du Cameroun', 'poules', 'cochons d’Inde', 'abeilles' ),
		'essences_foret'   => array( 'chênes', 'châtaigniers', 'hêtres', 'acacias', 'pins', 'douglas' ),
		'faune_sauvage'    => array( 'chevreuils', 'renards', 'blaireaux', 'faucons crécerelles', 'milans', 'salamandres', 'chouettes' ),
		'chiens_acceptes'  => false,
		'enfants_bienvenus' => true,
		'label_cavalier'   => 'Accueil Cavalier (CDTE Drôme-Ardèche)',
		'cavalier_equipements' => array( 'pré clôturé', 'point d’eau', 'foin fourni' ),
		'cavalier_tarif'   => 10,   // Euros par cheval et par nuit.
		'bain_temperature' => 38,   // Degres Celsius, temperature de chauffe habituelle.
		'gare'             => 'Saint-Vallier-sur-Rhône',
		'transfert_gare'   => 50,   // Euros, transfert depuis la gare sur demande.
		'evenements'       => 'séminaires bienvenus ; réceptions extérieures jusqu’à 40 personnes sur devis',
		'garde_enfants'    => 'sur demande, tarif à convenir',
		// Visuel de partage : chaque page utilise sa propre image de bandeau, ce qui est plus
		// pertinent qu’un visuel unique. Ce repli ne sert que si une page n’a aucune image.
		'og_image'         => null,
	);
}

/**
 * Equipements et services communs aux deux hebergements.
 */
function gf_seo_equipements_domaine( $langue = null ) {
	$fr = array(
		'Piscine extérieure partagée, non chauffée, de mi-juin à fin août',
		'Bain nordique extérieur privatisé, par créneau d’1 h — une heure offerte à chaque séjour',
		'Barbecue et cuisine d’été',
		'Sentier de balade de 2 km sur le domaine',
		'Animaux de la ferme en accès libre',
		'Rivière de baignade à proximité',
		'Parking gratuit sur place',
	);
	// Liste plate : la correspondance se fait par le RANG, donc les deux listes se corrigent
	// ensemble ou pas du tout. Le test de parite du depot refuse qu'elles divergent en longueur.
	$en = array(
		'Shared outdoor pool, unheated, from mid-June to the end of August',
		'Private outdoor Nordic bath, in 1-hour slots — one hour free with every stay',
		'Barbecue and summer kitchen',
		'A 2 km walking path on the estate',
		'Farm animals you can walk up to',
		'A river to swim in nearby',
		'Free parking on site',
	);
	$l = $langue ? $langue : ( function_exists( 'gf_langue' ) ? gf_langue() : 'fr' );
	return 'en' === $l ? $en : $fr;
}

/**
 * Faits propres a chaque hebergement.
 *
 * Les donnees marquees « API » (capacite, horaires, tarif a partir de) sont rafraichies
 * depuis GuestFlow par gf_seo_lodging(). Les valeurs ci-dessous servent de repli.
 *
 * « equipements » est une liste de lignes, chacune faite d’une icone (`ic`, voir
 * gf-seo-icons.php), d’un intitule (`nom`) et d’une precision facultative. Cette liste
 * est la seule : elle alimente le tableau affiche par [solio_equipements], le JSON-LD
 * `amenityFeature` et /llms.txt. Un equipement absent d’ici n’existe nulle part.
 *
 * Une ligne peut porter `'visible' => false` : elle reste dans la liste, donc dans le
 * JSON-LD et dans /llms.txt, mais le tableau ne la rend pas. C’est ainsi qu’un fait deja
 * dit ailleurs sur la page — aux pastilles, dans le recit, dans la FAQ — continue d’exister
 * pour les moteurs sans etre ecrit deux fois pour le lecteur. Le tableau affiche est donc
 * toujours un sous-ensemble de cette liste, jamais une seconde liste.
 *
 * Deux regles de composition, pour qu’aucun fait ne soit ecrit deux fois sur la page :
 * les comptages (salles d’eau, toilettes) restent aux pastilles sous le bandeau et sont
 * donc invisibles ici ; les prestations (bain nordique, equipement bebe) ont quitte
 * « L’essentiel » pour cette liste, ou leur precision commerciale a sa place.
 */
function gf_seo_lodgings() {
	// Le bain nordique se raconte de la meme facon pour les deux hebergements : la phrase
	// s’ecrit ici, et sert a la fois « L’essentiel », le tableau comparatif et la ligne
	// « Bain nordique » du tableau des equipements.
	$bain    = 'sur le domaine, à quelques pas — 1 créneau d’1 h offert à chaque séjour';
	$bain_en = 'on the estate, a few steps away — one 1-hour slot free with every stay';

	return array(
		'gite'  => array(
			'cle'                  => 'gite',
			'guestflow_id'         => 1,
			'nom'                  => 'La Granja — le gîte du domaine',
			'slug'                 => 'la-granja',
			'type_schema'          => 'Accommodation',
			'label'                => 'Meublé 3 étoiles',
			'label_en'             => '3-star rated holiday home',
			'capacite'             => 10,          // API maxAdults
			'capacite_max'         => 12,          // Couchages d’appoint compris.
			'capacite_note'        => 'davantage possible sur demande',
			'capacite_note_en'     => 'more possible on request',
			'chambres'             => 4,
			'lits_doubles'         => 4,
			'lits_simples'         => 5,
			'salles_eau'           => 2,
			'toilettes'            => 2,
			'superficie_m2'        => 180,         // 60 m² par niveau, sur trois niveaux.
			'superficie_detail'    => '180 m² sur trois niveaux, soit 60 m² par niveau',
			'superficie_detail_en' => '180 m² over three floors, 60 m² per floor',
			'saison'               => 'ouvert toute l’année',
			'saison_en'            => 'open all year round',
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
			'accessible_pmr_note_en' => 'not suitable for guests with reduced mobility — a house over three floors',

			'caution'              => 500,
			'bain_nordique'        => $bain,
			'bain_nordique_en'     => $bain_en,
			'equipements'          => array(
				array( 'ic' => 'kitchen', 'nom' => 'Cuisine des tribus',
					'nom_en' => 'A kitchen built for a crowd',
					'precision' => 'four, lave-vaisselle, très grand réfrigérateur, cafetière, ustensiles',
					'precision_en' => 'oven, dishwasher, very large fridge, coffee maker, utensils' ),
				array( 'ic' => 'bbq', 'nom' => 'Barbecue et cuisine d’été',
					'nom_en' => 'Barbecue and summer kitchen',
					'precision' => 'grand barbecue avec évier',
					'precision_en' => 'a large barbecue with its own sink' ),
				array( 'ic' => 'washer', 'nom' => 'Machine à laver',
					'nom_en' => 'Washing machine',
					'precision' => 'fer et planche à repasser, sèche-cheveux',
					'precision_en' => 'iron and ironing board, hairdryer' ),
				array( 'ic' => 'bed', 'nom' => 'Lits faits à l’arrivée',
					'nom_en' => 'Beds made up on arrival',
					'precision' => 'draps de lit fournis',
					'precision_en' => 'bed linen provided' ),
				array( 'ic' => 'wifi', 'nom' => 'Wifi gratuit', 'nom_en' => 'Free wifi', 'precision' => null ),
				array( 'ic' => 'baby', 'nom' => 'Équipement bébé',
					'nom_en' => 'Baby equipment',
					'precision' => 'complet, sur demande',
					'precision_en' => 'a full set, on request' ),
				array( 'ic' => 'safety', 'nom' => 'Sécurité',
					'nom_en' => 'Safety',
					'precision' => 'détecteurs fumée et CO, extincteur, trousse de premiers secours',
					'precision_en' => 'smoke and CO alarms, fire extinguisher, first-aid kit' ),
				array( 'ic' => 'hottub', 'nom' => 'Bain nordique', 'nom_en' => 'Nordic bath',
					'precision' => $bain, 'precision_en' => $bain_en ),
				array( 'ic' => 'pool', 'nom' => 'Piscine extérieure partagée',
					'nom_en' => 'Shared outdoor pool',
					'precision' => 'non chauffée, de mi-juin à fin août',
					'precision_en' => 'unheated, from mid-June to the end of August' ),

				// Ces cinq-la sont racontes ailleurs dans la page — le recit, la FAQ, les
				// photos — et n’ont pas a etre redits en liste. Ils restent publies.
				array( 'ic' => null, 'nom' => 'Poêle à bois', 'nom_en' => 'Wood-burning stove',
					'precision' => 'bois fourni', 'precision_en' => 'firewood provided', 'visible' => false ),
				array( 'ic' => null, 'nom' => 'Grande pièce de vie et tablée de 10 à 12 couverts',
					'nom_en' => 'A large living room and a table seating 10 to 12',
					'precision' => null, 'visible' => false ),
				array( 'ic' => null, 'nom' => 'Terrasse exposée au soleil levant',
					'nom_en' => 'Terrace facing the rising sun',
					'precision' => 'vue sur les montagnes',
					'precision_en' => 'looking out over the mountains', 'visible' => false ),
				array( 'ic' => null, 'nom' => 'Salle de jeux dans les combles',
					'nom_en' => 'Games room in the attic',
					'precision' => null, 'visible' => false ),
				array( 'ic' => null, 'nom' => 'Entièrement rénové',
					'nom_en' => 'Fully renovated',
					'precision' => 'isolation en laine de bois',
					'precision_en' => 'insulated with wood fibre', 'visible' => false ),
			),
		),
		'lodge' => array(
			'cle'                  => 'lodge',
			'guestflow_id'         => 2,
			'nom'                  => 'L’Estiva — la tente safari',
			'slug'                 => 'estiva',
			'type_schema'          => 'Campground',
			'label'                => null,
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
			'superficie_detail_en' => '24 m² under canvas, plus a 50 m² deck holding the shower room and the toilet',
			'terrasse_m2'          => 50,
			'saison'               => 'ouvert du 1er avril au 14 octobre',
			'saison_en'            => 'open from 1 April to 14 October',
			'checkin'              => '16:00',
			'checkin_fin'          => '19:00',
			'checkout'             => '10:00',
			'prix_min_nuit'        => 110,
			'wifi'                 => false,
			'non_fumeur'           => true,
			'accessible_pmr'       => false,
			'accessible_pmr_note'  => 'non adapté aux personnes à mobilité réduite — accès nature à pied sur 300 m',
			'accessible_pmr_note_en' => 'not suitable for guests with reduced mobility — a 300 m walk on natural ground',

			'caution'              => 400,
			'bain_nordique'        => $bain,
			'bain_nordique_en'     => $bain_en,
			'equipements'          => array(
				array( 'ic' => 'kitchen', 'nom' => 'Kitchenette équipée',
					'nom_en' => 'Fitted kitchenette',
					'precision' => 'plaque de cuisson, micro-ondes, réfrigérateur, cafetière',
					'precision_en' => 'hob, microwave, fridge, coffee maker' ),
				array( 'ic' => 'bbq', 'nom' => 'Plancha à disposition',
					'nom_en' => 'Plancha griddle at your disposal', 'precision' => null ),
				array( 'ic' => 'bed', 'nom' => 'Lits faits à l’arrivée',
					'nom_en' => 'Beds made up on arrival',
					'precision' => 'couettes et couvertures supplémentaires',
					'precision_en' => 'duvets and extra blankets' ),
				array( 'ic' => 'power', 'nom' => 'Eau chaude et électricité',
					'nom_en' => 'Hot water and electricity',
					'precision' => 'tout le confort, sous la toile',
					'precision_en' => 'every comfort, under canvas' ),
				array( 'ic' => 'terrace', 'nom' => 'Terrasse privée',
					'nom_en' => 'Private deck',
					'precision' => 'coucher de soleil et animaux en liberté',
					'precision_en' => 'the sunset, and the animals roaming free' ),
				array( 'ic' => 'hottub', 'nom' => 'Bain nordique', 'nom_en' => 'Nordic bath',
					'precision' => $bain, 'precision_en' => $bain_en ),
				array( 'ic' => 'pool', 'nom' => 'Piscine extérieure partagée',
					'nom_en' => 'Shared outdoor pool',
					'precision' => 'non chauffée, de mi-juin à fin août',
					'precision_en' => 'unheated, from mid-June to the end of August' ),
				array( 'ic' => 'parking', 'nom' => 'Parking gratuit sur place',
					'nom_en' => 'Free parking on site',
					'precision' => 'accès à pied, 300 m',
					'precision_en' => 'then a 300 m walk' ),

				// Dits ailleurs : la tente et son ciel dans le recit, les sanitaires aux
				// pastilles, le wifi dans « L’essentiel ».
				array( 'ic' => null, 'nom' => 'Tente safari sur terrasse bois montée sur pilotis',
					'nom_en' => 'Safari tent on a raised wooden deck',
					'precision' => null, 'visible' => false ),
				array( 'ic' => null, 'nom' => 'Ciel étoilé sans pollution lumineuse',
					'nom_en' => 'A starry sky, with no light pollution',
					'precision' => null, 'visible' => false ),
				array( 'ic' => null, 'nom' => 'Salle d’eau et toilettes privatives',
					'nom_en' => 'Private shower room and toilet',
					'precision' => null, 'visible' => false ),
				array( 'ic' => null, 'nom' => 'Pas de wifi', 'nom_en' => 'No wifi',
					'precision' => null, 'visible' => false ),
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
				'q_en' => 'How many people does the gîte sleep?',
				'r' => 'Dix personnes confortablement, douze avec les couchages d’appoint. Quatre chambres sur trois niveaux, 2 salles d’eau et 2 toilettes.',
				'r_en' => 'Ten comfortably, twelve using the extra beds. Four bedrooms over three floors, 2 shower rooms and 2 toilets.' ),
			array( 'q' => 'Le gîte accepte-t-il les chiens ?',
				'q_en' => 'Does the gîte accept dogs?',
				'r' => 'Non. Nos ânes, chèvres et moutons vivent en liberté et les enfants entrent dans les enclos : la cohabitation n’est pas possible. Bébés et enfants, eux, sont les bienvenus.',
				'r_en' => 'No. Our donkeys, goats and sheep roam free and children go into the enclosures: the two cannot mix. Babies and children, on the other hand, are very welcome.' ),
			array( 'q' => 'Y a-t-il le wifi au gîte ?',
				'q_en' => 'Is there wifi at the gîte?',
				'r' => 'Oui, gratuit. C’est le seul des deux hébergements à en être équipé.',
				'r_en' => 'Yes, free of charge. It is the only one of the two places to have it.' ),
			array( 'q' => 'À quelle heure arrive-t-on et repart-on ?',
				'q_en' => 'What time is check-in and check-out?',
				'r' => 'Arrivée entre 16h et 19h, départ avant 10h. Le gîte est non-fumeur.',
				'r_en' => 'Arrival between 4pm and 7pm, departure before 10am. The gîte is non-smoking.' ),
			array( 'q' => 'Le bain nordique est-il privatif ?',
				'q_en' => 'Is the Nordic bath private?',
				'r' => 'Oui, entièrement : le bain se trouve sur le domaine, à quelques pas, et se réserve par créneau d’1 h. Un créneau est offert à chaque séjour ; les suivants sont à partir de 30 € l’heure.',
				'r_en' => 'Entirely: the bath sits on the estate, a few steps away, and is booked in 1-hour slots. One slot is free with every stay; further slots start at €30 an hour.' ),
			array( 'q' => 'Peut-on venir en hiver ?',
				'q_en' => 'Can we come in winter?',
				'r' => 'Oui, le gîte est ouvert toute l’année, isolé en laine de bois et chauffé au poêle. La piscine, elle, ouvre de mi-juin à fin août.',
				'r_en' => 'Yes, the gîte is open all year round, insulated with wood fibre and heated by a wood-burning stove. The pool, though, opens from mid-June to the end of August.' ),
			array( 'q' => 'La piscine est-elle privée ?',
				'q_en' => 'Is the pool private?',
				'r' => 'Non, elle est partagée avec la tente safari — soit deux hébergements sur 13 hectares. Non chauffée, ouverte de mi-juin à fin août.',
				'r_en' => 'No, it is shared with the safari tent — two places to stay across 13 hectares. Unheated, open from mid-June to the end of August.' ),
			array( 'q' => 'Les draps sont-ils fournis ?',
				'q_en' => 'Is bed linen provided?',
				'r' => 'Oui, les lits sont faits à votre arrivée. Le linge de toilette est en option, à 8 € par personne.',
				'r_en' => 'Yes, the beds are made up before you arrive. Towels are an option, at €8 per person.' ),
			array( 'q' => 'Y a-t-il de quoi occuper les enfants ?',
				'q_en' => 'Is there anything to keep children busy?',
				'r' => 'Une salle de jeux dans les combles, et surtout les animaux, que les enfants nourrissent eux-mêmes. Des animations sont proposées, de la chasse au trésor à la balade nocturne.',
				'r_en' => 'A games room in the attic, and above all the animals, which the children feed themselves. Activities are on offer, from a treasure hunt to a night walk.' ),
			array( 'q' => 'Combien coûte une nuit ?',
				'q_en' => 'How much is a night?',
				'r' => 'À partir de %prix%, dégressif dès 3 nuits. Le prix exact s’affiche dès que vous choisissez vos dates.',
				'r_en' => 'From %prix%, with a lower rate from 3 nights. The exact price appears as soon as you choose your dates.' ),
		),

		'lodge' => array(
			array( 'q' => 'Combien de personnes peut accueillir la tente safari ?',
				'q_en' => 'How many people does the safari tent sleep?',
				'r' => 'Cinq personnes, en 2 chambres — un lit double et 3 lits simples — avec salle d’eau et toilettes privatives.',
				'r_en' => 'Five, in 2 bedrooms — one double bed and 3 single beds — with a private shower room and toilet.' ),
			array( 'q' => 'Y a-t-il le wifi ?',
				'q_en' => 'Is there wifi?',
				'r' => 'Non, et c’est un choix. On vient ici pour décrocher : pas de wifi, pas de pollution lumineuse. Le wifi reste disponible au gîte.',
				'r_en' => 'No, and that is deliberate. You come here to switch off: no wifi, no light pollution. Wifi is still available at the gîte.' ),
			array( 'q' => 'Est-ce confortable, de dormir sous une tente ?',
				'q_en' => 'Is sleeping under canvas comfortable?',
				'r' => 'C’est le confort d’une chambre d’hôtel avec les sensations du camping : vrais lits, salle d’eau privative, eau chaude et électricité, sur une terrasse en bois.',
				'r_en' => 'It is the comfort of a hotel room with the feel of camping: real beds, a private shower room, hot water and electricity, on a wooden deck.' ),
			array( 'q' => 'Peut-on cuisiner ?',
				'q_en' => 'Can we cook?',
				'r' => 'Une kitchenette avec plaque, micro-ondes et réfrigérateur. On cuisine surtout dehors : la plancha est à disposition à chaque séjour.',
				'r_en' => 'There is a kitchenette with a hob, microwave and fridge. Most of the cooking happens outside: the plancha griddle is there for every stay.' ),
			array( 'q' => 'Y a-t-il des voisins ?',
				'q_en' => 'Are there neighbours?',
				'r' => 'Oui, mais à 150 mètres, et sans vis-à-vis — les photos aériennes le montrent bien. Vous aurez vraiment le sentiment d’être seul au monde. La tente est installée dans l’enclos des chèvres et des moutons.',
				'r_en' => 'Yes, but 150 metres away and out of sight — the aerial photographs show it well. You will genuinely feel alone in the world. The tent stands inside the goat and sheep enclosure.' ),
			array( 'q' => 'Quelle est la caution ?',
				'q_en' => 'How much is the deposit?',
				'r' => '400 €, non encaissée et restituée après le séjour.',
				'r_en' => '€400, not cashed and returned after your stay.' ),
			array( 'q' => 'À quelle heure arrive-t-on et repart-on ?',
				'q_en' => 'What time is check-in and check-out?',
				'r' => 'Arrivée entre 16h et 19h, départ avant 10h. Parking gratuit, puis 300 mètres à pied : le lodge n’est pas accessible en fauteuil roulant.',
				'r_en' => 'Arrival between 4pm and 7pm, departure before 10am. Free parking, then a 300-metre walk: the lodge is not wheelchair accessible.' ),
			array( 'q' => 'Le bain nordique est-il inclus ?',
				'q_en' => 'Is the Nordic bath included?',
				'r' => 'Oui, une heure par séjour vous est offerte. Le bain se trouve sur le domaine, à quelques pas de la tente, privatisé le temps de votre créneau ; les suivants sont à partir de 30 € l’heure.',
				'r_en' => 'Yes, one hour per stay is free. The bath sits on the estate, a few steps from the tent, yours alone for your slot; further slots start at €30 an hour.' ),
			array( 'q' => 'Les chiens sont-ils acceptés ?',
				'q_en' => 'Are dogs allowed?',
				'r' => 'Non : la tente est installée au milieu d’un enclos où vivent chèvres et moutons. Les enfants, eux, sont les bienvenus.',
				'r_en' => 'No: the tent stands in the middle of an enclosure where goats and sheep live. Children, on the other hand, are very welcome.' ),
			array( 'q' => 'La tente est-elle ouverte en hiver ?',
				'q_en' => 'Is the tent open in winter?',
				'r' => 'Non, elle se loue du 1er avril au 14 octobre. Hors saison, les nuits ardéchoises sont trop fraîches sous la toile — La Granja, elle, est ouverte toute l’année.',
				'r_en' => 'No, it is let from 1 April to 14 October. Out of season the Ardèche nights are too cold under canvas — La Granja, though, is open all year round.' ),
			array( 'q' => 'Combien coûte une nuit ?',
				'q_en' => 'How much is a night?',
				'r' => 'À partir de %prix%, dégressif selon la durée. Le prix exact s’affiche dès que vous choisissez vos dates.',
				'r_en' => 'From %prix%, with a lower rate the longer you stay. The exact price appears as soon as you choose your dates.' ),
		),

		'domaine' => array(
			array( 'q' => 'Quelle est la superficie du domaine ?',
				'q_en' => 'How big is the estate?',
				'r' => '13 hectares de prairie et de forêt, avec une boucle de balade de 2 km entièrement sur la propriété.',
				'r_en' => '13 hectares of meadow and woodland, with a 2 km walking loop entirely on the property.' ),
			array( 'q' => 'Quels animaux vivent sur le domaine ?',
				'q_en' => 'Which animals live on the estate?',
				'r' => 'Des ânes, des chèvres, des moutons Lacaune et du Cameroun, des poules, des cochons d’Inde — et des ruches en lisière. Les enfants entrent dans les enclos pour les approcher et les nourrir.',
				'r_en' => 'Donkeys, goats, Lacaune and Cameroon sheep, hens, guinea pigs — and beehives along the edge of the wood. Children go into the enclosures to meet them and feed them.' ),
			array( 'q' => 'Peut-on s’y promener librement ?',
				'q_en' => 'Can we walk wherever we like?',
				'r' => 'Oui, les 13 hectares sont ouverts à nos hôtes. Le sentier traverse la prairie puis la forêt de chênes, châtaigniers, hêtres et douglas.',
				'r_en' => 'Yes, all 13 hectares are open to our guests. The path crosses the meadow, then the woodland of oak, chestnut, beech and Douglas fir.' ),
			array( 'q' => 'Y a-t-il de la faune sauvage ?',
				'q_en' => 'Is there wildlife?',
				'r' => 'Chevreuils, renards, blaireaux, faucons crécerelles, milans, salamandres, chouettes… La faune est préservée, et nous ne promettons aucune observation : c’est la nature, elle se montre quand elle veut.',
				'r_en' => 'Roe deer, foxes, badgers, kestrels, kites, salamanders, owls… The wildlife is left undisturbed, and we promise no sighting: this is nature, it shows itself when it chooses.' ),
			array( 'q' => 'La piscine est-elle chauffée ?',
				'q_en' => 'Is the pool heated?',
				'r' => 'Non, et elle ouvre de mi-juin à fin août. Une rivière de baignade se trouve à quelques minutes.',
				'r_en' => 'No, and it opens from mid-June to the end of August. A river to swim in is a few minutes away.' ),
			array( 'q' => 'Accueillez-vous les cavaliers ?',
				'q_en' => 'Do you welcome riders and their horses?',
				'r' => 'Oui, le domaine est labellisé Accueil Cavalier. Pré clôturé, point d’eau et foin fourni, 10 € par cheval et par nuit ; pas de box.',
				'r_en' => 'Yes, the estate holds the Accueil Cavalier label. Fenced paddock, water point and hay provided, €10 per horse per night; no stables.' ),
		),

		'bain-nordique' => array(
			array( 'q' => 'Le bain nordique est-il privatif ?',
				'q_en' => 'Is the Nordic bath private?',
				'r' => 'Oui, entièrement : un créneau d’1 h rien que pour vous.',
				'r_en' => 'Entirely: a 1-hour slot for you alone.' ),
			array( 'q' => 'Est-il inclus dans le séjour ?',
				'q_en' => 'Is it included in the stay?',
				'r' => 'Oui : un créneau d’1 h est offert à chaque séjour, dans les deux hébergements. Les créneaux suivants se réservent à partir de 30 € l’heure.',
				'r_en' => 'Yes: one 1-hour slot is free with every stay, in both places. Further slots can be booked from €30 an hour.' ),
			array( 'q' => 'Les enfants peuvent-ils y aller ?',
				'q_en' => 'Can children use it?',
				'r' => 'À 38 °C, il est pensé pour les adultes. Mais si vous nous demandez une eau plus douce, les enfants peuvent en profiter avec vous.',
				'r_en' => 'At 38°C it is meant for adults. But ask us for gentler water and the children can enjoy it with you.' ),
			array( 'q' => 'À quelle température est l’eau ?',
				'q_en' => 'How warm is the water?',
				'r' => 'Autour de 38 °C : assez chaude pour savourer l’heure entière, sans être éprouvante.',
				'r_en' => 'Around 38°C: warm enough to enjoy the full hour, without being punishing.' ),
			array( 'q' => 'La séance est-elle garantie ?',
				'q_en' => 'Is the session guaranteed?',
				'r' => 'Non, elle dépend des conditions climatiques et techniques. Elle ne donne droit à aucun remboursement, mais nous cherchons toujours à la reprogrammer.',
				'r_en' => 'No, it depends on the weather and on technical conditions. It carries no right to a refund, but we always try to rebook it.' ),
			array( 'q' => 'Peut-on l’utiliser en hiver ?',
				'q_en' => 'Can we use it in winter?',
				'r' => 'Oui, toute l’année — et c’est la plus belle saison : l’eau chaude, l’air froid, le ciel étoilé.',
				'r_en' => 'Yes, all year round — and it is the finest season for it: hot water, cold air, a sky full of stars.' ),
		),

		'privatisation' => array(
			array( 'q' => 'Combien de personnes en privatisant ?',
				'q_en' => 'How many people when the whole estate is ours?',
				'r' => '15 personnes, jusqu’à 20 sur demande. Vous êtes alors seuls sur les 13 hectares.',
				'r_en' => '15 people, up to 20 on request. You then have the 13 hectares to yourselves.' ),
			array( 'q' => 'Qu’est-ce que cela comprend ?',
				'q_en' => 'What does that include?',
				'r' => 'Les deux hébergements, donc tout le domaine : prairie, forêt, sentier, piscine en saison, bain nordique et animaux.',
				'r_en' => 'Both places to stay, and therefore the whole estate: meadow, woodland, path, the pool in season, the Nordic bath and the animals.' ),
			array( 'q' => 'À quelle période ?',
				'q_en' => 'At what time of year?',
				'r' => 'Du 1er avril au 14 octobre, le lodge fermant hors saison. Le reste de l’année, le gîte seul reste disponible.',
				'r_en' => 'From 1 April to 14 October, as the lodge closes out of season. The rest of the year, the gîte alone remains available.' ),
			array( 'q' => 'Peut-on organiser un mariage ou un séminaire ?',
				'q_en' => 'Can we hold a wedding or a seminar?',
				'r' => 'Les séminaires sont les bienvenus. Pour les mariages, nous ne sommes pas encore calibrés — mais en extérieur, nous pouvons accueillir jusqu’à 40 personnes, sur demande et sur devis : parlez-nous de votre projet.',
				'r_en' => 'Seminars are very welcome. For weddings we are not set up yet — but outdoors we can host up to 40 people, on request and by quotation: tell us about your plans.' ),
			array( 'q' => 'Proposez-vous des prestations pour les groupes ?',
				'q_en' => 'Do you offer anything for groups?',
				'r' => 'Petit-déjeuner, planches apéro jusqu’à 12 personnes, repas des trappeurs, animations enfants… Écrivez-nous : on compose le séjour ensemble.',
				'r_en' => 'Breakfast, sharing boards for up to 12, the trappers’ meal, children’s activities… Write to us: we put the stay together with you.' ),
		),

		'enfants' => array(
			array( 'q' => 'Le domaine convient-il aux jeunes enfants ?',
				'q_en' => 'Does the estate suit young children?',
				'r' => 'Oui : les enfants entrent dans les enclos, le gîte a une salle de jeux, une chaise haute et un lit bébé, et le domaine est sans circulation.',
				'r_en' => 'Yes: children go into the enclosures, the gîte has a games room, a high chair and a cot, and there is no traffic on the estate.' ),
			array( 'q' => 'Quelles animations proposez-vous ?',
				'q_en' => 'What activities do you offer?',
				'r' => 'Chasse aux œufs, visite des animaux, découverte de la faune sauvage et balade nocturne — elles se réservent en même temps que le séjour.',
				'r_en' => 'Egg hunt, meeting the animals, discovering the wildlife and a night walk — they are booked at the same time as the stay.' ),
			array( 'q' => 'Proposez-vous une garde d’enfants ?',
				'q_en' => 'Do you offer childcare?',
				'r' => 'Oui, sur demande et à organiser à l’avance ; le tarif se convient ensemble selon la durée.',
				'r_en' => 'Yes, on request and arranged in advance; the rate is agreed together, depending on how long you need.' ),
			array( 'q' => 'Que faire avec des enfants autour du domaine ?',
				'q_en' => 'What is there to do with children around the estate?',
				'r' => 'Le Safari de Peaugres à 20 minutes, le lac de Devesset pour la baignade, et la Via Fluvia, plate et praticable à vélo avec de jeunes enfants.',
				'r_en' => 'Peaugres Safari Park 20 minutes away, Lake Devesset for swimming, and the Via Fluvia, flat and easy to cycle with young children.' ),
			array( 'q' => 'Le bain nordique leur est-il accessible ?',
				'q_en' => 'Can they use the Nordic bath?',
				'r' => 'À 38 °C, il est pensé pour les adultes — demandez-nous une eau plus douce et ils peuvent en profiter avec vous. La piscine, elle, est à eux de mi-juin à fin août.',
				'r_en' => 'At 38°C it is meant for adults — ask us for gentler water and they can enjoy it with you. The pool, though, is theirs from mid-June to the end of August.' ),
			array( 'q' => 'Faut-il apporter le matériel de bébé ?',
				'q_en' => 'Do we need to bring baby equipment?',
				'r' => 'Non : lit bébé sans supplément et chaise haute au gîte. Prévenez-nous, tout est prêt à votre arrivée.',
				'r_en' => 'No: a cot at no extra charge and a high chair at the gîte. Let us know, and everything is ready when you arrive.' ),
		),

		'acces' => array(
			array( 'q' => 'Quelle est l’adresse exacte ?',
				'q_en' => 'What is the exact address?',
				'r' => '215 côte de Japperenard, 07290 Satillieu. Réglez votre GPS sur 45.1615892, 4.6299588 plutôt que sur le nom de la commune.',
				'r_en' => '215 côte de Japperenard, 07290 Satillieu. Set your sat-nav to 45.1615892, 4.6299588 rather than to the name of the village.' ),
			array( 'q' => 'Combien de temps depuis Lyon ou Valence ?',
				'q_en' => 'How long from Lyon or Valence?',
				'r' => 'Environ une heure depuis l’une comme depuis l’autre. La vallée du Rhône est à 30 minutes, Annonay à 15 km.',
				'r_en' => 'About an hour from either. The Rhône valley is 30 minutes away, Annonay 15 km.' ),
			array( 'q' => 'Y a-t-il des commerces à proximité ?',
				'q_en' => 'Are there shops nearby?',
				'r' => 'Satillieu et ses commerces sont à 7 minutes en voiture.',
				'r_en' => 'Satillieu and its shops are 7 minutes away by car.' ),
			array( 'q' => 'Où se garer ?',
				'q_en' => 'Where do we park?',
				'r' => 'Parking gratuit sur place. Pour le lodge, comptez ensuite 300 mètres à pied : prévoyez un sac plutôt qu’une valise à roulettes.',
				'r_en' => 'Free parking on site. For the lodge, allow a 300-metre walk afterwards: bring a bag rather than a wheeled suitcase.' ),
			array( 'q' => 'Peut-on venir en train ?',
				'q_en' => 'Can we come by train?',
				'r' => 'La gare la plus proche est Saint-Vallier-sur-Rhône. Nous pouvons vous y chercher sur demande, pour 50 €. Sans voiture, les sorties alentour restent limitées.',
				'r_en' => 'The nearest station is Saint-Vallier-sur-Rhône. We can collect you from there on request, for €50. Without a car, getting out and about is limited.' ),
			array( 'q' => 'À quelle heure peut-on arriver ?',
				'q_en' => 'What time can we arrive?',
				'r' => 'Entre 16h et 19h, départ avant 10h. La route de montagne se fait mieux de jour.',
				'r_en' => 'Between 4pm and 7pm, departure before 10am. The mountain road is easier in daylight.' ),
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
