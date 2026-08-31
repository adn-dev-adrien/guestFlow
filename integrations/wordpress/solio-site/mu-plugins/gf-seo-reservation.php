<?php
/**
 * gf-seo-reservation.php — Reservation en tiroir lateral, en trois etapes.
 *
 * Le moteur de reservation est ouvert par un bouton flottant en bas a droite, dans un tiroir
 * venant de la droite, et decoupe en trois ecrans qui defilent horizontalement :
 *
 *   1. Dates        le calendrier et les horaires d’arrivee et de depart
 *   2. Options      le nombre de voyageurs, les options et les supplements
 *   3. Réservation  le recapitulatif chiffre et les coordonnees
 *
 * Le passage de l’etape 1 a l’etape 2 est automatique des que les deux dates sont choisies.
 *
 * Point important : les blocs du moteur GuestFlow ne sont ni copies ni reconstruits, ils sont
 * simplement DEPLACES dans les trois ecrans. Les gestionnaires d’evenements et l’etat interne
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
		$conf  = function_exists( 'gf_seo_current_config' ) ? gf_seo_current_config() : null;
		$l     = ! empty( $conf['lodging'] ) ? gf_seo_lodging( $conf['lodging'] ) : null;
		$titre = $l ? $l['nom'] : 'Votre séjour';

		$etapes = array(
			array( 'Dates', 'Choisissez vos dates d’arrivée et de départ.' ),
			array( 'Options', 'Voyageurs, options et suppléments.' ),
			array( 'Réservation', 'Récapitulatif et coordonnées.' ),
		);

		ob_start();
		?>
<div class="gf-resa" data-ouvert="0" data-etape="1">
	<button type="button" class="gf-resa-declencheur" aria-expanded="false" aria-controls="gf-resa-panneau">
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
			stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
			<rect x="3" y="4.5" width="18" height="16" rx="2.5" />
			<path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
		</svg>
		<span>Réserver</span>
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
/* ---------- Bouton flottant ---------- */
.gf-resa-declencheur {
	position: fixed; right: 22px; bottom: 22px; z-index: 1500;
	display: inline-flex; align-items: center; gap: 9px;
	padding: 14px 22px; border: 0; border-radius: 999px;
	background: #5a6b48; color: #fff; font: 600 1rem/1 Roboto, Helvetica, Arial, sans-serif;
	cursor: pointer; box-shadow: 0 8px 26px rgba(47,58,38,.34);
	transition: background .2s ease, transform .2s ease, opacity .2s ease;
}
.gf-resa-declencheur:hover { background: #2f3a26; transform: translateY(-2px); }
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
	background: #fff; box-shadow: -12px 0 40px rgba(0,0,0,.22);
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
	margin: 0; font-size: 1.1rem; line-height: 1.3; color: #2f3a26; font-weight: 700;
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
.gf-resa[data-etape="2"] .gf-resa-fil li[data-etape="2"],
.gf-resa[data-etape="3"] .gf-resa-fil li[data-etape="3"] { color: #2f3a26; font-weight: 600; }
.gf-resa[data-etape="1"] .gf-resa-fil li[data-etape="1"] .gf-resa-fil-num,
.gf-resa[data-etape="2"] .gf-resa-fil li[data-etape="2"] .gf-resa-fil-num,
.gf-resa[data-etape="3"] .gf-resa-fil li[data-etape="3"] .gf-resa-fil-num { background: #5a6b48; color: #fff; }
.gf-resa-fil li.gf-resa-fait .gf-resa-fil-num { background: #cfd8c4; color: #2f3a26; }

/* ---------- Ecrans ---------- */
.gf-resa-corps { flex: 1 1 auto; position: relative; overflow: hidden; min-height: 0; }
.gf-resa-piste {
	display: flex; width: 300%; height: 100%;
	transform: translateX(0); transition: transform .34s cubic-bezier(.22,.61,.36,1);
}
.gf-resa-etape {
	width: 33.3333%; height: 100%; overflow-y: auto; overscroll-behavior: contain;
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

/* ---------- Barre de navigation ---------- */
.gf-resa-nav {
	flex: 0 0 auto; display: flex; align-items: center; gap: 10px;
	padding: 12px 20px; border-top: 1px solid #eef0ea; background: #fff;
	padding-bottom: max(12px, env(safe-area-inset-bottom));
}
.gf-resa-nav button {
	border-radius: 10px; font: 600 .95rem/1 Roboto, Helvetica, Arial, sans-serif;
	cursor: pointer; padding: 13px 18px; min-height: 44px; transition: background .18s ease, opacity .18s ease;
}
.gf-resa-precedent { border: 1px solid #d8ded0; background: #fff; color: #2f3a26; }
.gf-resa-precedent:hover { background: #f4f6f0; }
.gf-resa-suivant, .gf-resa-valider {
	margin-left: auto; border: 0; background: #5a6b48; color: #fff; min-width: 150px;
}
.gf-resa-suivant:hover:not(:disabled), .gf-resa-valider:hover:not(:disabled) { background: #2f3a26; }
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
	var pret         = false;

	/* ---------- Repartition des blocs du moteur dans les trois ecrans ---------- */

	function construire() {
		var moteur = corps.querySelector( '.gf-booking' );
		if ( ! moteur || ! moteur.querySelector( '.gf-cal-box' ) ) { return false; }

		// L'ordre des blocs produits par le moteur est stable : calendrier et dates, puis les
		// sections (voyageurs, options), puis le recapitulatif et tout ce qui suit.
		var cible = 1;
		Array.prototype.slice.call( moteur.children ).forEach( function ( enfant ) {
			if ( enfant.classList.contains( 'gf-section' ) ) { cible = 2; }
			if ( enfant.classList.contains( 'gf-summary' ) ) { cible = 3; }
			ecrans[ cible - 1 ].appendChild( enfant );
		} );
		moteur.remove();

		champsDates  = ecrans[0].querySelectorAll( '.gf-ro' );
		boutonMoteur = ecrans[2].querySelector( '.gf-btn' );

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
		ecrans[0].addEventListener( 'click', function () { window.setTimeout( verifierDates, 40 ); } );

		pret = true;
		majNav();
		return true;
	}

	// Le moteur se construit apres un appel reseau : on attend son calendrier.
	( function attendre( essais ) {
		if ( construire() || essais <= 0 ) { return; }
		window.setTimeout( function () { attendre( essais - 1 ); }, 150 );
	} )( 80 );

	/* ---------- Navigation ---------- */

	function datesCompletes() {
		if ( ! champsDates || champsDates.length < 2 ) { return false; }
		var a = ( champsDates[0].value || '' ).trim();
		var b = ( champsDates[1].value || '' ).trim();
		return !! a && !! b && a !== '—' && b !== '—';
	}

	function majNav() {
		precedent.hidden = ( etape === 1 );

		var derniere = ( etape === 3 );
		suivant.hidden = derniere;
		valider.hidden = ! derniere;

		if ( etape === 1 ) {
			suivant.disabled = ! datesCompletes();
			suivant.title = suivant.disabled ? 'Choisissez d’abord vos dates' : '';
		} else if ( etape === 2 ) {
			suivant.disabled = false;
			suivant.title = '';
		}

		if ( derniere && boutonMoteur ) {
			valider.disabled = boutonMoteur.disabled;
			valider.textContent = boutonMoteur.textContent || 'Réserver';
		}

		filItems.forEach( function ( li ) {
			li.classList.toggle( 'gf-resa-fait', parseInt( li.dataset.etape, 10 ) < etape );
		} );
	}

	function aller( n ) {
		etape = Math.min( 3, Math.max( 1, n ) );
		racine.dataset.etape = etape;
		piste.style.transform = 'translateX(-' + ( ( etape - 1 ) * ( 100 / 3 ) ) + '%)';
		ecrans[ etape - 1 ].scrollTop = 0;
		majNav();
	}

	precedent.addEventListener( 'click', function () { aller( etape - 1 ); } );
	suivant.addEventListener( 'click', function () { aller( etape + 1 ); } );

	// Passage automatique aux options des que le sejour est complet.
	function verifierDates() {
		if ( ! pret ) { return; }
		majNav();
		if ( etape !== 1 ) { return; }
		var cle = champsDates[0].value + '|' + champsDates[1].value;
		if ( cle === derniereCle ) { return; }
		derniereCle = cle;
		if ( ! datesCompletes() ) { return; }
		// Court delai : le visiteur voit son sejour se dessiner avant que l'ecran ne glisse.
		window.setTimeout( function () {
			if ( etape === 1 && datesCompletes() ) { aller( 2 ); }
		}, 420 );
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
