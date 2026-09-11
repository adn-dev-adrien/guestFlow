<?php
/**
 * gf-seo-reservation.php — Reservation en tiroir lateral, en deux etapes (refonte 2026-09).
 *
 * Le moteur de reservation est ouvert par un bouton flottant en bas a droite, dans un tiroir
 * venant de la droite, et decoupe en deux ecrans qui defilent horizontalement :
 *
 *   1. Votre séjour   dates, voyageurs et options — le total se met a jour en direct
 *   2. Récapitulatif  le recapitulatif chiffre et les coordonnees
 *
 * Le bouton flottant affiche le prix « des X €/nuit » lu dans les faits.
 *
 * Point important : les blocs du moteur GuestFlow ne sont ni copies ni reconstruits, ils sont
 * simplement DEPLACES dans les deux ecrans. Les gestionnaires d’evenements et l’etat interne
 * du moteur restent donc intacts — c’est ce qui garantit qu’un visiteur revenu sur les dates
 * retrouve exactement les options qu’il avait cochees.
 *
 * Deux precautions :
 *   - le tiroir n’est jamais en display:none, seulement decale hors ecran, sinon le calendrier
 *     se positionne mal a l’initialisation ;
 *   - il porte l’attribut inert tant qu’il est ferme, pour rester hors du parcours clavier.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Vrai si la page courante porte un moteur de reservation.
 */
function gf_resa_page_concernee() {
	$conf = function_exists( 'gf_seo_current_config' ) ? gf_seo_current_config() : null;
	return ! empty( $conf['lodging'] );
}

/**
 * Deplace le bloc de reservation dans le tiroir.
 */
add_filter(
	'render_block',
	function ( $contenu, $bloc ) {
		if ( is_admin() || 'guestflow/booking' !== ( $bloc['blockName'] ?? '' ) ) {
			return $contenu;
		}
		// Retour de la page de paiement Qonto (?gf_payment=…) : le moteur affiche sa vue de
		// confirmation, qui doit vivre dans la page — pas dans un tiroir fermé et invisible.
		if ( isset( $_GET['gf_payment'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return '<div class="gf-resa-retour">' . $contenu . '</div>';
		}
		$conf  = function_exists( 'gf_seo_current_config' ) ? gf_seo_current_config() : null;
		$l     = ! empty( $conf['lodging'] ) ? gf_seo_lodging( $conf['lodging'] ) : null;
		$titre = $l ? $l['nom'] : 'Votre séjour';

		$etapes = array(
			array( 'Votre séjour', 'Dates, voyageurs et options — le total se met à jour en direct.' ),
			array( 'Récapitulatif', 'Vérifiez votre séjour et laissez-nous vos coordonnées : nous répondons en direct, sans intermédiaire.' ),
		);
		$prix = ( $l && ! empty( $l['prix_min_nuit'] ) )
			? '<em class="gf-resa-prix">dès ' . esc_html( $l['prix_min_nuit'] ) . ' € / nuit</em>'
			: '';

		ob_start();
		?>
<div class="gf-resa" data-ouvert="0" data-etape="1">
	<button type="button" class="gf-resa-declencheur" aria-expanded="false" aria-controls="gf-resa-panneau">
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
			stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
			<rect x="3" y="4.5" width="18" height="16" rx="2.5" />
			<path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
		</svg>
		<span>Réserver<?php echo $prix; // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
	</button>

	<div class="gf-resa-fond" aria-hidden="true"></div>

	<aside class="gf-resa-panneau" id="gf-resa-panneau" role="dialog" aria-modal="true"
		aria-labelledby="gf-resa-titre" inert>

		<header class="gf-resa-entete">
			<h2 id="gf-resa-titre"><?php echo esc_html( $titre ); ?></h2>
			<button type="button" class="gf-resa-fermer" aria-label="Fermer">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
					stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" /></svg>
			</button>
		</header>

		<ol class="gf-resa-fil">
			<?php foreach ( $etapes as $i => $e ) : ?>
				<li data-etape="<?php echo esc_attr( $i + 1 ); ?>">
					<span class="gf-resa-fil-num"><?php echo esc_html( $i + 1 ); ?></span>
					<span class="gf-resa-fil-nom"><?php echo esc_html( $e[0] ); ?></span>
				</li>
			<?php endforeach; ?>
		</ol>

		<div class="gf-resa-corps">
			<div class="gf-resa-piste">
				<?php foreach ( $etapes as $i => $e ) : ?>
					<section class="gf-resa-etape" data-etape="<?php echo esc_attr( $i + 1 ); ?>"
						aria-label="<?php echo esc_attr( $e[0] ); ?>">
						<p class="gf-resa-consigne"><?php echo esc_html( $e[1] ); ?></p>
					</section>
				<?php endforeach; ?>
			</div>
			<?php echo $contenu; // phpcs:ignore WordPress.Security.EscapeOutput -- rendu du bloc GuestFlow. ?>
		</div>

		<nav class="gf-resa-nav" aria-label="Étapes de la réservation">
			<button type="button" class="gf-resa-precedent" hidden>
				<span aria-hidden="true">←</span> Retour
			</button>
			<button type="button" class="gf-resa-suivant" disabled>
				Suivant <span aria-hidden="true">→</span>
			</button>
			<button type="button" class="gf-resa-valider" hidden disabled>Réserver</button>
		</nav>
	</aside>
</div>
		<?php
		return ob_get_clean();
	},
	5,
	2
);

/**
 * Styles et comportement du tiroir.
 */
add_action(
	'wp_enqueue_scripts',
	function () {
		if ( ! gf_resa_page_concernee() ) {
			return;
		}

		$css = <<<'CSS'
/* ---------- Vue de retour de paiement (dans la page) ---------- */
.gf-resa-retour { max-width: 640px; margin: 40px auto; padding: 0 22px; }

/* ---------- Bouton flottant ---------- */
.gf-resa-declencheur {
	position: fixed; right: 22px; bottom: 22px; z-index: 1500;
	display: inline-flex; align-items: center; gap: 9px;
	padding: 13px 22px; border: 0; border-radius: 4px;
	background: #B87B2A; color: #fff;
	font: 700 .82rem/1.2 Karla, Helvetica, Arial, sans-serif;
	text-transform: uppercase; letter-spacing: .16em;
	cursor: pointer; box-shadow: 0 8px 26px rgba(47,58,38,.34);
	transition: background .2s ease, transform .2s ease, opacity .2s ease;
}
.gf-resa-prix { display: block; font-style: normal; font-weight: 400; font-size: .68rem;
	letter-spacing: .06em; text-transform: none; opacity: .92; margin-top: 3px; }
.gf-resa-declencheur:hover { background: #9A6318; transform: translateY(-2px); }
.gf-resa-declencheur:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
.gf-resa[data-ouvert="1"] .gf-resa-declencheur { opacity: 0; pointer-events: none; }

/* ---------- Fond et panneau ---------- */
.gf-resa-fond {
	position: fixed; inset: 0; z-index: 1600;
	background: rgba(24,30,20,.5); opacity: 0; pointer-events: none; transition: opacity .28s ease;
}
.gf-resa[data-ouvert="1"] .gf-resa-fond { opacity: 1; pointer-events: auto; }

.gf-resa-panneau {
	position: fixed; top: 0; right: 0; z-index: 1700;
	width: min(560px, 100%); height: 100dvh;
	display: flex; flex-direction: column; overflow: hidden;
	background: #FDFAF3; box-shadow: -12px 0 40px rgba(0,0,0,.22);
	transform: translateX(101%); transition: transform .3s cubic-bezier(.22,.61,.36,1);
	overscroll-behavior: contain;
}
.gf-resa[data-ouvert="1"] .gf-resa-panneau { transform: translateX(0); }

/* ---------- En-tete ---------- */
.gf-resa-entete {
	flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px;
	padding: 16px 20px; border-bottom: 1px solid #eef0ea;
}
.gf-resa-entete h2 {
	margin: 0; font-family: Marcellus, Georgia, serif; font-size: 1.15rem; line-height: 1.3;
	color: #2E3B2A; font-weight: 400; text-transform: uppercase; letter-spacing: .05em;
	overflow-wrap: anywhere;
}
.gf-resa-fermer {
	flex: 0 0 auto; width: 40px; height: 40px; display: grid; place-items: center;
	border: 1px solid #e5e8df; border-radius: 10px; background: #fff; color: #2f3a26; cursor: pointer;
}
.gf-resa-fermer:hover { background: #f4f6f0; }
.gf-resa-fermer:focus-visible { outline: 2px solid #5a6b48; outline-offset: 2px; }

/* ---------- Fil des etapes ---------- */
.gf-resa-fil {
	flex: 0 0 auto; display: flex; gap: 6px; list-style: none;
	margin: 0; padding: 12px 20px; border-bottom: 1px solid #eef0ea; background: #fafbf8;
}
.gf-resa-fil li {
	flex: 1 1 0; display: flex; align-items: center; gap: 7px;
	font-size: .82rem; color: #9aa392; min-width: 0;
}
.gf-resa-fil-num {
	flex: 0 0 auto; width: 22px; height: 22px; display: grid; place-items: center;
	border-radius: 999px; background: #e5e8df; color: #7d8a6f;
	font-size: .76rem; font-weight: 700; transition: background .2s ease, color .2s ease;
}
.gf-resa-fil-nom { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gf-resa[data-etape="1"] .gf-resa-fil li[data-etape="1"],
.gf-resa[data-etape="2"] .gf-resa-fil li[data-etape="2"] { color: #2f3a26; font-weight: 600; }
.gf-resa[data-etape="1"] .gf-resa-fil li[data-etape="1"] .gf-resa-fil-num,
.gf-resa[data-etape="2"] .gf-resa-fil li[data-etape="2"] .gf-resa-fil-num { background: #B87B2A; color: #fff; }
.gf-resa-fil li.gf-resa-fait .gf-resa-fil-num { background: #cfd8c4; color: #2f3a26; }

/* ---------- Ecrans ---------- */
.gf-resa-corps { flex: 1 1 auto; position: relative; overflow: hidden; min-height: 0; }
.gf-resa-piste {
	display: flex; width: 200%; height: 100%;
	transform: translateX(0); transition: transform .34s cubic-bezier(.22,.61,.36,1);
}
.gf-resa-etape {
	width: 50%; height: 100%; overflow-y: auto; overscroll-behavior: contain;
	padding: 18px 20px 24px;
	/* Sans box-sizing, le remplissage s'ajoute a la largeur de l'ecran et le formulaire
	   deborde du tiroir sur la droite. */
	box-sizing: border-box;
}
.gf-resa-panneau, .gf-resa-panneau * { box-sizing: border-box; }
/* Les champs du moteur sont des elements flex : sans min-width, ils refusent de se
   reduire sous la largeur de leur contenu et debordent dans un panneau etroit. */
.gf-resa-etape .gf-field { min-width: 0; }
.gf-resa-etape .gf-row { flex-wrap: wrap; }
.gf-resa-consigne { margin: 0 0 14px; color: #7d8a6f; font-size: .9rem; }
/* Conteneur d'origine du moteur, vide une fois ses blocs repartis. */
.gf-resa-corps > .gf-booking-block:empty { display: none; }
/* Les blocs deplaces occupent toute la largeur de l'ecran, sans cadre propre. */
.gf-resa-etape > * { max-width: none !important; margin-left: 0 !important; margin-right: 0 !important; }
.gf-resa-etape .gf-booking-name { display: none; }
/* Le bouton d'envoi du moteur est relaye par celui de la barre du bas. */
.gf-resa-etape .gf-btn { display: none; }

/* ---------- Interrupteur oui/non (linge, menage) ---------- */
.gf-resa-switch { display: inline-flex; align-items: center; cursor: pointer; }
.gf-resa-switch input { position: absolute; opacity: 0; pointer-events: none; }
.gf-resa-switch-piste { width: 46px; height: 26px; border-radius: 999px; background: #D8D2C0;
	position: relative; transition: background .2s ease; flex: 0 0 auto; }
.gf-resa-switch-curseur { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px;
	border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: left .2s ease; }
.gf-resa-switch input:checked + .gf-resa-switch-piste { background: #B87B2A; }
.gf-resa-switch input:checked + .gf-resa-switch-piste .gf-resa-switch-curseur { left: 23px; }
.gf-resa-switch input:focus-visible + .gf-resa-switch-piste { outline: 2px solid #2E3B2A; outline-offset: 2px; }

/* ---------- Groupes d'options : accordeons visibles ---------- */
/* The engine renders Restauration/Boissons/Animations as flat headings; nothing
   says "this unfolds". Turn each group into a card with an obvious ocre chevron. */
.gf-resa-panneau .gf-group { border: 1px solid #E4DCC9; border-top: 1px solid #E4DCC9;
	border-radius: 12px; margin: 14px 0; background: #fff; overflow: hidden; }
.gf-resa-panneau .gf-group-head { padding: 13px 16px; min-height: 52px; border-radius: 0;
	background: #F8F4EA; }
.gf-resa-panneau .gf-group-head:hover { background: #F1EADA; }
.gf-resa-panneau .gf-group-head[aria-expanded="true"] { border-bottom: 1px solid #E4DCC9; }
.gf-resa-panneau .gf-group-title { font-weight: 700; font-size: 1.02rem; }
.gf-resa-panneau .gf-group-chevron { width: 30px; height: 30px; border: 1px solid #B87B2A;
	border-radius: 50%; box-sizing: border-box; flex: 0 0 auto;
	background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23B87B2A' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E") center / 14px 14px no-repeat; }
.gf-resa-panneau .gf-group-body { padding: 0 16px; }
.gf-resa-panneau .gf-group > .gf-lines { padding: 0 16px; }
/* Le lien « Voir les X options » fait doublon avec l'en-tete cliquable. */
.gf-resa-panneau .gf-group-toggle { display: none; }

/* ---------- Supplements d'horaires refletes sous les champs d'heure ---------- */
.gf-resa-horaires-supp { flex: 1 1 100%; }
.gf-resa-horaires-supp[hidden] { display: none; }
.gf-resa-supp-ligne { display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
	margin-top: 8px; padding: 9px 14px; background: #FBF6EC; border: 1px solid #EFE3C8;
	border-radius: 8px; font-size: .92rem; }
.gf-resa-supp-ligne span:last-child { font-weight: 700; white-space: nowrap; }

/* ---------- Notice d'assurance et CGV ---------- */
.gf-resa-notice-lien { margin: 10px 0 0; font-size: .88rem; }
.gf-resa-notice-lien a { color: #9A6318; }
.gf-resa-cgv { display: flex; gap: 10px; align-items: flex-start; margin: 18px 0 6px;
	font-size: .9rem; line-height: 1.5; cursor: pointer; }
.gf-resa-cgv input { margin-top: 3px; width: 17px; height: 17px; accent-color: #B87B2A; flex: 0 0 auto; }
.gf-resa-cgv a { color: #9A6318; }

/* ---------- Barre de navigation ---------- */
.gf-resa-nav {
	flex: 0 0 auto; display: flex; align-items: center; gap: 10px;
	padding: 12px 20px; border-top: 1px solid #eef0ea; background: #fff;
	padding-bottom: max(12px, env(safe-area-inset-bottom));
}
.gf-resa-nav button {
	border-radius: 4px; font: 700 .85rem/1 Karla, Helvetica, Arial, sans-serif;
	text-transform: uppercase; letter-spacing: .1em;
	cursor: pointer; padding: 13px 18px; min-height: 44px; transition: background .18s ease, opacity .18s ease;
}
.gf-resa-precedent { border: 1px solid #d8ded0; background: #fff; color: #2f3a26; }
.gf-resa-precedent:hover { background: #f4f6f0; }
.gf-resa-suivant, .gf-resa-valider {
	margin-left: auto; border: 0; background: #B87B2A; color: #fff; min-width: 150px;
}
.gf-resa-suivant:hover:not(:disabled), .gf-resa-valider:hover:not(:disabled) { background: #9A6318; }
.gf-resa-nav button:disabled { opacity: .45; cursor: not-allowed; }
.gf-resa-nav button:focus-visible { outline: 2px solid #2f3a26; outline-offset: 2px; }

body.gf-resa-ouverte { overflow: hidden; }

@media (max-width: 600px) {
	.gf-resa-declencheur { right: 14px; bottom: 14px; padding: 13px 20px; }
	.gf-resa-panneau { width: 100%; }
	.gf-resa-entete { padding: 14px 16px; }
	.gf-resa-fil { padding: 10px 16px; gap: 4px; }
	.gf-resa-fil-nom { font-size: .78rem; }
	.gf-resa-etape { padding: 16px 16px 22px; }
	.gf-resa-nav { padding: 10px 16px; padding-bottom: max(10px, env(safe-area-inset-bottom)); }
	.gf-resa-suivant, .gf-resa-valider { min-width: 0; flex: 1 1 auto; }
}
@media (prefers-reduced-motion: reduce) {
	.gf-resa-panneau, .gf-resa-fond, .gf-resa-piste, .gf-resa-declencheur { transition: none; }
}
CSS;

		$js = <<<'JS'
( function () {
	var racine = document.querySelector( '.gf-resa' );
	if ( ! racine ) { return; }

	var declencheur = racine.querySelector( '.gf-resa-declencheur' );
	var panneau     = racine.querySelector( '.gf-resa-panneau' );
	var fond        = racine.querySelector( '.gf-resa-fond' );
	var fermer      = racine.querySelector( '.gf-resa-fermer' );
	var corps       = racine.querySelector( '.gf-resa-corps' );
	var piste       = racine.querySelector( '.gf-resa-piste' );
	var ecrans      = Array.prototype.slice.call( racine.querySelectorAll( '.gf-resa-etape' ) );
	var filItems    = Array.prototype.slice.call( racine.querySelectorAll( '.gf-resa-fil li' ) );
	var precedent   = racine.querySelector( '.gf-resa-precedent' );
	var suivant     = racine.querySelector( '.gf-resa-suivant' );
	var valider     = racine.querySelector( '.gf-resa-valider' );

	var etape        = 1;
	var champsDates  = [];
	var boutonMoteur = null;
	var derniereCle  = '';
	var caseCgv      = null;
	var pret         = false;

	/* ---------- Repartition des blocs du moteur dans les deux ecrans ---------- */

	function construire() {
		var moteur = corps.querySelector( '.gf-booking' );
		if ( ! moteur || ! moteur.querySelector( '.gf-cal-box' ) ) { return false; }

		// L'ordre des blocs produits par le moteur est stable : calendrier et dates, puis les
		// sections (voyageurs, options), puis le recapitulatif et tout ce qui suit.
		var cible = 1;
		Array.prototype.slice.call( moteur.children ).forEach( function ( enfant ) {
			if ( enfant.classList.contains( 'gf-summary' ) ) { cible = 2; }
			ecrans[ cible - 1 ].appendChild( enfant );
		} );
		moteur.remove();

		champsDates  = ecrans[0].querySelectorAll( '.gf-ro' );
		boutonMoteur = ecrans[1].querySelector( '.gf-btn' );

		if ( boutonMoteur ) {
			valider.textContent = boutonMoteur.textContent || 'Réserver';
			valider.addEventListener( 'click', function () { boutonMoteur.click(); } );
			// Le moteur active son bouton quand le devis est complet : on suit son etat.
			new MutationObserver( majNav ).observe( boutonMoteur, {
				attributes: true, attributeFilter: [ 'disabled' ],
				childList: true, characterData: true, subtree: true
			} );
		}

		// Toute action dans l'ecran des dates peut completer le sejour.
		// Le moteur ecrit les dates de facon asynchrone apres le clic : on re-verifie a
		// plusieurs horizons, le garde derniereCle rendant l'operation idempotente.
		ecrans[0].addEventListener( 'click', function () {
			[ 60, 500, 1200 ].forEach( function ( ms ) { window.setTimeout( verifierDates, ms ); } );
		} );

		affinerOptions();
		// Le moteur reconstruit ses lignes (premier devis, changement de voyageurs…) : on
		// rejoue l'affinage a chaque mutation, il est idempotent.
		// Throttle et non debounce : le moteur mute en continu pendant un devis, un debounce
		// classique ne se declencherait jamais.
		var affinage = null;
		var replanifier = function () {
			if ( affinage ) { return; }
			affinage = window.setTimeout( function () { affinage = null; affinerOptions(); }, 200 );
		};
		new MutationObserver( replanifier ).observe( ecrans[0], { childList: true, subtree: true } );
		// Un changement d'horaire ne mute que le recapitulatif (ecran 2) : on l'ecoute aussi.
		new MutationObserver( replanifier ).observe( ecrans[1], { childList: true, characterData: true, subtree: true } );

		// La garantie annulation renvoie vers la notice d'assurance de l'assureur (NEAT).
		var assurance = ecrans[0].querySelector( '.gf-insurance' );
		if ( assurance && ! assurance.querySelector( '.gf-resa-notice-lien' ) ) {
			var lien = document.createElement( 'p' );
			lien.className = 'gf-resa-notice-lien';
			lien.innerHTML = '<a href="/wp-content/uploads/2026/09/notice-assurance-annulation-neat.pdf" target="_blank" rel="noopener">Consulter la notice d\u2019assurance (PDF)</a>';
			assurance.appendChild( lien );
		}

		// Acceptation des CGV, obligatoire avant l'envoi (ecran recapitulatif).
		if ( ! ecrans[1].querySelector( '.gf-resa-cgv input' ) ) {
			var cgv = document.createElement( 'label' );
			cgv.className = 'gf-resa-cgv';
			cgv.innerHTML = '<input type="checkbox" /> <span>J\u2019ai lu et j\u2019accepte les '
				+ '<a href="/cgv/" target="_blank" rel="noopener">conditions g\u00e9n\u00e9rales de location</a>.</span>';
			ecrans[1].appendChild( cgv );
			caseCgv = cgv.querySelector( 'input' );
			caseCgv.addEventListener( 'change', majNav );
		}

		pret = true;
		majNav();

		// Arrive d'une autre page via « Réserver » : le tiroir s'ouvre de lui-même, et la page
		// reste sur son hero (le navigateur avait file a l'ancre #reserver, pres de la FAQ).
		// Un clic sur « Réserver » depuis la page elle-meme ne passe pas ici : il ne scrolle pas.
		if ( '#reserver' === window.location.hash ) {
			window.history.replaceState( null, '', window.location.pathname + window.location.search );
			window.scrollTo( 0, 0 );
			ouvrir();
		}
		return true;
	}

	// Le moteur se construit apres un appel reseau : on attend son calendrier.
	( function attendre( essais ) {
		if ( construire() || essais <= 0 ) { return; }
		window.setTimeout( function () { attendre( essais - 1 ); }, 150 );
	} )( 80 );

	/* ---------- Affichage des options : libelles humains, interrupteurs oui/non ----------
	   Pur affichage — les quantites reelles restent pilotees par le stepper du moteur
	   (masque pour les options oui/non), donc les prix calcules ne changent pas. */

	function normalise( t ) {
		return ( t || '' ).normalize( 'NFD' ).replace( /[\u0300-\u036f]/g, '' ).toLowerCase().trim();
	}

	function interrupteur( ligne, step ) {
		if ( ligne.querySelector( '.gf-resa-switch' ) ) { return; }
		step.style.display = 'none';
		var sw = document.createElement( 'label' );
		sw.className = 'gf-resa-switch';
		sw.innerHTML = '<input type="checkbox" /><span class="gf-resa-switch-piste"><span class="gf-resa-switch-curseur"></span></span>';
		var box = sw.querySelector( 'input' );
		var val = function () { return parseInt( step.querySelector( '.gf-step-val' ).textContent, 10 ) || 0; };
		box.checked = val() > 0;
		box.addEventListener( 'change', function () {
			var btns = step.querySelectorAll( '.gf-step-btn' );
			var garde = 0;
			if ( box.checked ) { while ( val() < 1 && garde++ < 5 ) { btns[1].click(); } }
			else { while ( val() > 0 && garde++ < 99 ) { btns[0].click(); } }
		} );
		step.parentNode.insertBefore( sw, step );
	}

	function affinerOptions() {
		// Les animations ne sont pas vendues sur le site : on masque leur groupe.
		document.querySelectorAll( '.gf-group' ).forEach( function ( groupe ) {
			var titre = groupe.querySelector( '.gf-group-title' );
			if ( titre && /^animations?$/i.test( titre.textContent.trim() ) ) {
				groupe.hidden = true;
			}
		} );
		ecrans[0].querySelectorAll( '.gf-line' ).forEach( function ( ligne ) {
			var titreEl = ligne.querySelector( '.gf-line-title' );
			var prixEl  = ligne.querySelector( '.gf-line-price' );
			var step    = ligne.querySelector( '.gf-step' );
			if ( ! titreEl ) { return; }

			// Le titre peut porter un bouton d'info : on ne touche qu'au texte du premier span.
			var texteEl = titreEl.firstElementChild || titreEl;
			var titrePropre = texteEl.textContent.replace( /^Animation[\s-]+(?=\S)/i, '' )
				.replace( /^./, function ( c ) { return c.toUpperCase(); } );
			if ( titrePropre !== texteEl.textContent ) { texteEl.textContent = titrePropre; }
			var t = normalise( texteEl.textContent );

			// Oui/non : linge de toilette et menage (1 = oui, comme aujourd'hui cote GuestFlow).
			if ( step && ( t.indexOf( 'linge de toilette' ) === 0 || t.indexOf( 'menage' ) === 0 ) ) {
				interrupteur( ligne, step );
			}

			if ( prixEl ) {
				var p = prixEl.textContent;
				if ( t.indexOf( 'animaux sauvage' ) !== -1 ) {
					p = p.replace( /\s*\u00b7?\s*au s\u00e9jour/gi, '' );
					if ( p.indexOf( 'la session' ) === -1 ) { p += ' \u00b7 la session'; }
				} else if ( t.indexOf( 'visite animaux' ) !== -1 || t.indexOf( 'enfants + bain nordique' ) !== -1 ) {
					p = p.replace( /par participant/gi, 'par personne' );
					if ( p.indexOf( 'd\u00e9gressif' ) === -1 ) { p += ' \u00b7 tarif d\u00e9gressif'; }
				} else if ( t.indexOf( 'petit dejeuner' ) === 0 || t.indexOf( 'repas' ) === 0 ) {
					p = p.replace( /par s\u00e9ance/gi, 'par repas' );
				} else {
					// Planches, boissons, balade nocturne… : juste le prix.
					p = p.replace( /\s*\u00b7?\s*au s\u00e9jour/gi, '' );
				}
				if ( p !== prixEl.textContent ) { prixEl.textContent = p; }
			}

			// Un repas est servi pour toute la tablee : des qu'on en ajoute, on affiche
			// le compte reel (nombre de repas x nombre de convives), comme GuestFlow.
			if ( t.indexOf( 'petit dejeuner' ) === 0 || t.indexOf( 'repas' ) === 0 ) {
				var note = ligne.querySelector( '.gf-resa-note-repas' );
				var qte  = 0;
				if ( step ) { qte = parseInt( ( step.querySelector( '.gf-step-val' ) || {} ).textContent, 10 ) || 0; }
				if ( qte > 0 ) {
					var pers  = compterConvives();
					// Le titre porte parfois le glyphe du bouton d'info (\u24d8) : on l'ecarte.
					var recap = ligneRecap( texteEl.textContent.replace( /\u24d8/g, '' ).trim() );
					var msg = qte + ' repas \u00d7 ' + pers + ' personne' + ( pers > 1 ? 's' : '' )
						+ ( recap ? ' \u2014 ' + recap.prix : '' );
					if ( ! note ) {
						note = document.createElement( 'div' );
						note.className = 'gf-line-note gf-resa-note-repas';
						ligne.appendChild( note );
					}
					if ( note.textContent !== msg ) { note.textContent = msg; }
				} else if ( note ) {
					note.remove();
				}
			}
		} );
		majSupplementsHoraires();
	}

	// Adultes + ados + enfants : le compte que le moteur applique aux repas (bebes exclus).
	function compterConvives() {
		var total = 0;
		ecrans[0].querySelectorAll( '.gf-line' ).forEach( function ( ligne ) {
			var titre = ligne.querySelector( '.gf-line-title' );
			if ( ! titre || ! /^(Adultes|Ados|Enfants)$/.test( titre.textContent.trim() ) ) { return; }
			total += parseInt( ( ligne.querySelector( '.gf-step-val' ) || {} ).textContent, 10 ) || 0;
		} );
		return total;
	}

	// Retrouve une ligne du recapitulatif du moteur par le debut de son libelle.
	function ligneRecap( prefixe ) {
		var lignes = ecrans[1].querySelectorAll( '.gf-summary-line' );
		for ( var i = 0; i < lignes.length; i++ ) {
			var spans = lignes[i].querySelectorAll( 'span' );
			if ( spans.length >= 2 && spans[0].textContent.indexOf( prefixe ) === 0 ) {
				return { libelle: spans[0].textContent.trim(), prix: spans[1].textContent.trim() };
			}
		}
		return null;
	}

	// Un horaire d'arrivee ou de depart hors plage est facture par le moteur, mais le
	// supplement n'apparaissait qu'au recapitulatif : on le reflete sous les champs d'heure.
	function majSupplementsHoraires() {
		var champs = ecrans[0].querySelectorAll( '.gf-field-time' );
		if ( ! champs.length ) { return; }
		var parent = champs[ champs.length - 1 ].parentNode;
		var zone = parent.querySelector( '.gf-resa-horaires-supp' );
		if ( ! zone ) {
			zone = document.createElement( 'div' );
			zone.className = 'gf-resa-horaires-supp';
			parent.appendChild( zone );
		}
		var attendus = [ 'Arriv\u00e9e anticip\u00e9e', 'D\u00e9part tardif' ];
		var visibles = [];
		attendus.forEach( function ( prefixe ) {
			var l = ligneRecap( prefixe );
			if ( l ) { visibles.push( { libelle: l.libelle.replace( /\s*\u00d7\s*\d+$/, '' ), prix: l.prix } ); }
		} );
		var cle = JSON.stringify( visibles );
		if ( zone.dataset.cle === cle ) { return; }
		zone.dataset.cle = cle;
		zone.innerHTML = '';
		visibles.forEach( function ( v ) {
			var ligne = document.createElement( 'div' );
			ligne.className = 'gf-resa-supp-ligne';
			var nom = document.createElement( 'span' );
			nom.textContent = v.libelle;
			var prix = document.createElement( 'span' );
			prix.textContent = v.prix;
			ligne.appendChild( nom );
			ligne.appendChild( prix );
			zone.appendChild( ligne );
		} );
		zone.hidden = ! visibles.length;
	}

	/* ---------- Navigation ---------- */

	function datesCompletes() {
		if ( ! champsDates || champsDates.length < 2 ) { return false; }
		var a = ( champsDates[0].value || '' ).trim();
		var b = ( champsDates[1].value || '' ).trim();
		return !! a && !! b && a !== '—' && b !== '—';
	}

	function majNav() {
		precedent.hidden = ( etape === 1 );

		var derniere = ( etape === 2 );
		suivant.hidden = derniere;
		valider.hidden = ! derniere;

		if ( etape === 1 ) {
			suivant.disabled = ! datesCompletes();
			suivant.title = suivant.disabled ? 'Choisissez d’abord vos dates' : '';
		}

		if ( derniere && boutonMoteur ) {
			// L'envoi exige le devis complet ET l'acceptation des CGV.
			valider.disabled = boutonMoteur.disabled || ( caseCgv && ! caseCgv.checked );
			valider.textContent = boutonMoteur.textContent || 'Réserver';
			valider.title = ( caseCgv && ! caseCgv.checked ) ? 'Acceptez d’abord les conditions générales' : '';
		}

		filItems.forEach( function ( li ) {
			li.classList.toggle( 'gf-resa-fait', parseInt( li.dataset.etape, 10 ) < etape );
		} );
	}

	function aller( n ) {
		etape = Math.min( 2, Math.max( 1, n ) );
		racine.dataset.etape = etape;
		piste.style.transform = 'translateX(-' + ( ( etape - 1 ) * ( 100 / 2 ) ) + '%)';
		ecrans[ etape - 1 ].scrollTop = 0;
		majNav();
	}

	precedent.addEventListener( 'click', function () { aller( etape - 1 ); } );
	// « Suivant » descend d'abord aux options ; un second appui (ou un visiteur deja en bas)
	// passe au recapitulatif.
	suivant.addEventListener( 'click', function () {
		if ( etape === 1 ) {
			var sections = ecrans[0].querySelectorAll( '.gf-section' );
			var options  = sections.length > 1 ? sections[1] : sections[0];
			if ( options && ecrans[0].scrollTop < options.offsetTop - 140 ) {
				ecrans[0].scrollTo( { top: Math.max( 0, options.offsetTop - 60 ), behavior: 'smooth' } );
				return;
			}
		}
		aller( etape + 1 );
	} );

	// Les dates completes activent « Suivant » : voyageurs et options partagent l'ecran 1,
	// il n'y a plus de glissement automatique.
	function verifierDates() {
		if ( ! pret ) { return; }
		majNav();
		// Des que le sejour est complet, la ligne dates/heures reste visible en haut et la
		// composition de la famille apparait juste dessous — rien n'est rogne.
		var cle = champsDates[0].value + '|' + champsDates[1].value;
		if ( cle === derniereCle || ! datesCompletes() ) { return; }
		derniereCle = cle;
		var ligneDates = ecrans[0].querySelector( '.gf-row' );
		if ( ligneDates ) {
			window.setTimeout( function () {
				ecrans[0].scrollTo( { top: Math.max( 0, ligneDates.offsetTop - 8 ), behavior: 'smooth' } );
			}, 350 );
		}
	}

	/* ---------- Ouverture et fermeture ---------- */

	function ouvrir() {
		racine.dataset.ouvert = '1';
		panneau.removeAttribute( 'inert' );
		declencheur.setAttribute( 'aria-expanded', 'true' );
		document.body.classList.add( 'gf-resa-ouverte' );
		window.setTimeout( function () { fermer.focus(); }, 60 );
	}

	function refermer() {
		racine.dataset.ouvert = '0';
		declencheur.setAttribute( 'aria-expanded', 'false' );
		document.body.classList.remove( 'gf-resa-ouverte' );
		window.setTimeout( function () {
			if ( racine.dataset.ouvert === '0' ) { panneau.setAttribute( 'inert', '' ); }
		}, 320 );
		declencheur.focus();
	}

	declencheur.addEventListener( 'click', ouvrir );
	// Le bouton « Réserver » du bandeau pointe /page/#reserver : quand on est DEJA sur la page,
	// le navigateur ne recharge pas, il pose juste le hash — on ouvre le tiroir sans bouger
	// la page (aucune ancre #reserver n'existe dans le contenu, donc aucun saut).
	window.addEventListener( 'hashchange', function () {
		if ( '#reserver' === window.location.hash ) {
			window.history.replaceState( null, '', window.location.pathname + window.location.search );
			ouvrir();
		}
	} );
	fermer.addEventListener( 'click', refermer );
	fond.addEventListener( 'click', refermer );
	document.addEventListener( 'keydown', function ( e ) {
		if ( e.key === 'Escape' && racine.dataset.ouvert === '1' ) { refermer(); }
	} );

	document.querySelectorAll( '[href="#reserver"], [data-gf-reserver]' ).forEach( function ( el ) {
		el.addEventListener( 'click', function ( e ) { e.preventDefault(); ouvrir(); } );
	} );
} )();
JS;

		wp_register_style( 'gf-resa', false );
		wp_enqueue_style( 'gf-resa' );
		wp_add_inline_style( 'gf-resa', $css );

		wp_register_script( 'gf-resa', '', array(), null, true );
		wp_enqueue_script( 'gf-resa' );
		wp_add_inline_script( 'gf-resa', $js );
	},
	20
);
