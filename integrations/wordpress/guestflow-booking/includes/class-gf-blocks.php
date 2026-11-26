<?php
/**
 * Block registration (build-free). Registers shared style + the `gf-runtime` script (which carries the
 * localized `window.GFBooking` config: the plugin REST base, the wp_rest nonce, the default property,
 * the booking page URL, and the i18n strings), then per-block editor/view scripts and the three blocks
 * via their block.json. No npm build: every JS file ships as plain ES.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class GF_Blocks
{
    private static ?GF_Blocks $instance = null;
    private const BLOCKS = ['calendar', 'booking', 'properties', 'gift-voucher', 'gift-voucher-use', 'session-booking'];
    /** « Utiliser un bon cadeau » is an alias of the session tunnel (specs/site/site-outside-resource-booking.md rule 18): it runs that block's script. */
    private const VIEW_OF = ['gift-voucher-use' => 'session-booking'];

    public static function instance(): GF_Blocks
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function boot(): void
    {
        add_action('init', [$this, 'register']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_attribution']);
    }

    /**
     * The visit's source is recorded on the page the visitor LANDS on, which is rarely a page with a
     * booking block (specs/site/site-traffic-analytics.md rule 13) — hence on every public page. A site
     * that does not want it returns false from the `guestflow_booking_capture_attribution` filter.
     */
    public function enqueue_attribution(): void
    {
        if (is_user_logged_in() || !apply_filters('guestflow_booking_capture_attribution', true)) {
            return;
        }
        wp_enqueue_script('gf-attribution', GF_BOOKING_URL . 'assets/attribution.js', [], $this->asset_ver('assets/attribution.js'), false);
    }

    public function register(): void
    {
        // Version each asset by its file mtime so a redeploy that changes a file busts the browser
        // cache automatically — the release CI syncs these files into the container without bumping
        // the plugin version.
        wp_register_style('guestflow-style', GF_BOOKING_URL . 'assets/style.css', [], $this->asset_ver('assets/style.css'));

        // Runtime holder for the localized config; every block script depends on it.
        wp_register_script('gf-runtime', GF_BOOKING_URL . 'assets/runtime.js', [], $this->asset_ver('assets/runtime.js'), true);
        wp_localize_script('gf-runtime', 'GFBooking', $this->runtime_config());
        // The proof of work of the booking request (GuestFlow specs/site/public-request-abuse-and-grouping.md
        // rule 2): solved in a Web Worker (assets/pow-worker.js), this copy only as the page's fallback.
        wp_register_script('gf-pow', GF_BOOKING_URL . 'assets/pow.js', [], $this->asset_ver('assets/pow.js'), true);

        // The voucher code: normalisation, grouping and the check character, shared by the gift voucher
        // block and the booking engine's code field (specs/gift-vouchers/gift-vouchers.md rules 30 and 34).
        wp_register_script('gf-voucher-code', GF_BOOKING_URL . 'assets/voucher-code.js', ['gf-runtime'], $this->asset_ver('assets/voucher-code.js'), true);

        // What the two gift voucher blocks share: the proof of work, the stepper, amounts and durations.
        wp_register_script('gf-voucher-parts', GF_BOOKING_URL . 'assets/voucher-parts.js', ['gf-runtime'], $this->asset_ver('assets/voucher-parts.js'), true);

        // The card that turns, front and back, of the purchase page and of the page after payment (specs/gift-vouchers/gift-voucher-campaigns.md rule 66).
        wp_register_script('gf-voucher-card', GF_BOOKING_URL . 'assets/voucher-card.js', ['gf-runtime'], $this->asset_ver('assets/voucher-card.js'), true);

        foreach (self::BLOCKS as $name) {
            $view = self::VIEW_OF[$name] ?? $name;
            wp_register_script(
                "guestflow-{$name}-editor",
                GF_BOOKING_URL . "blocks/{$name}/editor.js",
                ['wp-blocks', 'wp-element', 'wp-components', 'wp-block-editor', 'wp-i18n', 'gf-runtime'],
                $this->asset_ver("blocks/{$name}/editor.js"),
                true
            );
            $deps = $name === 'booking' ? ['gf-runtime', 'gf-voucher-code', 'gf-pow'] : (strpos($name, 'gift-voucher') === 0 || $view === 'session-booking' ? ['gf-runtime', 'gf-voucher-code', 'gf-voucher-parts', 'gf-pow'] : ['gf-runtime']);
            if ($name === 'gift-voucher') {
                $deps[] = 'gf-voucher-card'; // only the purchase block draws the card
            }
            wp_register_script(
                "guestflow-{$name}-view",
                GF_BOOKING_URL . "blocks/{$view}/view.js",
                $deps,
                $this->asset_ver("blocks/{$view}/view.js"),
                true
            );
            register_block_type(GF_BOOKING_DIR . "blocks/{$name}");
        }
    }

    /** Cache-busting version for an asset = its file mtime (falls back to the plugin version). */
    private function asset_ver(string $relPath): string
    {
        $mtime = @filemtime(GF_BOOKING_DIR . $relPath);
        return $mtime ? (string) $mtime : GF_BOOKING_VERSION;
    }

    private function runtime_config(): array
    {
        $s = GF_Settings::instance();
        return [
            'restUrl'           => esc_url_raw(rest_url('guestflow/v1')),
            'nonce'             => wp_create_nonce('wp_rest'),
            'defaultPropertyId' => (int) $s->get('default_property_id', 0),
            'bookingPageUrl'    => $s->get_booking_page_url(),
            // specs/reservations/terms-acceptance-record.md rule 10 — the page the CGV checkbox links to.
            'cgvPageUrl'        => esc_url_raw($s->get_cgv_page_url()),
            'configured'        => $s->is_configured(),
            // Same origin as the page, as a Worker requires.
            'powWorkerUrl'      => esc_url_raw(GF_BOOKING_URL . 'assets/pow-worker.js?ver=' . $this->asset_ver('assets/pow-worker.js')),
            // The language the page is being read in, and the locale the browser should format
            // DATES with. Amounts are deliberately not included: rule 10 keeps « 1 234,56 € » in
            // both languages, because the quote PDF attached to the confirmation already writes it
            // that way to English guests (specs/site/site-english-version.md rules 10 + 24).
            'giftVoucherPageUrl' => esc_url_raw($s->get_gift_voucher_page_url()),
            // Rule 19 — the page holding « Réserver une séance », which the purchase page links to; '' when none does.
            'sessionPageUrl'    => esc_url_raw($s->get_gift_voucher_use_page_url()),
            'lang'              => GF_Language::current(),
            'locale'            => GF_Language::locale(),
            'i18n'              => [
                'loading'         => __('Chargement…', 'guestflow-booking'),
                'unavailable'     => __('Réservation temporairement indisponible.', 'guestflow-booking'),
                'genericError'    => __('Une erreur est survenue. Réessayez plus tard.', 'guestflow-booking'),
                'noAvailability'  => __('Aucune disponibilité sur cette période.', 'guestflow-booking'),
                'blocked'         => __('Indisponible', 'guestflow-booking'),
                'available'       => __('Disponible', 'guestflow-booking'),
                // Real plurals in the recap (specs/site/wordpress-plugin.md rule 22).
                'night'           => __('nuit', 'guestflow-booking'),
                'nights'          => __('nuits', 'guestflow-booking'),
                'from'            => __('à partir de', 'guestflow-booking'),
                'perNight'        => __('/ nuit', 'guestflow-booking'),
                'adults'          => __('Adultes', 'guestflow-booking'),
                'children'        => __('Enfants', 'guestflow-booking'),
                'teens'           => __('Ados', 'guestflow-booking'),
                'babies'          => __('Bébés', 'guestflow-booking'),
                'startDate'       => __('Arrivée', 'guestflow-booking'),
                'endDate'         => __('Départ', 'guestflow-booking'),
                'options'         => __('Options', 'guestflow-booking'),
                'total'           => __('Total', 'guestflow-booking'),
                'deposit'         => __('Acompte', 'guestflow-booking'),
                'balance'         => __('Solde', 'guestflow-booking'),
                'touristTax'      => __('Taxe de séjour', 'guestflow-booking'),
                'datesUnavailable' => __('Ces dates ne sont plus disponibles.', 'guestflow-booking'),
                'minNights'       => __('Séjour trop court (minimum %d nuits).', 'guestflow-booking'),
                'firstName'       => __('Prénom', 'guestflow-booking'),
                'lastName'        => __('Nom', 'guestflow-booking'),
                'email'           => __('E-mail', 'guestflow-booking'),
                'phone'           => __('Téléphone', 'guestflow-booking'),
                'message'         => __('Message', 'guestflow-booking'),
                'getQuote'        => __('Voir le devis', 'guestflow-booking'),
                'sendRequest'     => __('Envoyer la demande', 'guestflow-booking'),
                'sending'         => __('Envoi…', 'guestflow-booking'),
                'requestSent'     => __('Demande envoyée ! Référence : %s. Nous vous recontactons rapidement.', 'guestflow-booking'),
                // GuestFlow specs/site/public-request-abuse-and-grouping.md rules 2 and 13.
                'verifying'       => __('Vérification…', 'guestflow-booking'),
                'requestUpdated'  => __('Votre demande du %s a été mise à jour.', 'guestflow-booking'),
                'messageAdded'    => __('Votre demande du %s a déjà été transmise : votre message a été ajouté.', 'guestflow-booking'),
                'requestReceived' => __('Demande reçue. Nous vous recontactons rapidement.', 'guestflow-booking'),
                'bookNow'         => __('Réserver', 'guestflow-booking'),
                'capacity'        => __('Capacité', 'guestflow-booking'),
                'persons'         => __('personnes', 'guestflow-booking'),
                // Online payment flow (specs/site/public-online-payment.md)
                'payOnline'       => __('Payer en ligne', 'guestflow-booking'),
                'preparingPayment' => __('Préparation du paiement…', 'guestflow-booking'),
                'redirectingPayment' => __('Redirection vers le paiement sécurisé…', 'guestflow-booking'),
                'confirmingPayment' => __('Confirmation de votre paiement en cours…', 'guestflow-booking'),
                'paymentConfirmed' => __('Paiement confirmé — votre réservation est validée !', 'guestflow-booking'),
                'paymentPending'  => __('Paiement en attente. Si vous venez de payer, patientez quelques instants.', 'guestflow-booking'),
                'paymentCancelled' => __('Cette réservation est annulée.', 'guestflow-booking'),
                'paymentExpired'  => __('Ce lien de paiement a expiré. Refaire la réservation depuis la page du logement.', 'guestflow-booking'),
                'paymentConflict' => __('Paiement reçu et réservation enregistrée. Nous revenons vers vous très vite pour confirmer les détails.', 'guestflow-booking'),
                'stayRecap'       => __('Votre séjour', 'guestflow-booking'),
                // Online-deposit flow (specs/site/public-online-deposit.md)
                'payDeposit'      => __('Payer l’acompte', 'guestflow-booking'),
                'depositNow'      => __('Acompte à payer maintenant', 'guestflow-booking'),
                'depositPaid'     => __('Acompte réglé', 'guestflow-booking'),
                'balanceDueBefore' => __('Solde à régler avant le %s', 'guestflow-booking'),
                'balanceEmailFollows' => __('Un email vous sera envoyé pour régler le solde à l’échéance.', 'guestflow-booking'),
                // Planning-card options (specs/site/public-planning-options.md)
                'toBeScheduled'   => __('À planifier avec l’hôte.', 'guestflow-booking'),
                'moreInfo'        => __('Plus d’infos', 'guestflow-booking'),
                // Unified widget (specs/site/wp-booking-widget-redesign.md)
                'selectDates'     => __('Choisissez vos dates', 'guestflow-booking'),
                'pickArrival'     => __('Sélectionnez votre date d’arrivée', 'guestflow-booking'),
                'pickDeparture'   => __('Sélectionnez votre date de départ', 'guestflow-booking'),
                'rangeBlocked'    => __('Ces dates incluent une nuit indisponible. Choisissez une autre période.', 'guestflow-booking'),
                // specs/site/wp-booking-widget-redesign.md §3 rules 24-28 — a complete range stays editable.
                'changeDeparture' => __('Cliquez une autre date pour changer le départ, ou l’arrivée pour recommencer.', 'guestflow-booking'),
                'minNightsExtend' => __('Cliquez une date plus tard pour allonger le séjour.', 'guestflow-booking'),
                'clearDates'      => __('Effacer les dates', 'guestflow-booking'),
                'clearDatesShort' => __('Effacer', 'guestflow-booking'),
                'travelers'       => __('Voyageurs', 'guestflow-booking'),
                'guestsUnit'      => __('voyageurs', 'guestflow-booking'),
                'babiesUnit'      => __('bébés', 'guestflow-booking'),
                'supplements'     => __('Options & suppléments', 'guestflow-booking'),
                'teensAges'       => __('12 à 18 ans', 'guestflow-booking'),
                'childrenAges'    => __('2 à 12 ans', 'guestflow-booking'),
                'babiesAges'      => __('0 à 2 ans', 'guestflow-booking'),
                'babyBedsLabel'   => __('Lit(s) bébé souhaité(s) ?', 'guestflow-booking'),
                // specs/options/baby-bed-supplement.md §3.5 rule 17 — the cot is billed now. `babyBedsSub`
                // stays as the fallback for a logement that does not charge for it; when the API
                // serves a price, `babyBedsSubPriced` is filled with it (never a hardcoded amount).
                'babyBedsSub'     => __('Selon disponibilité', 'guestflow-booking'),
                'babyBedsSubPriced' => __('%s par lit, pour le séjour', 'guestflow-booking'),
                'offered'         => __('Offert', 'guestflow-booking'),
                // specs/site/site-extra-guest-line.md rules 3-4
                'extraGuests'     => __('Personne(s) supplémentaire(s) ×%d', 'guestflow-booking'),
                'includedGuestsNote' => __('Prix de base pour %d voyageurs, supplément au-delà', 'guestflow-booking'),
                'checkInTime'     => __('Heure d’arrivée', 'guestflow-booking'),
                'checkOutTime'    => __('Heure de départ', 'guestflow-booking'),
                'participantsMax' => __('Nombre de participants', 'guestflow-booking'),
                // Cancellation insurance block (specs/payments/cancellation-insurance.md §6.3) — the title
                // itself comes from the catalogue; this one is the fallback when it is empty.
                'insuranceTitle'   => __('Assurance annulation', 'guestflow-booking'),
                'insuranceYes'     => __('Oui, j’assure mon séjour', 'guestflow-booking'),
                'insuranceNo'      => __('Non merci', 'guestflow-booking'),
                'insuranceRequired' => __('Merci d’indiquer si vous souhaitez l’assurance annulation.', 'guestflow-booking'),
                // CGV checkbox (specs/reservations/terms-acceptance-record.md rules 10-13).
                'cgvAcceptBefore' => __('J’ai lu et j’accepte les ', 'guestflow-booking'),
                'cgvAcceptLink'   => __('conditions générales de location', 'guestflow-booking'),
                'cgvRequired'     => __('Acceptez d’abord les conditions générales de location.', 'guestflow-booking'),
                // Collapsible option categories (specs/options/option-categories.md §6.3)
                'showCategory'    => __('Voir les %d options', 'guestflow-booking'),
                'showOthers'      => __('Voir les %d autres', 'guestflow-booking'),
                'collapse'        => __('Réduire', 'guestflow-booking'),
                'categoryAria'    => __('Catégorie %s', 'guestflow-booking'),
                // Calendar navigation and the honeypot label: read by screen readers only, which is
                // exactly why they stayed French through the whole translation pass — nothing on
                // screen showed them (specs/site/site-english-version.md rule 49).
                'calPrevMonth'    => __('Mois précédent', 'guestflow-booking'),
                'calNextMonth'    => __('Mois suivant', 'guestflow-booking'),
                'calJumpToMonth'  => __('Aller à un mois', 'guestflow-booking'),
                'honeypot'        => __('Ne pas remplir', 'guestflow-booking'),
                // Stepper buttons, read by screen readers with the line they count (rule 15).
                'stepAdd'         => __('Ajouter : %s', 'guestflow-booking'),
                'stepRemove'      => __('Retirer : %s', 'guestflow-booking'),
                // No CGV published while GuestFlow requires them (rule 21).
                'bookingClosed'   => __('Réservation en ligne fermée pour le moment.', 'guestflow-booking'),
                // A failed payment leaves the request recorded (rule 16).
                'paymentRetry'    => __('Demande enregistrée (référence %s). Le paiement peut être relancé.', 'guestflow-booking'),
                // UI/UX review 2026-10-18 — the calendar's states and its way out of a closed window
                // (specs/site/wp-booking-widget-redesign.md rules 30-31).
                'legendFree'      => __('Libre', 'guestflow-booking'),
                'legendTaken'     => __('Pris', 'guestflow-booking'),
                'nextAvailable'   => __('Prochaine disponibilité : %s', 'guestflow-booking'),
                'nextAvailableGo' => __('Voir', 'guestflow-booking'),
                // Refused on the field (specs/site/wordpress-plugin.md rule 28). The server sends its own
                // sentence per field; these two are the local check and the fallback for an older server.
                'fieldRequired'   => __('Champ requis.', 'guestflow-booking'),
                'emailInvalid'    => __('Adresse e-mail incomplète.', 'guestflow-booking'),
                // The sticky bar's button follows the step (specs/site/wp-booking-widget-redesign.md rule 32).
                'barPickDates'    => __('Choisir les dates', 'guestflow-booking'),
                'barContinue'     => __('Continuer', 'guestflow-booking'),
                'taxIncluded'     => __('taxe de séjour incluse', 'guestflow-booking'),
                // specs/site/booking-drawer-friction.md — minimum stay before choosing (rules 11-12), the
                // price per person (rule 9) and the request without paying (rules 2-4).
                'minShort'        => __('min. %d', 'guestflow-booking'),
                'minNightsFrom'   => __('Départ à partir du %s (%d nuits minimum).', 'guestflow-booking'),
                'minNightsPick'   => __('%d nuits minimum : choisissez le %s ou plus tard.', 'guestflow-booking'),
                'perPersonPerNight' => __('soit %s par personne et par nuit', 'guestflow-booking'),
                'payAmount'       => __('Payer %s', 'guestflow-booking'),
                'payDepositAmount' => __('Payer l’acompte %s', 'guestflow-booking'),
                'sendRequestNoPay' => __('Envoyer une demande sans payer', 'guestflow-booking'),
                'requestNoPayHint' => __('Une question avant de vous engager ? Envoyez une demande : aucun paiement tant que nous n’avons pas répondu.', 'guestflow-booking'),
                // « Bon cadeau » on the booking engine (specs/gift-vouchers/gift-vouchers.md rules 36-38).
                'voucherApply'    => __('Appliquer', 'guestflow-booking'),
                'voucherRemove'   => __('Retirer le bon', 'guestflow-booking'),
                'voucherLength'   => __('Le code compte %d caractères.', 'guestflow-booking'),
                'voucherMistyped' => __('Code mal recopié : vérifier chaque caractère.', 'guestflow-booking'),
                'voucherUnknown'  => __('Code inconnu. Encore %d essais.', 'guestflow-booking'),
                'voucherExpired'  => __('Ce bon a expiré le %s.', 'guestflow-booking'),
                'voucherExhausted' => __('Ce bon est entièrement utilisé.', 'guestflow-booking'),
                'voucherTooMany'  => __('Trop d’essais. Nouvelle saisie possible dans 15 minutes.', 'guestflow-booking'),
                'payToday'        => __('À payer aujourd’hui', 'guestflow-booking'),
                'confirmBooking'  => __('Confirmer la réservation', 'guestflow-booking'),
                // Gift voucher tunnel (specs/gift-vouchers/gift-vouchers.md §6).
                'gvTitle'         => __('Choisir son cadeau', 'guestflow-booking'),
                'gvIntro'         => __('Un montant au choix, valable %d mois, à utiliser en une ou plusieurs fois.', 'guestflow-booking'),
                'gvIntroSession'  => __('Valable %d mois à compter du paiement, pour une séance à réserver en ligne.', 'guestflow-booking'),
                'gvAmount'        => __('Montant', 'guestflow-booking'),
                'gvAmountRange'   => __('De %s à %s.', 'guestflow-booking'),
                'gvAmountEmpty'   => __('Indiquer un montant.', 'guestflow-booking'),
                'gvAmountFormat'  => __('Montant en euros, deux décimales au plus.', 'guestflow-booking'),
                'gvAmountMin'     => __('Montant minimum : %s.', 'guestflow-booking'),
                'gvAmountMax'     => __('Montant maximum : %s.', 'guestflow-booking'),
                'gvIdeas'         => __('Pour se repérer', 'guestflow-booking'),
                'gvIdeasNote'     => __('Prix indicatifs, susceptibles d’évoluer.', 'guestflow-booking'),
                'gvOptional'      => __('(facultatif)', 'guestflow-booking'),
                'gvFirstName'     => __('Prénom', 'guestflow-booking'),
                'gvLastName'      => __('Nom', 'guestflow-booking'),
                'gvFirstEmpty'    => __('Saisissez le prénom de la personne à qui le bon est offert.', 'guestflow-booking'),
                'gvLastEmpty'     => __('Saisissez son nom.', 'guestflow-booking'),
                'gvSender'        => __('De la part de', 'guestflow-booking'),
                'gvWord'          => __('Un mot', 'guestflow-booking'),
                'gvEmail'         => __('E-mail de réception du bon', 'guestflow-booking'),
                'gvEmailEmpty'    => __('Indiquer l’adresse où recevoir le bon.', 'guestflow-booking'),
                'gvTermsBefore'   => __('J’accepte les ', 'guestflow-booking'),
                'gvTermsLink'     => __('conditions de vente', 'guestflow-booking'),
                'gvTermsAfter'    => __(' des bons cadeaux.', 'guestflow-booking'),
                'gvTermsRequired' => __('Les conditions de vente doivent être acceptées.', 'guestflow-booking'),
                'gvPay'           => __('Payer %s', 'guestflow-booking'),
                'gvPayBare'       => __('Payer', 'guestflow-booking'),
                'gvSoon'          => __('Vente en ligne bientôt disponible.', 'guestflow-booking'),
                'gvCode'          => __('Code', 'guestflow-booking'),
                'gvCodeAfterPay'  => __('délivré après le paiement', 'guestflow-booking'),
                // Rule 66 — the voucher card that turns (the back's own words come from GuestFlow, French as the PDF).
                'gvFront'         => __('Recto', 'guestflow-booking'),
                'gvBack'          => __('Verso', 'guestflow-booking'),
                'gvFaceGroup'     => __('Face du bon', 'guestflow-booking'),
                'gvEnlarge'       => __('Agrandir', 'guestflow-booking'),
                'gvClose'         => __('Fermer', 'guestflow-booking'),
                'gvZoomLabel'     => __('Le bon en grand', 'guestflow-booking'),
                'gvTurnCard'      => __('Retourner le bon', 'guestflow-booking'),
                'gvPreviewPill'   => __('Aperçu', 'guestflow-booking'),
                'gvSeeBack'       => __('Voir le verso du bon', 'guestflow-booking'),
                'gvPaymentFailed' => __('Paiement non abouti. Aucun bon n’a été émis.', 'guestflow-booking'),
                'gvLinkExpired'   => __('Le lien de paiement a expiré. Aucun paiement n’a été pris.', 'guestflow-booking'),
                'gvRestart'       => __('Recommencer', 'guestflow-booking'),
                'gvConfirming'    => __('Confirmation du paiement en cours…', 'guestflow-booking'),
                'gvStillPending'  => __('Paiement en attente. Si le paiement vient d’être effectué, patienter quelques instants puis recharger cette page.', 'guestflow-booking'),
                'gvNotFound'      => __('Ce lien ne correspond à aucun bon.', 'guestflow-booking'),
                'gvReady'         => __('Le bon est prêt', 'guestflow-booking'),
                'gvDownload'      => __('Télécharger le PDF', 'guestflow-booking'),
                'gvPrint'         => __('Imprimer', 'guestflow-booking'),
                'gvHowTo'         => __('Le bénéficiaire saisit le code au moment de réserver ses dates.', 'guestflow-booking'),
                'gvLinkStays'     => __('Cette page reste accessible depuis le lien reçu par e-mail.', 'guestflow-booking'),
                'gvExpired'       => __('Ce bon a expiré le %s.', 'guestflow-booking'),
                'gvExhausted'     => __('Ce bon est entièrement utilisé.', 'guestflow-booking'),
                'gvCancelled'     => __('Ce bon a été annulé.', 'guestflow-booking'),
                'gvBalance'       => __('Solde : %s', 'guestflow-booking'),
                'gvTooMany'       => __('Trop de demandes. Réessayer dans quelques minutes.', 'guestflow-booking'),
                // Bons cadeaux composés (specs/gift-vouchers/gift-voucher-campaigns.md rules 16-19): the choice of offer and the composed voucher.
                'gvKindLodging'   => __('Séjours', 'guestflow-booking'),
                'gvKindResource'  => __('Séances', 'guestflow-booking'),
                'gvFreeAmount'    => __('Montant au choix', 'guestflow-booking'),
                'gvYourGift'      => __('Votre cadeau', 'guestflow-booking'),
                'gvIncludes'      => __('Le bon comprend', 'guestflow-booking'),
                'gvBand'          => __('Séance en %s, de %s à %s.', 'guestflow-booking'),
                'gvExtrasTitle'   => __('Ajouter au bon', 'guestflow-booking'),
                'gvExtrasAvailable' => __('%s disponibles', 'guestflow-booking'),
                'gvExtrasAvailableOne' => __('%s disponible', 'guestflow-booking'),
                'gvExtrasFrom'    => __('dès %s', 'guestflow-booking'),
                'gvExtrasMax'     => __('%s au maximum par bon', 'guestflow-booking'),
                'gvExtrasFoot'    => __('Prix TTC, ajoutés au montant du bon.', 'guestflow-booking'),
                'gvExtrasBySlot'  => __('prix selon le créneau', 'guestflow-booking'),
                'gvUnitEach'      => __('l’unité', 'guestflow-booking'),
                'gvUnitPerson'    => __('par personne', 'guestflow-booking'),
                'gvExtraTime'     => __('Temps supplémentaire', 'guestflow-booking'),
                'gvExtraTimeUnit' => __('par tranche de %s', 'guestflow-booking'),
                'gvRecap'         => __('Récapitulatif', 'guestflow-booking'),
                'gvTotalTtc'      => __('Total TTC', 'guestflow-booking'),
                'gvVat'           => __('dont TVA %s %', 'guestflow-booking'),
                'gvHourShort'     => __('h', 'guestflow-booking'),
                'gvMinShort'      => __('min', 'guestflow-booking'),
                // « Utiliser un bon cadeau » (rules 23-32).
                'guPaid'          => __('Paiement reçu : la confirmation arrive par mail dès que la banque l’a validé.', 'guestflow-booking'),
                // « Réserver une séance » (specs/site/site-outside-resource-booking.md): the tunnel that books a session, paid online or with a voucher code.
                'sbTitle'         => __('Réserver une séance', 'guestflow-booking'),
                'sbIntro'         => __('Choisissez votre créneau, puis payez en ligne ou saisissez le code de votre bon cadeau.', 'guestflow-booking'),
                'sbNone'          => __('Aucune activité à réserver en ce moment.', 'guestflow-booking'),
                'sbActivity'      => __('Activité', 'guestflow-booking'),
                'sbFrom'          => __('dès %s l’heure', 'guestflow-booking'),
                'sbCode'          => __('Code bon cadeau', 'guestflow-booking'),
                'sbOptional'      => __('facultatif', 'guestflow-booking'),
                'sbApply'         => __('Appliquer', 'guestflow-booking'),
                'sbRemove'        => __('Retirer', 'guestflow-booking'),
                'sbCodeEmpty'     => __('Saisissez le code imprimé au dos du bon.', 'guestflow-booking'),
                'sbCodeUnknown'   => __('Ce code n’est pas reconnu. Vérifiez les caractères au dos du bon (0 et O, 1 et I).', 'guestflow-booking'),
                'sbCodeLodging'   => __('Ce bon se règle sur un séjour. Il est utilisable sur la page de réservation d’un hébergement, où le code sera rempli automatiquement.', 'guestflow-booking'),
                'sbCodeLodgingGo' => __('Réserver un hébergement', 'guestflow-booking'),
                'sbVoucherOn'     => __('Bon n° %s · %s', 'guestflow-booking'),
                'sbVoucherFrom'   => __(', offert par %s', 'guestflow-booking'),
                'sbVoucherTo'     => __(' à %s', 'guestflow-booking'),
                'sbSession'       => __('Séance', 'guestflow-booking'),
                'sbDuration'      => __('Durée', 'guestflow-booking'),
                'sbDurationVoucher' => __('%s comprise dans le bon', 'guestflow-booking'),
                'sbPeople'        => __('Personnes', 'guestflow-booking'),
                'sbPeopleHint'    => __('Pour préparer la séance · %s au plus', 'guestflow-booking'),
                'sbPeopleShort'   => __('%s pers.', 'guestflow-booking'),
                'sbDate'          => __('Date', 'guestflow-booking'),
                'sbDateUntil'     => __('jusqu’au %s', 'guestflow-booking'),
                'sbSlot'          => __('Créneau', 'guestflow-booking'),
                'sbPickDate'      => __('Choisissez d’abord une date.', 'guestflow-booking'),
                'sbNoSlot'        => __('Aucun créneau de %s ce jour-là. Réduisez la durée ou choisissez un autre jour.', 'guestflow-booking'),
                'sbTaken'         => __('Pris', 'guestflow-booking'),
                'sbIncluded'      => __('Inclus dans le bon', 'guestflow-booking'),
                'sbIncludedIn'    => __('inclus dans le bon', 'guestflow-booking'),
                'sbWithEvening'   => __(' · dont soirée', 'guestflow-booking'),
                'sbEvening'       => __(' · soirée', 'guestflow-booking'),
                'sbAddTitle'      => __('Ajouter à la séance', 'guestflow-booking'),
                'sbAddFoot'       => __('Prix TTC, ajoutés au montant de la séance.', 'guestflow-booking'),
                'sbAddMax'        => __('%s au maximum par séance', 'guestflow-booking'),
                'sbContact'       => __('Vos coordonnées', 'guestflow-booking'),
                'sbTermsBefore'   => __('J’accepte les ', 'guestflow-booking'),
                'sbTermsLink'     => __('conditions de la séance', 'guestflow-booking'),
                'sbTermsAfter'    => __('.', 'guestflow-booking'),
                'sbTermsRequired' => __('Les conditions de la séance doivent être acceptées.', 'guestflow-booking'),
                'sbFix'           => __('Certains champs sont à corriger avant de continuer.', 'guestflow-booking'),
                'sbSummary'       => __('Récapitulatif', 'guestflow-booking'),
                'sbSummaryEmpty'  => __('Choisissez un horaire', 'guestflow-booking'),
                'sbToPay'         => __('À payer', 'guestflow-booking'),
                'sbNothing'       => __('Rien à payer', 'guestflow-booking'),
                'sbPickSlot'      => __('Choisir un créneau', 'guestflow-booking'),
                'sbPickSlotBar'   => __('Choisissez un créneau', 'guestflow-booking'),
                'sbBooked'        => __('Séance réservée', 'guestflow-booking'),
                'sbBookedLine'    => __('%s · %s – %s', 'guestflow-booking'),
                'sbBookedMail'    => __('Un e-mail de confirmation vous est envoyé, avec les conditions et l’accès.', 'guestflow-booking'),
                'sbPaidLabel'     => __('Payé', 'guestflow-booking'),
                'sbWaiting'       => __('Confirmation du paiement en cours…', 'guestflow-booking'),
                'sbLapsed'        => __('Le paiement n’a pas abouti : le créneau a été libéré et aucune séance n’est réservée.', 'guestflow-booking'),
                'sbRefund'        => __('Le paiement est arrivé après la fin du délai et le créneau est pris : il sera remboursé, l’équipe vous écrit.', 'guestflow-booking'),
                'sbAgain'         => __('Réserver une autre séance', 'guestflow-booking'),
                'sbHaveVoucher'   => __('Vous avez reçu un bon cadeau ?', 'guestflow-booking'),
                'sbBookSession'   => __('Réserver votre séance', 'guestflow-booking'),
            ],
        ];
    }
}
