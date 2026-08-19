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
    private const BLOCKS = ['calendar', 'booking', 'properties'];

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

        foreach (self::BLOCKS as $name) {
            wp_register_script(
                "guestflow-{$name}-editor",
                GF_BOOKING_URL . "blocks/{$name}/editor.js",
                ['wp-blocks', 'wp-element', 'wp-components', 'wp-block-editor', 'wp-i18n', 'gf-runtime'],
                $this->asset_ver("blocks/{$name}/editor.js"),
                true
            );
            wp_register_script(
                "guestflow-{$name}-view",
                GF_BOOKING_URL . "blocks/{$name}/view.js",
                ['gf-runtime'],
                $this->asset_ver("blocks/{$name}/view.js"),
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
            'bookingPageUrl'    => (string) $s->get('booking_page_url', ''),
            'configured'        => $s->is_configured(),
            'i18n'              => [
                'loading'         => __('Chargement…', 'guestflow-booking'),
                'unavailable'     => __('Réservation temporairement indisponible.', 'guestflow-booking'),
                'genericError'    => __('Une erreur est survenue. Réessayez plus tard.', 'guestflow-booking'),
                'noAvailability'  => __('Aucune disponibilité sur cette période.', 'guestflow-booking'),
                'blocked'         => __('Indisponible', 'guestflow-booking'),
                'available'       => __('Disponible', 'guestflow-booking'),
                'nights'          => __('nuit(s)', 'guestflow-booking'),
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
                'bookNow'         => __('Réserver', 'guestflow-booking'),
                'capacity'        => __('Capacité', 'guestflow-booking'),
                'persons'         => __('personnes', 'guestflow-booking'),
                'requiredFields'  => __('Merci de renseigner tous les champs obligatoires.', 'guestflow-booking'),
                // Online payment flow (specs/public-online-payment.md)
                'payOnline'       => __('Payer en ligne', 'guestflow-booking'),
                'preparingPayment' => __('Préparation du paiement…', 'guestflow-booking'),
                'redirectingPayment' => __('Redirection vers le paiement sécurisé…', 'guestflow-booking'),
                'confirmingPayment' => __('Confirmation de votre paiement en cours…', 'guestflow-booking'),
                'paymentConfirmed' => __('Paiement confirmé — votre réservation est validée !', 'guestflow-booking'),
                'paymentPending'  => __('Paiement en attente. Si vous venez de payer, patientez quelques instants.', 'guestflow-booking'),
                'paymentConflict' => __('Paiement reçu et réservation enregistrée. Nous revenons vers vous très vite pour confirmer les détails.', 'guestflow-booking'),
                'stayRecap'       => __('Votre séjour', 'guestflow-booking'),
                // Online-deposit flow (specs/public-online-deposit.md)
                'payDeposit'      => __('Payer l’acompte', 'guestflow-booking'),
                'depositNow'      => __('Acompte à payer maintenant', 'guestflow-booking'),
                'depositPaid'     => __('Acompte réglé', 'guestflow-booking'),
                'balanceDueBefore' => __('Solde à régler avant le %s', 'guestflow-booking'),
                'balanceEmailFollows' => __('Un email vous sera envoyé pour régler le solde à l’échéance.', 'guestflow-booking'),
                // Planning-card options (specs/public-planning-options.md)
                'toBeScheduled'   => __('À planifier avec l’hôte — nous vous contacterons pour convenir de l’horaire.', 'guestflow-booking'),
                'moreInfo'        => __('Plus d’infos', 'guestflow-booking'),
                // Unified widget (specs/wp-booking-widget-redesign.md)
                'selectDates'     => __('Choisissez vos dates', 'guestflow-booking'),
                'pickArrival'     => __('Sélectionnez votre date d’arrivée', 'guestflow-booking'),
                'pickDeparture'   => __('Sélectionnez votre date de départ', 'guestflow-booking'),
                'rangeBlocked'    => __('Ces dates incluent une nuit indisponible. Choisissez une autre période.', 'guestflow-booking'),
                'travelers'       => __('Voyageurs', 'guestflow-booking'),
                'guestsUnit'      => __('voyageurs', 'guestflow-booking'),
                'babiesUnit'      => __('bébés', 'guestflow-booking'),
                'supplements'     => __('Options & suppléments', 'guestflow-booking'),
                'teensAges'       => __('12 à 18 ans', 'guestflow-booking'),
                'childrenAges'    => __('2 à 12 ans', 'guestflow-booking'),
                'babiesAges'      => __('0 à 2 ans', 'guestflow-booking'),
                'babyBedsLabel'   => __('Lit(s) bébé souhaité(s) ?', 'guestflow-booking'),
                'babyBedsSub'     => __('Gratuit, selon disponibilité', 'guestflow-booking'),
                'offered'         => __('Offert', 'guestflow-booking'),
                'checkInTime'     => __('Heure d’arrivée', 'guestflow-booking'),
                'checkOutTime'    => __('Heure de départ', 'guestflow-booking'),
                'participantsMax' => __('Nombre de participants', 'guestflow-booking'),
                // Cancellation insurance block (specs/cancellation-insurance.md §6.3) — the title
                // itself comes from the catalogue; this one is the fallback when it is empty.
                'insuranceTitle'   => __('Assurance annulation', 'guestflow-booking'),
                'insuranceYes'     => __('Oui, j’assure mon séjour', 'guestflow-booking'),
                'insuranceNo'      => __('Non merci', 'guestflow-booking'),
                'insuranceRequired' => __('Merci d’indiquer si vous souhaitez l’assurance annulation.', 'guestflow-booking'),
                // Collapsible option categories (specs/option-categories.md §6.3)
                'showCategory'    => __('Voir les %d options', 'guestflow-booking'),
                'showOthers'      => __('Voir les %d autres', 'guestflow-booking'),
                'collapse'        => __('Réduire', 'guestflow-booking'),
                'categoryAria'    => __('Catégorie %s', 'guestflow-booking'),
            ],
        ];
    }
}
